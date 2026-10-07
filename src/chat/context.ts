import { TFile, TFolder, type App } from 'obsidian';
import { t } from '../i18n';
import type { MCPRegistry } from '../mcp/registry';
import type { QueryResult } from '../rag/query';
import type { RetrievalProviderDiagnostic } from '../rag/retrieval-pipeline';
import { readSourceFileSnapshot } from '../rag/source-snapshot';
import { isSourceRevisionCurrentRust } from '../rag/rust-core';
import {
  planChatContextMentionsRust,
  planContextSourcesRust,
  planChatEvidenceRust,
  planChatUniqueResultIndicesRust,
  planFolderLexicalEvidenceIndicesRust,
  planFolderMentionFilesRust,
  planImplicitFolderQueryPathsRust,
  type RustAutoRagReason,
  type RustContextSourceInput,
  type RustContextSourceVerification,
} from '../rag/rust-core';
import type { ContextAttachment, FolderLimitReason, SourceCitation } from './types';
import { createContextBudget, type ContextBlock } from './context-budget';
import { createContextBudgetSnapshot } from './context-composer';
import { expandReferencedVaultFiles } from './context-expansion';
import { parseMentions, type MentionResolver } from './mention-parser';
import { appLogger } from '../utils/logger';
import { selectByRustIndices } from '../utils/rust-index-plan';
import { isRagIndexableFile } from '../utils/vault';
import { captureWorkspaceMentionFiles, type WorkspaceMentionFiles } from './workspace-mentions';
export {
  parseMentions,
  shouldUseAutoRagForMentions,
  type MentionResolver,
  type ParsedMention,
} from './mention-parser';

export interface RagQueryLike {
  query(
    question: string,
    topK: number,
    minScore?: number,
    filePathPrefixes?: readonly string[],
  ): Promise<QueryResult[]>;
  getLastRetrievalDiagnostics?(): RetrievalProviderDiagnostic[];
}

export interface ContextBuildResult {
  systemPrompt: string | null;
  attachments: ContextAttachment[];
  citations: SourceCitation[];
  warnings: string[];
  contextBudgetSnapshot?: import('./types').ContextBudgetSnapshot;
}

export async function resolveChatRagEngine(
  skipAutoRag: boolean,
  prepare: () => Promise<unknown>,
  getEngine: () => RagQueryLike | null,
): Promise<RagQueryLike | null> {
  if (skipAutoRag) return null;
  await prepare();
  return getEngine();
}

interface BuildContextOptions {
  app: App;
  workspaceFiles?: WorkspaceMentionFiles;
  candidatePaths?: ReadonlySet<string>;
  ragEngine?: RagQueryLike | null;
  mcpRegistry?: MCPRegistry | null;
  maxFolderFiles?: number;
  maxContextChars?: number;
  maxReferenceFiles?: number;
  ragTopK?: number;
  ragMinScore?: number;
  queryExpander?: (question: string) => Promise<string>;
  /** 활성 도구 루프가 후보 검색·읽기를 맡을 때 비싼 암시적 폴더 전체 선별을 건너뜁니다. */
  deferImplicitFolderEvidenceToTools?: boolean;
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

interface AppendedEvidence {
  complete: boolean;
  actualChars: number;
  sourceIds: string[];
}

type AppendEvidence = (
  source: RustContextSourceInput,
  prefix: string,
  label: string,
  remainingSources?: number,
) => AppendedEvidence;

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
  const attachedPaths = new Set<string>();
  const warnings: string[] = [];
  const resolver = createAppMentionResolver(
    options.app,
    options.mcpRegistry,
    options.workspaceFiles,
  );
  const mentions = parseMentions(question, resolver);
  const mentionPlan = planChatContextMentionsRust(mentions.map((mention) => mention.type)) ?? {
    fileIndices: [],
    folderIndices: [],
    serverIndices: [],
    useAutoRag: false,
    autoRagReason: 'disabled',
  };
  const shouldUseAutoRag = mentionPlan.useAutoRag;
  const expandedQuery =
    options.queryExpander && (shouldUseAutoRag || mentionPlan.folderIndices.length > 0)
      ? await options.queryExpander(question).catch((error: unknown) => {
          if (error instanceof DOMException && error.name === 'AbortError') throw error;
          return question;
        })
      : question;

