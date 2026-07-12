import { TFile, TFolder, type App } from 'obsidian';
import { t } from '../i18n';
import type { MCPRegistry } from '../mcp/registry';
import type { QueryResult } from '../rag/query';
import type { RetrievalProviderDiagnostic } from '../rag/retrieval-pipeline';
import type { KnowledgeGraphStore, GraphEntityRecord } from '../graph/store';
import { createContentHash } from '../rag/hash';
import {
  createContextPreviewRust,
  planChatContextMentionsRust,
  planGraphMentionContextRust,
  planContextGraphVerificationRust,
  planContextSourcesRust,
  planFolderMentionFilesRust,
  type RustAutoRagReason,
  type RustContextSourceInput,
  type RustContextSourceVerification,
  type RustGraphMentionEntityInput,
  type RustGraphMentionRelationInput,
} from '../rag/rust-core';
import type { ContextAttachment, FolderLimitReason, SourceCitation } from './types';
import { createContextBudget, type ContextBlock } from './context-budget';
import { createContextBudgetSnapshot } from './context-composer';
import { expandReferencedVaultFiles } from './context-expansion';
import { type ParsedMention, parseMentions, type MentionResolver } from './mention-parser';
import { appLogger } from '../utils/logger';
import { selectByRustIndices } from '../utils/rust-index-plan';
export {
  parseMentions,
  shouldUseAutoRagForMentions,
  type MentionResolver,
  type ParsedMention,
} from './mention-parser';

export interface RagQueryLike {
  query(question: string, topK: number, minScore?: number): Promise<QueryResult[]>;
  getLastRetrievalDiagnostics?(): RetrievalProviderDiagnostic[];
}

export interface ContextBuildResult {
  systemPrompt: string | null;
  attachments: ContextAttachment[];
  citations: SourceCitation[];
  warnings: string[];
  contextBudgetSnapshot?: import('./types').ContextBudgetSnapshot;
}

interface BuildContextOptions {
  app: App;
  ragEngine?: RagQueryLike | null;
  mcpRegistry?: MCPRegistry | null;
  knowledgeGraphStore?: KnowledgeGraphStore | null;
  maxFolderFiles?: number;
  maxContextChars?: number;
  maxReferenceFiles?: number;
  ragTopK?: number;
  ragMinScore?: number;
}

const DEFAULT_MAX_FOLDER_FILES = 12;
const DEFAULT_MAX_CONTEXT_CHARS = 24_000;
const DEFAULT_MAX_REFERENCE_FILES = 6;
const DEFAULT_RAG_TOP_K = 5;
function getVaultContextRules(): string {
  return [
    t('contextRuleNoSourceOutsideVault'),
    t('contextRuleSeparateSuggestions'),
    t('contextRuleNoEvidence'),
  ].join('\n');
}

