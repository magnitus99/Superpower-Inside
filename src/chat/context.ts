import { TFile, TFolder, type App } from 'obsidian';
import { t } from '../i18n';
import type { MCPRegistry } from '../mcp/registry';
import type { QueryResult } from '../rag/query';
import type { RetrievalProviderDiagnostic } from '../rag/retrieval-pipeline';
import type { KnowledgeGraphStore, GraphEntityRecord } from '../graph/store';
import { createContentHash } from '../rag/hash';
import type { ContextAttachment, SourceCitation } from './types';
import { createContextBudget, type ContextBlock } from './context-budget';
import { expandReferencedVaultFiles } from './context-expansion';
import {
  type ParsedMention,
  parseMentions,
  shouldUseAutoRagForMentions,
  type MentionResolver,
} from './mention-parser';
import { appLogger } from '../utils/logger';
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
const GRAPH_COMMUNITY_SOURCE_PREFIX = 'graph://community/';
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
  const resolver = createAppMentionResolver(
    options.app,
    options.mcpRegistry,
    options.knowledgeGraphStore,
  );
  const mentions = parseMentions(question, resolver);
  const shouldUseAutoRag = shouldUseAutoRagForMentions(mentions);

  const appendBlock = (block: ContextBlock): boolean => {
    if (block.citation) citations.push(block.citation);
    return budget.append(block);
  };

  for (const mention of mentions.filter((item) => item.type === 'file')) {
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

  for (const mention of mentions.filter((item) => item.type === 'folder')) {
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
      const sourceIds: string[] = [];
      let rejectedCount = 0;
      for (const result of results) {
        const verified = isGraphVirtualSource(result.entry.metadata.filePath)
          ? verifyGraphQueryResult(result)
          : await verifyQueryResult(result, options.app);
        const citation = createCitation(
          'rag',
          citations.length + 1,
          result,
          verified.status,
          verified.detail,
          verified.graphType,
        );
        citations.push(citation);
        if (verified.status !== 'verified') {
          rejectedCount++;
          continue;
        }
        sourceIds.push(citation.id);
        appendBlock({
          text: `[Source ${citation.id}: ${citation.filePath}${citation.heading ? ` # ${citation.heading}` : ''}]\n${result.entry.metadata.text}`,
        });
      }
      const diagnosticsText = formatRetrievalDiagnostics(
        options.ragEngine.getLastRetrievalDiagnostics?.() ?? [],
      );
      attachments.push({
        id: 'rag:auto',
        type: 'rag',
        name: 'auto',
        label: t('contextAutoRagDetail', { count: sourceIds.length }),
        status: sourceIds.length > 0 ? 'attached' : 'low-relevance',
        detail:
          sourceIds.length > 0
            ? combineAttachmentDetails([
                rejectedCount > 0
                  ? t('contextRejectedCandidatesExcluded', { count: rejectedCount })
                  : null,
                diagnosticsText,
              ])
            : t('contextNoRelevantDocs'),
        sourceIds,
      });
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
  }

  const entityMentions = mentions.filter((item) => item.type === 'entity');
  if (entityMentions.length > 0 && options.knowledgeGraphStore) {
    await appendGraphEntityContext(
      entityMentions,
      options.knowledgeGraphStore,
      appendBlock,
      attachments,
      citations,
    );
  }

  for (const mention of mentions.filter((item) => item.type === 'server')) {
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
  };
}

export function createAppMentionResolver(
  app: App,
  registry?: MCPRegistry | null,
  knowledgeGraphStore?: KnowledgeGraphStore | null,
): MentionResolver {
  let entityNames = new Set<string>();
  if (knowledgeGraphStore) {
    void knowledgeGraphStore.getEntities().then((entities) => {
      const names = new Set<string>();
      for (const entity of entities) {
        names.add(entity.canonicalName.toLowerCase());
        for (const alias of entity.aliases) {
          names.add(alias.toLowerCase());
        }
      }
      entityNames = names;
    });
  }
  return {
    isServer: (name: string) =>
      registry ? registry.getEnabledServers().some((server) => server.name === name) : false,
    isFile: (name: string) => app.vault.getAbstractFileByPath(name) instanceof TFile,
    isFolder: (name: string) => app.vault.getAbstractFileByPath(name) instanceof TFolder,
    isEntity: (name: string) => entityNames.has(name.toLowerCase()),
  };
}

function createCitation(
  prefix: string,
  index: number,
  result: QueryResult,
  status: SourceCitation['status'],
  detail?: string,
  graphType?: SourceCitation['graphType'],
): SourceCitation {
  const metadata = result.entry.metadata;
  return {
    id: `${prefix}-${index}`,
    filePath: metadata.filePath,
    heading: metadata.heading,
    line: metadata.startLine,
    endLine: metadata.endLine,
    score: result.score,
    vectorScore: result.vectorScore,
    bm25Score: result.bm25Score,
    status,
    detail,
    preview: createPreview(metadata.text),
    graphType,
  };
}