  const appendBlock = (block: ContextBlock): boolean => {
    return budget.append({
      ...block,
      text: `${budget.getBlocks().length > 0 ? '\n\n---\n\n' : ''}${block.text}`,
    });
  };
  const appendEvidence: AppendEvidence = (source, prefix, label, remainingSources = 1) => {
    const plan = planChatEvidenceRust({
      question: expandedQuery,
      source,
      sourceId: `${prefix}-${citations.length + 1}`,
      label,
      remainingSources,
      maxChars: budget.getRemainingChars(),
    });
    const sourceIds: string[] = [];
    const before = budget.getRemainingChars();
    for (const block of plan?.blocks ?? []) {
      if (!appendBlock({ text: block.text })) break;
      const citation = plan?.citations.find((item) => item.id === block.sourceId);
      if (citation) {
        citations.push(citation);
        sourceIds.push(citation.id);
        attachedPaths.add(citation.filePath);
      }
    }
    return {
      complete: plan?.complete === true && sourceIds.length === plan.sourceIds.length,
      actualChars: before - budget.getRemainingChars(),
      sourceIds,
    };
  };

  const explicitFiles = selectByRustIndices(mentions, mentionPlan.fileIndices, { dedupe: true });
  const explicitFolders = selectByRustIndices(mentions, mentionPlan.folderIndices, {
    dedupe: true,
  });
  const fileResults: Array<{ file: TFile; content: string }> = [];
  const requestedPaths = new Set<string>();
  for (const [index, mention] of explicitFiles.entries()) {
    if (requestedPaths.has(mention.name)) continue;
    requestedPaths.add(mention.name);
    const fileResult = await appendFileMention(
      mention.name,
      options.app,
      appendEvidence,
      attachments,
      options.candidatePaths,
      explicitFiles.length - index + explicitFolders.length,
    );
    if (!fileResult) continue;
    fileResults.push(fileResult);
  }

  for (const [index, mention] of explicitFolders.entries()) {
    await appendFolderMention(
      mention.name,
      options.app,
      appendEvidence,
      attachments,
      maxFolderFiles,
      options.candidatePaths,
      expandedQuery,
      options.ragEngine,
      explicitFolders.length - index - 1,
    );
  }

  for (const fileResult of fileResults) {
    const expansion = await expandReferencedVaultFiles(
      fileResult.file,
      fileResult.content,
      options.app,
      maxReferenceFiles,
      options.candidatePaths,
    );
    warnings.push(...expansion.warnings);
    for (const reference of expansion.references) {
      if (attachedPaths.has(reference.file.path)) continue;
      appendReferenceFile(reference.file, reference.content, appendEvidence, attachments);
      attachedPaths.add(reference.file.path);
    }
  }

  const explicitFolderPaths = new Set(
    selectByRustIndices(mentions, mentionPlan.folderIndices, { dedupe: true }).map(
      (mention) => mention.name,
    ),
  );
  const implicitFolderPaths =
    shouldUseAutoRag && options.deferImplicitFolderEvidenceToTools !== true
      ? (
          planImplicitFolderQueryPathsRust(question, collectTopLevelFolderPaths(options.app)) ?? []
        ).filter((path) => !explicitFolderPaths.has(path))
      : [];
  if (implicitFolderPaths.length > 0) {
    for (const folderPath of implicitFolderPaths) {
      await appendImplicitFolderEvidence(
        folderPath,
        expandedQuery,
        options.app,
        appendEvidence,
        attachments,
        Math.min(3, maxFolderFiles),
        options.candidatePaths,
      );
    }
  }
  const hasImplicitFolderEvidence = attachments.some(
    (attachment) =>
      attachment.id.startsWith('folder:auto:') && (attachment.sourceIds?.length ?? 0) > 0,
  );