export async function buildChatContext(
  question: string,
  options: BuildContextOptions,
): Promise<ContextBuildResult> {
  const maxFolderFiles = options.maxFolderFiles ?? DEFAULT_MAX_FOLDER_FILES;
  const maxContextChars = options.maxContextChars ?? DEFAULT_MAX_CONTEXT_CHARS;
  const maxReferenceFiles = options.maxReferenceFiles ?? DEFAULT_MAX_REFERENCE_FILES;
  const ragTopK = options.ragTopK ?? DEFAULT_RAG_TOP_K;
  const budget = createContextBudget(maxContextChars);
  const attachments: ContextAttachment[] = [];
  const citations: SourceCitation[] = [];
  const warnings: string[] = [];
  const graphEntities = options.knowledgeGraphStore
    ? await options.knowledgeGraphStore.getEntities()
    : undefined;
  const resolver = createAppMentionResolver(
    options.app,
    options.mcpRegistry,
    options.knowledgeGraphStore,
    graphEntities,
  );
  const mentions = parseMentions(question, resolver);
  const mentionPlan = planChatContextMentionsRust(mentions.map((mention) => mention.type)) ?? {
    fileIndices: [],
    folderIndices: [],
    entityIndices: [],
    serverIndices: [],
    useAutoRag: false,
    autoRagReason: 'disabled',
  };
  const shouldUseAutoRag = mentionPlan.useAutoRag;

  const appendBlock = (block: ContextBlock): boolean => {
    if (block.citation) citations.push(block.citation);
    return budget.append(block);
  };

  for (const mention of selectByRustIndices(mentions, mentionPlan.fileIndices, { dedupe: true })) {
    const fileResult = await appendFileMention(
      mention.name,
      options.app,
      appendBlock,
      attachments,
      citations,
    );
    if (!fileResult) continue;

    const expansion = await expandReferencedVaultFiles(
      fileResult.file,
      fileResult.content,
      options.app,
      maxReferenceFiles,
    );
    warnings.push(...expansion.warnings);
    for (const reference of expansion.references) {
      appendReferenceFile(reference.file, reference.content, appendBlock, attachments, citations);
    }
  }

  for (const mention of selectByRustIndices(mentions, mentionPlan.folderIndices, {
    dedupe: true,
  })) {
    await appendFolderMention(
      mention.name,
      options.app,
      appendBlock,
      attachments,
      citations,
      maxFolderFiles,
    );
  }

  if (options.ragEngine && shouldUseAutoRag) {
    try {
      const results = await options.ragEngine.query(question, ragTopK, options.ragMinScore);
      const sourceInputs: RustContextSourceInput[] = [];
      const verifications: RustContextSourceVerification[] = [];
      for (const result of results) {
        const graphPlan = planContextGraphVerificationRust(
          result.entry.metadata.filePath,
          t('contextUnsupportedGraphRagSource'),
        );
        const verified =
          graphPlan?.isGraphSource === true
            ? (graphPlan.verification ?? {
                status: 'missing',
                detail: t('contextUnsupportedGraphRagSource'),
              })
            : await verifyQueryResult(result, options.app);
        sourceInputs.push(contextSourceInputFromQueryResult(result));
        verifications.push(verified);
      }
      const sourcePlan = planContextSourcesRust(
        sourceInputs,
        verifications,
        citations.length + 1,
        'rag',
      ) ?? { citations: [], blocks: [], sourceIds: [], rejectedCount: 0 };
      citations.push(...sourcePlan.citations);
      for (const block of sourcePlan.blocks) {
        appendBlock({ text: block.text });
      }
      const diagnosticsText = formatRetrievalDiagnostics(
        options.ragEngine.getLastRetrievalDiagnostics?.() ?? [],
      );
      attachments.push({
        id: 'rag:auto',
        type: 'rag',
        name: 'auto',
        label: t('contextAutoRagDetail', { count: sourcePlan.sourceIds.length }),
        status: sourcePlan.sourceIds.length > 0 ? 'attached' : 'low-relevance',
        detail:
          sourcePlan.sourceIds.length > 0
            ? combineAttachmentDetails([
                formatAutoRagReason(mentionPlan.autoRagReason),
                sourcePlan.rejectedCount > 0
                  ? t('contextRejectedCandidatesExcluded', { count: sourcePlan.rejectedCount })
                  : null,
                diagnosticsText,
              ])
            : t('contextNoRelevantDocs'),
        reason: t('contextAutoRagTitle'),
        estimatedChars: sourcePlan.blocks.reduce((total, block) => total + block.text.length, 0),
        actualChars: sourcePlan.blocks.reduce((total, block) => total + block.text.length, 0),
        sourceIds: sourcePlan.sourceIds,
        autoRagReason: mentionPlan.autoRagReason,
      });
      const graphContributionCount = countVerifiedGraphContributions(results, verifications);
      if (graphContributionCount > 0) {
        attachments.push({
          id: 'graph-rag:auto',
          type: 'graph-rag',
          name: 'auto',
          label: t('contextGraphContributionTitle'),
          status: 'attached',
          detail: t('contextGraphContributionDetail', { count: graphContributionCount }),
          sourceIds: sourcePlan.sourceIds,
        });
      }
    } catch (err) {
      appLogger.warn('Auto RAG context build failed.', {
        source: 'chat.context',
        error: err,
      });
      warnings.push(t('contextRagLoadFailed', { error: stringifyError(err) }));
      attachments.push({
        id: 'rag:auto',
        type: 'rag',
        name: 'auto',
        label: t('contextAutoRagTitle'),
        status: 'error',
        detail: stringifyError(err),
      });
    }
  } else if (options.ragEngine && !shouldUseAutoRag) {
    attachments.push({
      id: 'rag:auto',
      type: 'rag',
      name: 'auto',
      label: t('contextAutoRagTitle'),
      status: 'missing',
      detail: formatAutoRagReason(mentionPlan.autoRagReason),
      reason: t('contextAutoRagTitle'),
      autoRagReason: mentionPlan.autoRagReason,
    });
  }

  const entityMentions: ParsedMention[] = selectByRustIndices(mentions, mentionPlan.entityIndices, {
    dedupe: true,
  });
  if (entityMentions.length > 0 && options.knowledgeGraphStore) {
    await appendGraphEntityContext(
      entityMentions,
      options.knowledgeGraphStore,
      appendBlock,
      attachments,
      citations,
      graphEntities,
    );
  }

  for (const mention of selectByRustIndices(mentions, mentionPlan.serverIndices, {
    dedupe: true,
  })) {
    await appendServerMention(mention.name, options.mcpRegistry, appendBlock, attachments);
  }

  const contextText = budget
    .getBlocks()
    .map((block) => block.text)
    .filter(Boolean)
    .join('\n\n---\n\n');
  const warningText = warnings.length > 0 ? `\n\n[Context Warnings]\n${warnings.join('\n')}` : '';
  return {
    systemPrompt: contextText
      ? `[Vault Context Rules]\n${getVaultContextRules()}\n\n[Vault Context]\n${contextText}${warningText}`
      : warningText.trim() || null,
    attachments,
    citations,
    warnings,
    contextBudgetSnapshot: createContextBudgetSnapshot({
      maxChars: maxContextChars,
      usedChars: maxContextChars - budget.getRemainingChars(),
      attachments,
      citations,
    }),
  };
}