function formatRetrievalDiagnostics(
  diagnostics: readonly RetrievalProviderDiagnostic[],
): string | null {
  if (diagnostics.length === 0) return null;
  const summary = diagnostics
    .map((diagnostic) =>
      t('contextDiagnosticProviderSummary', {
        provider: diagnostic.providerId,
        status: diagnostic.status,
        count: diagnostic.candidateCount,
      }),
    )
    .join(', ');
  return t('contextSearchDiagnostic', { summary });
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

interface QueryResultVerification {
  status: SourceCitation['status'];
  detail?: string;
  graphType?: SourceCitation['graphType'];
}

function isGraphVirtualSource(filePath: string): boolean {
  return filePath.startsWith(GRAPH_COMMUNITY_SOURCE_PREFIX);
}

function verifyGraphQueryResult(result: QueryResult): QueryResultVerification {
  if (result.entry.metadata.filePath.startsWith(GRAPH_COMMUNITY_SOURCE_PREFIX)) {
    return { status: 'verified', graphType: 'community' };
  }
  return { status: 'missing', detail: t('contextUnsupportedGraphRagSource') };
}

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
      preview: createPreview(content),
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
    preview: createPreview(content),
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

  const files = app.vault
    .getMarkdownFiles()
    .filter((file) => file.path.startsWith(`${path}/`))
    .slice(0, maxFolderFiles);
  const sourceIds: string[] = [];
  let partial =
    app.vault.getMarkdownFiles().filter((file) => file.path.startsWith(`${path}/`)).length >
    files.length;

  for (const file of files) {
    try {
      const content = await app.vault.cachedRead(file);
      const citation: SourceCitation = {
        id: `folder-${citations.length + 1}`,
        filePath: file.path,
        status: 'verified',
        preview: createPreview(content),
      };
      sourceIds.push(citation.id);
      const attachedFully = appendBlock({
        citation,
        text: `[Folder File: ${file.path}]\n${content}`,
      });
      if (!attachedFully) {
        partial = true;
        break;
      }
    } catch {
      partial = true;
    }
  }

  attachments.push({
    id: `folder:${path}`,
    type: 'folder',
    name: path,
    label: path,
    status: sourceIds.length === 0 ? 'missing' : partial ? 'partial' : 'attached',
    detail: partial ? t('contextFolderAttachedLimited', { count: maxFolderFiles }) : undefined,
    sourceIds,
  });
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
): Promise<void> {
  const [entities, relations] = await Promise.all([
    graphStore.getEntities(),
    graphStore.getRelations(),
  ]);

  const mentionedNames = new Set(entityMentions.map((m) => m.name.toLowerCase()));
  const matchedEntities = entities.filter(
    (e) =>
      mentionedNames.has(e.canonicalName.toLowerCase()) ||
      e.aliases.some((a) => mentionedNames.has(a.toLowerCase())),
  );

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

  const matchedIds = new Set(matchedEntities.map((e) => e.id));
  const matchedRelations = relations.filter(
    (r) => matchedIds.has(r.sourceEntityId) || matchedIds.has(r.targetEntityId),
  );

  const lines: string[] = [];
  lines.push('[Graph Knowledge Context]');
  lines.push('');
  lines.push('## Matched Entities');
  for (const entity of matchedEntities.slice(0, 10)) {
    const aliases = entity.aliases.length > 0 ? ` (aka ${entity.aliases.join(', ')})` : '';
    lines.push(`- [${entity.typeId}] ${entity.canonicalName}${aliases}`);
    if (entity.description) {
      lines.push(`  ${entity.description.slice(0, 200)}`);
    }
  }

  if (matchedRelations.length > 0) {
    lines.push('');
    lines.push('## Related Relations');
    const entityById = new Map(entities.map((e) => [e.id, e]));
    for (const rel of matchedRelations.slice(0, 15)) {
      const src = entityById.get(rel.sourceEntityId)?.canonicalName ?? rel.sourceEntityId;
      const tgt = entityById.get(rel.targetEntityId)?.canonicalName ?? rel.targetEntityId;
      lines.push(`- ${src} → [${rel.relationTypeId}] → ${tgt}`);
      if (rel.description) {
        lines.push(`  ${rel.description.slice(0, 150)}`);
      }
    }
  }

  const graphText = lines.join('\n');
  appendBlock({ text: graphText });

  const entityCitation = createGraphCitation(matchedEntities, citations.length + 1);
  citations.push(entityCitation);

  attachments.push({
    id: 'graph-rag:auto',
    type: 'graph-rag',
    name: 'auto',
    label: t('contextGraphRagEntitiesDetail', { count: matchedEntities.length }),
    status: 'attached',
    detail: t('contextGraphRagRelationsDetail', { count: matchedRelations.length }),
    sourceIds: [entityCitation.id],
  });
}

function createGraphCitation(entities: GraphEntityRecord[], index: number): SourceCitation {
  const names = entities.map((e) => e.canonicalName).join(', ');
  return {
    id: `graph-${index}`,
    filePath: `graph://entities`,
    status: 'verified',
    preview: `Graph entities: ${names.slice(0, 220)}`,
    graphType: 'entity',
  };
}

function createPreview(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 220);
}

function stringifyError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