  if (options.ragEngine && shouldUseAutoRag && !hasImplicitFolderEvidence) {
    try {
      let results = await options.ragEngine.query(expandedQuery, ragTopK, options.ragMinScore);
      if (results.length === 0) {
        const fallbackCandidates = await options.ragEngine.query(expandedQuery, ragTopK * 3, 0);
        const fallbackIndices =
          planFolderLexicalEvidenceIndicesRust(
            expandedQuery,
            fallbackCandidates.map(
              (result) =>
                `${result.entry.metadata.filePath}\n${result.entry.metadata.heading ?? ''}\n${result.entry.metadata.text}`,
            ),
            ragTopK,
            'any',
          ) ?? [];
        results = selectByRustIndices(fallbackCandidates, fallbackIndices, {
          dedupe: true,
        });
      }
      const deduped = dedupeQueryResults(results);
      const uniqueResults = selectByRustIndices(
        deduped,
        planChatUniqueResultIndicesRust(
          deduped.map(contextSourceInputFromQueryResult),
          citations,
        ) ?? [],
        { dedupe: true },
      ).filter(
        (result) =>
          !options.candidatePaths || options.candidatePaths.has(result.entry.metadata.filePath),
      );
      const sourceInputs: RustContextSourceInput[] = [];
      const verifications: RustContextSourceVerification[] = [];
      for (const result of uniqueResults) {
        const verified = await verifyQueryResult(result, options.app);
        sourceInputs.push(contextSourceInputFromQueryResult(result));
        verifications.push(verified);
      }
      const sourcePlan = planContextSourcesRust(
        sourceInputs,
        verifications,
        citations.length + 1,
        'rag',
      ) ?? { citations: [], blocks: [], sourceIds: [], rejectedCount: 0 };
      citations.push(...sourcePlan.citations.filter((citation) => citation.status !== 'verified'));
      const ragSourceIds: string[] = [];
      let ragChars = 0;
      let ragPartial = false;
      for (const [index, source] of sourceInputs.entries()) {
        if (verifications[index]?.status !== 'verified') continue;
        const result = appendEvidence(source, 'rag', 'Source');
        ragSourceIds.push(...result.sourceIds);
        ragChars += result.actualChars;
        ragPartial ||= !result.complete;
      }
      const diagnosticsText = formatRetrievalDiagnostics(
        options.ragEngine.getLastRetrievalDiagnostics?.() ?? [],
      );
      attachments.push({
        id: 'rag:auto',
        type: 'rag',
        name: 'auto',
        label: t('contextAutoRagDetail', { count: ragSourceIds.length }),
        status: ragPartial ? 'partial' : ragSourceIds.length > 0 ? 'attached' : 'low-relevance',
        alreadyAttached: results.length > 0 && uniqueResults.length === 0,
        detail:
          ragSourceIds.length > 0
            ? combineAttachmentDetails([
                formatAutoRagReason(mentionPlan.autoRagReason),
                sourcePlan.rejectedCount > 0
                  ? t('contextRejectedCandidatesExcluded', { count: sourcePlan.rejectedCount })
                  : null,
                diagnosticsText,
              ])
            : combineAttachmentDetails([
                results.length > 0 && uniqueResults.length === 0
                  ? t('contextRagAlreadyAttached')
                  : sourcePlan.rejectedCount > 0
                    ? t('contextRejectedCandidatesExcluded', { count: sourcePlan.rejectedCount })
                    : uniqueResults.length > 0
                      ? t('contextFolderPartialBudget')
                      : t('contextNoRelevantDocs'),
                diagnosticsText,
              ]),
        reason: t('contextAutoRagTitle'),
        estimatedChars: sourcePlan.blocks.reduce((total, block) => total + block.text.length, 0),
        actualChars: ragChars,
        sourceIds: ragSourceIds,
        excluded: ragPartial && ragSourceIds.length === 0,
        autoRagReason: mentionPlan.autoRagReason,
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

  for (const mention of selectByRustIndices(mentions, mentionPlan.serverIndices, {
    dedupe: true,
  })) {
    await appendServerMention(mention.name, options.mcpRegistry, appendBlock, attachments);
  }

  const contextText = budget
    .getBlocks()
    .map((block) => block.text)
    .filter(Boolean)
    .join('');
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

async function appendImplicitFolderEvidence(
  folderPath: string,
  expandedQuery: string,
  app: App,
  appendEvidence: AppendEvidence,
  attachments: ContextAttachment[],
  topK: number,
  candidatePaths?: ReadonlySet<string>,
): Promise<void> {
  const prefix = `${folderPath}/`;
  const folderFiles = app.vault
    .getFiles()
    .filter(
      (file) => file.path.startsWith(prefix) && (!candidatePaths || candidatePaths.has(file.path)),
    );
  const indexableFlags = await Promise.all(
    folderFiles.map((file) => isRagIndexableFile(app.vault, file)),
  );
  const indexableFiles = folderFiles.filter((_file, index) => indexableFlags[index] === true);
  const readable = (
    await Promise.all(
      indexableFiles.map(async (file) => {
        try {
          return { file, content: await app.vault.cachedRead(file) };
        } catch {
          return null;
        }
      }),
    )
  ).filter((item): item is { file: TFile; content: string } => item !== null);
  const selected = selectByRustIndices(
    readable,
    planFolderLexicalEvidenceIndicesRust(
      expandedQuery,
      readable.map(({ file, content }) => `${file.path}\n${content}`),
      topK,
      'any',
    ) ?? undefined,
    { dedupe: true },
  );
  const sourceIds: string[] = [];
  let attachedChars = 0;
  let partial = false;

  for (const [index, { file, content }] of selected.entries()) {
    const result = appendEvidence(
      { filePath: file.path, text: content },
      'folder-auto',
      'Automatically selected vault file',
      selected.length - index,
    );
    sourceIds.push(...result.sourceIds);
    attachedChars += result.actualChars;
    partial ||= !result.complete;
  }

  attachments.push({
    id: `folder:auto:${folderPath}`,
    type: 'folder',
    name: folderPath,
    label: t('contextImplicitFolderDetail', { name: folderPath, count: sourceIds.length }),
    status: partial ? 'partial' : sourceIds.length === 0 ? 'missing' : 'attached',
    detail:
      sourceIds.length === 0
        ? t('contextImplicitFolderNoMatch', { name: folderPath })
        : t('contextImplicitFolderReason', { name: folderPath }),
    reason: t('contextAutoRagTitle'),
    estimatedChars: selected.reduce((total, item) => total + item.content.length, 0),
    actualChars: attachedChars,
    excluded: partial && sourceIds.length === 0,
    fileCount: sourceIds.length,
    filteredCount: Math.max(0, indexableFiles.length - selected.length),
    sourceIds,
    folderLimitReason: partial ? 'budget' : undefined,
  });
}

function collectTopLevelFolderPaths(app: App): string[] {
  const folders = new Set<string>();
  for (const file of app.vault.getFiles()) {
    const topLevel = file.path.split('/')[0]?.trim();
    if (topLevel && file.path.includes('/')) folders.add(topLevel);
  }
  return [...folders].sort();
}

function dedupeQueryResults(results: readonly QueryResult[]): QueryResult[] {
  const seen = new Set<string>();
  return results.filter((result) => {
    if (seen.has(result.entry.id)) return false;
    seen.add(result.entry.id);
    return true;
  });
}

export function createAppMentionResolver(
  app: App,
  registry?: MCPRegistry | null,
  workspaceFiles?: WorkspaceMentionFiles,
): MentionResolver {
  return {
    workspaceFiles: workspaceFiles ?? captureWorkspaceMentionFiles(app),
    isServer: (name: string) =>
      registry ? registry.getEnabledServers().some((server) => server.name === name) : false,
    isFile: (name: string) => app.vault.getAbstractFileByPath(name) instanceof TFile,
    isFolder: (name: string) => app.vault.getAbstractFileByPath(name) instanceof TFolder,
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
  const snapshot = await readSourceFileSnapshot(app.vault, file);
  if (
    !snapshot ||
    !isSourceRevisionCurrentRust(
      {
        filePath: metadata.filePath,
        sourceMtime: metadata.sourceMtime,
        sourceSize: metadata.sourceSize,
        contentHash: metadata.contentHash,
      },
      snapshot.revision,
    )
  ) {
    return { status: 'stale', detail: t('contextHashChanged') };
  }
  const content = snapshot.content;
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
  appendEvidence: AppendEvidence,
  attachments: ContextAttachment[],
  candidatePaths?: ReadonlySet<string>,
  remainingSources = 1,
): Promise<{ file: TFile; content: string } | null> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile) || (candidatePaths && !candidatePaths.has(file.path))) {
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
    const result = appendEvidence(
      { filePath: file.path, text: content },
      'file',
      'File',
      remainingSources,
    );
    attachments.push({
      id: `file:${file.path}`,
      type: 'file',
      name: file.path,
      label: file.path,
      status: result.complete ? 'attached' : 'partial',
      detail: result.complete ? undefined : t('contextPartialBudget'),
      reason: t('chatFileMentionChip', { name: file.path }),
      estimatedChars: content.length,
      actualChars: result.actualChars,
      pinned: true,
      sourceIds: result.sourceIds,
      excluded: result.sourceIds.length === 0,
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
  appendEvidence: AppendEvidence,
  attachments: ContextAttachment[],
): void {
  const result = appendEvidence(
    { filePath: file.path, text: content },
    'reference',
    'Reference File',
  );
  attachments.push({
    id: `reference:${file.path}`,
    type: 'reference',
    name: file.path,
    label: file.path,
    status: result.complete ? 'attached' : 'partial',
    detail: result.complete ? undefined : t('contextPartialBudget'),
    reason: t('chatFileMentionChip', { name: file.path }),
    estimatedChars: content.length,
    actualChars: result.actualChars,
    sourceIds: result.sourceIds,
    excluded: result.sourceIds.length === 0,
  });
}

async function appendFolderMention(
  path: string,
  app: App,
  appendEvidence: AppendEvidence,
  attachments: ContextAttachment[],
  maxFolderFiles: number,
  candidatePaths?: ReadonlySet<string>,
  question = '',
  ragEngine?: RagQueryLike | null,
  remainingFolders = 0,
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

  const folderPrefix = `${path}/`;
  const folderFiles = app.vault
    .getFiles()
    .filter(
      (file) =>
        file.path.startsWith(folderPrefix) && (!candidatePaths || candidatePaths.has(file.path)),
    );
  const indexableFlags = await Promise.all(
    folderFiles.map((file) => isRagIndexableFile(app.vault, file)),
  );
  const indexableFiles = folderFiles.filter((_file, index) => indexableFlags[index] === true);
  const filePlan = planFolderMentionFilesRust(
    path,
    indexableFiles.map((file) => file.path),
    maxFolderFiles,
  );
  let files = selectByRustIndices(indexableFiles, filePlan?.indices, { dedupe: true });
  // 작은 폴더는 그대로 첨부하고, 제한된 폴더는 기존 검색으로 질문에 맞는 원문을 우선합니다.
  if (filePlan?.partial && question) {
    const results = ragEngine
      ? await ragEngine.query(question, maxFolderFiles, undefined, [path]).catch(() => [])
      : [];
    const filesByPath = new Map(indexableFiles.map((file) => [file.path, file]));
    const rankedFiles = [
      ...new Map(
        results.flatMap((result) => {
          const file = filesByPath.get(result.entry.metadata.filePath);
          return file ? [[file.path, file] as const] : [];
        }),
      ).values(),
    ];
    if (rankedFiles.length > 0) {
      const rankedPlan = planFolderMentionFilesRust(
        path,
        rankedFiles.map((file) => file.path),
        maxFolderFiles,
      );
      files = selectByRustIndices(rankedFiles, rankedPlan?.indices, { dedupe: true });
    } else {
      const samples: string[] = [];
      for (let offset = 0; offset < indexableFiles.length; offset += 8) {
        samples.push(
          ...(await Promise.all(
            indexableFiles
              .slice(offset, offset + 8)
              .map(
                async (file) => `${file.path}\n${await app.vault.cachedRead(file).catch(() => '')}`,
              ),
          )),
        );
      }
      const indices =
        planFolderLexicalEvidenceIndicesRust(question, samples, maxFolderFiles, 'any') ?? [];
      if (indices.length > 0)
        files = selectByRustIndices(indexableFiles, indices, { dedupe: true });
    }
  }
  const sourceIds: string[] = [];
  let partial = filePlan?.partial ?? false;
  let folderLimitReason: FolderLimitReason | undefined =
    filePlan?.limitReason === 'max-files' ? 'max-files' : undefined;
  let readErrorCount = 0;
  let actualChars = 0;

  for (const [index, file] of files.entries()) {
    try {
      const content = await app.vault.cachedRead(file);
      const result = appendEvidence(
        { filePath: file.path, text: content },
        'folder',
        'Folder File',
        files.length - index + remainingFolders,
      );
      sourceIds.push(...result.sourceIds);
      actualChars += result.actualChars;
      if (!result.complete) {
        partial = true;
        folderLimitReason = 'budget';
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
    status: partial ? 'partial' : sourceIds.length === 0 ? 'missing' : 'attached',
    detail: partial
      ? formatFolderPartialDetail(folderLimitReason, maxFolderFiles, readErrorCount)
      : undefined,
    reason: t('chatFolderMentionChip', { name: path }),
    fileCount: files.length,
    filteredCount: filePlan?.matchedCount ? Math.max(0, filePlan.matchedCount - files.length) : 0,
    sourceIds,
    actualChars,
    excluded: sourceIds.length === 0,
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

function stringifyError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