function countVerifiedGraphContributions(
  results: readonly QueryResult[],
  verifications: readonly RustContextSourceVerification[],
): number {
  let count = 0;
  for (const [index, result] of results.entries()) {
    if (verifications[index]?.status !== 'verified') continue;
    if (
      result.retrievalSources?.some(
        (source) => source === 'graph-local' || source === 'graph-global' || source === 'evidence',
      )
    ) {
      count++;
    }
  }
  return count;
}

export function createAppMentionResolver(
  app: App,
  registry?: MCPRegistry | null,
  knowledgeGraphStore?: KnowledgeGraphStore | null,
  graphEntities?: readonly GraphEntityRecord[],
): MentionResolver {
  let entityNames = new Set<string>();
  if (knowledgeGraphStore && graphEntities) {
    const names = new Set<string>();
    for (const entity of graphEntities) {
      names.add(entity.canonicalName.toLowerCase());
      for (const alias of entity.aliases) {
        names.add(alias.toLowerCase());
      }
    }
    entityNames = names;
  }
  return {
    isServer: (name: string) =>
      registry ? registry.getEnabledServers().some((server) => server.name === name) : false,
    isFile: (name: string) => app.vault.getAbstractFileByPath(name) instanceof TFile,
    isFolder: (name: string) => app.vault.getAbstractFileByPath(name) instanceof TFolder,
    isEntity: (name: string) => entityNames.has(name.toLowerCase()),
  };
}

function contextSourceInputFromQueryResult(result: QueryResult): RustContextSourceInput {
  const metadata = result.entry.metadata;
  return {
    filePath: metadata.filePath,
    heading: metadata.heading,
    startLine: metadata.startLine,
    endLine: metadata.endLine,
    text: metadata.text,
    score: result.score,
    vectorScore: result.vectorScore,
    bm25Score: result.bm25Score,
    selectionReason: result.selectionReason,
  };
}

function formatRetrievalDiagnostics(
  diagnostics: readonly RetrievalProviderDiagnostic[],
): string | null {
  if (diagnostics.length === 0) return null;
  const summary = diagnostics
    .map((diagnostic) => {
      if (diagnostic.source === 'reranker') {
        return t('contextDiagnosticRerankerSummary', {
          status: formatRerankDiagnosticStatus(diagnostic.skippedReason, diagnostic.status),
          count: diagnostic.candidateCount,
        });
      }
      return t('contextDiagnosticProviderSummary', {
        provider: diagnostic.providerId,
        status: diagnostic.status,
        readiness: diagnostic.readiness,
        count: diagnostic.candidateCount,
      });
    })
    .join(', ');
  return t('contextSearchDiagnostic', { summary });
}

function formatRerankDiagnosticStatus(
  reason: string | undefined,
  status: RetrievalProviderDiagnostic['status'],
): string {
  if (status === 'ok') return t('contextRerankStatusApplied');
  switch (reason) {
    case 'empty-rank-plan':
    case 'skipped-empty-allowed-ids':
      return t('contextRerankStatusEmpty');
    case 'invalid-json':
      return t('contextRerankStatusInvalidJson');
    default:
      return t('contextRerankStatusError');
  }
}

function formatAutoRagReason(reason: RustAutoRagReason): string {
  switch (reason) {
    case 'server-only':
      return t('contextAutoRagReasonServerOnly');
    case 'server-and-vault':
      return t('contextAutoRagReasonServerAndVault');
    case 'vault-mention':
      return t('contextAutoRagReasonVaultMention');
    case 'no-mentions':
      return t('contextAutoRagReasonNoMentions');
    case 'implicit':
      return t('contextAutoRagReasonImplicit');
    case 'disabled':
      return t('contextAutoRagReasonDisabled');
  }
}

function combineAttachmentDetails(
  details: readonly (string | null | undefined)[],
): string | undefined {
  const text = details.filter((detail): detail is string => Boolean(detail)).join(' ');
  return text || undefined;
}

async function verifyQueryResult(result: QueryResult, app: App): Promise<QueryResultVerification> {
  const metadata = result.entry.metadata;
  const file = app.vault.getAbstractFileByPath(metadata.filePath);
  if (!(file instanceof TFile)) {
    return { status: 'missing', detail: t('contextFileMissing') };
  }
  if (
    typeof metadata.sourceMtime !== 'number' ||
    typeof metadata.sourceSize !== 'number' ||
    typeof metadata.contentHash !== 'string' ||
    typeof metadata.endLine !== 'number'
  ) {
    return { status: 'stale', detail: t('contextLegacyIndexNeedsReindex') };
  }
  if (metadata.sourceMtime !== file.stat.mtime || metadata.sourceSize !== file.stat.size) {
    return { status: 'stale', detail: t('contextFileModified') };
  }
  const content = await app.vault.cachedRead(file);
  if (createContentHash(content) !== metadata.contentHash) {
    return { status: 'stale', detail: t('contextHashChanged') };
  }
  const lineCount = content.split('\n').length;
  if (
    metadata.startLine < 0 ||
    metadata.endLine < metadata.startLine ||
    metadata.endLine >= lineCount
  ) {
    return { status: 'stale', detail: t('contextLineMismatch') };
  }
  return { status: 'verified' };
}

type QueryResultVerification = RustContextSourceVerification;

async function appendFileMention(
  path: string,
  app: App,
  appendBlock: (block: ContextBlock) => boolean,
  attachments: ContextAttachment[],
  citations: SourceCitation[],
): Promise<{ file: TFile; content: string } | null> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) {
    attachments.push({
      id: `file:${path}`,
      type: 'file',
      name: path,
      label: path,
      status: 'missing',
      detail: t('fileNotFoundError', { path }),
    });
    return null;
  }

  try {
    const content = await app.vault.cachedRead(file);
    const citation: SourceCitation = {
      id: `file-${citations.length + 1}`,
      filePath: file.path,
      status: 'verified',
      preview: createContextPreviewRust(content) ?? '',
    };
    const attachedFully = appendBlock({
      citation,
      text: `[File: ${file.path}]\n${content}`,
    });
    attachments.push({
      id: `file:${file.path}`,
      type: 'file',
      name: file.path,
      label: file.path,
      status: attachedFully ? 'attached' : 'partial',
      detail: attachedFully ? undefined : t('contextPartialBudget'),
      reason: t('chatFileMentionChip', { name: file.path }),
      estimatedChars: content.length,
      actualChars: content.length,
      pinned: true,
      sourceIds: [citation.id],
    });
    return { file, content };
  } catch (err) {
    appLogger.warn('File context attachment failed.', {
      source: 'chat.context',
      data: { path },
      error: err,
    });
    attachments.push({
      id: `file:${path}`,
      type: 'file',
      name: path,
      label: path,
      status: 'error',
      detail: stringifyError(err),
    });
    return null;
  }
}

function appendReferenceFile(
  file: TFile,
  content: string,
  appendBlock: (block: ContextBlock) => boolean,
  attachments: ContextAttachment[],
  citations: SourceCitation[],
): void {
  const citation: SourceCitation = {
    id: `reference-${citations.length + 1}`,
    filePath: file.path,
    status: 'verified',
    preview: createContextPreviewRust(content) ?? '',
  };
  const attachedFully = appendBlock({
    citation,
    text: `[Reference File: ${file.path}]\n${content}`,
  });
  attachments.push({
    id: `reference:${file.path}`,
    type: 'reference',
    name: file.path,
    label: file.path,
    status: attachedFully ? 'attached' : 'partial',
    detail: attachedFully ? undefined : t('contextPartialBudget'),
    reason: t('chatFileMentionChip', { name: file.path }),
    estimatedChars: content.length,
    actualChars: content.length,
    sourceIds: [citation.id],
  });
}

async function appendFolderMention(
  path: string,
  app: App,
  appendBlock: (block: ContextBlock) => boolean,
  attachments: ContextAttachment[],
  citations: SourceCitation[],
  maxFolderFiles: number,
): Promise<void> {
  const folder = app.vault.getAbstractFileByPath(path);
  if (!(folder instanceof TFolder)) {
    attachments.push({
      id: `folder:${path}`,
      type: 'folder',
      name: path,
      label: path,
      status: 'missing',
      detail: t('contextFolderNotFound'),
    });
    return;
  }

  const markdownFiles = app.vault.getMarkdownFiles();
  const filePlan = planFolderMentionFilesRust(
    path,
    markdownFiles.map((file) => file.path),
    maxFolderFiles,
  );
  const files = selectByRustIndices(markdownFiles, filePlan?.indices, { dedupe: true });
  const sourceIds: string[] = [];
  let partial = filePlan?.partial ?? false;
  let folderLimitReason: FolderLimitReason | undefined =
    filePlan?.limitReason === 'max-files' ? 'max-files' : undefined;
  let readErrorCount = 0;

  for (const file of files) {
    try {
      const content = await app.vault.cachedRead(file);
      const citation: SourceCitation = {
        id: `folder-${citations.length + 1}`,
        filePath: file.path,
        status: 'verified',
        preview: createContextPreviewRust(content) ?? '',
      };
      sourceIds.push(citation.id);
      const attachedFully = appendBlock({
        citation,
        text: `[Folder File: ${file.path}]\n${content}`,
      });
      if (!attachedFully) {
        partial = true;
        folderLimitReason = 'budget';
        break;
      }
    } catch {
      partial = true;
      readErrorCount += 1;
      folderLimitReason = 'read-error';
    }
  }

  attachments.push({
    id: `folder:${path}`,
    type: 'folder',
    name: path,
    label: path,
    status: sourceIds.length === 0 ? 'missing' : partial ? 'partial' : 'attached',
    detail: partial
      ? formatFolderPartialDetail(folderLimitReason, maxFolderFiles, readErrorCount)
      : undefined,
    reason: t('chatFolderMentionChip', { name: path }),
    fileCount: files.length,
    filteredCount: filePlan?.matchedCount ? Math.max(0, filePlan.matchedCount - files.length) : 0,
    sourceIds,
    folderLimitReason,
  });
}

function formatFolderPartialDetail(
  reason: FolderLimitReason | undefined,
  maxFolderFiles: number,
  readErrorCount: number,
): string {
  switch (reason) {
    case 'max-files':
      return t('contextFolderPartialMaxFiles', { count: maxFolderFiles });
    case 'budget':
      return t('contextFolderPartialBudget');
    case 'read-error':
      return t('contextFolderPartialReadError', { count: readErrorCount });
    default:
      return t('contextFolderAttachedLimited', { count: maxFolderFiles });
  }
}

async function appendServerMention(
  name: string,
  registry: MCPRegistry | null | undefined,
  appendBlock: (block: ContextBlock) => boolean,
  attachments: ContextAttachment[],
): Promise<void> {
  const client = registry?.getClient(name);
  if (!client) {
    attachments.push({
      id: `mcp:${name}`,
      type: 'mcp-server',
      name,
      label: name,
      status: 'missing',
      detail: t('contextMcpDisconnected'),
    });
    return;
  }

  try {
    const tools = await client.listTools();
    const toolList = tools
      .map((tool) => {
        const schemaJson = JSON.stringify(tool.inputSchema ?? {});
        return `- ${tool.name}: ${tool.description ?? ''}\n  Parameters schema: ${schemaJson}`;
      })
      .join('\n');
    const attachedFully = appendBlock({
      text: t('contextMcpServerBlock', {
        name,
        tools: toolList || t('contextMcpNoTools'),
      }),
    });
    attachments.push({
      id: `mcp:${name}`,
      type: 'mcp-server',
      name,
      label: name,
      status: attachedFully ? 'attached' : 'partial',
      detail: attachedFully ? undefined : t('contextPartialBudget'),
      reason: t('mcpMentionServers'),
      estimatedChars: toolList.length,
      actualChars: toolList.length,
    });
  } catch (err) {
    appLogger.warn('MCP context attachment failed.', {
      source: 'chat.context',
      data: { server: name },
      error: err,
    });
    attachments.push({
      id: `mcp:${name}`,
      type: 'mcp-server',
      name,
      label: name,
      status: 'error',
      detail: stringifyError(err),
    });
  }
}

async function appendGraphEntityContext(
  entityMentions: ParsedMention[],
  graphStore: KnowledgeGraphStore,
  appendBlock: (block: ContextBlock) => boolean,
  attachments: ContextAttachment[],
  citations: SourceCitation[],
  graphEntities?: readonly GraphEntityRecord[],
): Promise<void> {
  const [entities, relations] = await Promise.all([
    graphEntities ? Promise.resolve([...graphEntities]) : graphStore.getEntities(),
    graphStore.getRelations(),
  ]);

  const mentionPlan = planGraphMentionContextRust(
    entityMentions.map((mention) => mention.name),
    entities.map(
      (entity): RustGraphMentionEntityInput => ({
        id: entity.id,
        canonicalName: entity.canonicalName,
        aliases: entity.aliases,
        typeId: entity.typeId,
        description: entity.description,
      }),
    ),
    relations.map(
      (relation): RustGraphMentionRelationInput => ({
        sourceEntityId: relation.sourceEntityId,
        targetEntityId: relation.targetEntityId,
        relationTypeId: relation.relationTypeId,
        description: relation.description,
      }),
    ),
  );
  const matchedEntities = mentionPlan?.matchedEntityIndices
    ? selectByRustIndices(entities, mentionPlan.matchedEntityIndices, { dedupe: true })
    : [];

  if (matchedEntities.length === 0) {
    attachments.push({
      id: 'graph-rag:auto',
      type: 'graph-rag',
      name: 'auto',
      label: t('contextGraphRagEntitiesTitle'),
      status: 'missing',
      detail: t('contextGraphRagEntityNotFound'),
    });
    return;
  }

  const graphText = mentionPlan?.contextLines.join('\n') ?? '';
  appendBlock({ text: graphText });

  const entityCitation = createGraphCitation(matchedEntities, citations.length + 1);
  citations.push(entityCitation);

  attachments.push({
    id: 'graph-rag:auto',
    type: 'graph-rag',
    name: 'auto',
    label: t('contextGraphRagEntitiesDetail', { count: matchedEntities.length }),
    status: 'attached',
    detail: t('contextGraphRagRelationsDetail', {
      count: mentionPlan?.matchedRelationIndices.length ?? 0,
    }),
    sourceIds: [entityCitation.id],
  });
}

function createGraphCitation(entities: GraphEntityRecord[], index: number): SourceCitation {
  const names = entities.map((e) => e.canonicalName).join(', ');
  return {
    id: `graph-${index}`,
    filePath: `graph://entities`,
    status: 'verified',
    preview: `Graph entities: ${createContextPreviewRust(names) ?? ''}`,
    graphType: 'entity',
  };
}

function stringifyError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
