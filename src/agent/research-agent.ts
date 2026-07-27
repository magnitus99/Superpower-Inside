import type { ChatMessage, ChatOptions, ToolDefinition } from '../llm/providers';
import {
  deriveResearchCoverageReceiptRust,
  isWholeVaultResearchIntentRust,
  planContextBudgetAppendRust,
  planFolderLexicalEvidenceIndicesRust,
  planResearchAnswerContractRust,
  planResearchCandidateSelectionRust,
  planResearchProviderLedgerTransitionRust,
  planResearchProviderRequestBudgetRust,
  planResearchRequestFailureRust,
  planResearchSummaryBatchesRust,
  type RustResearchCandidateSelectionPlan,
  type RustResearchCoverageReceipt,
  type RustResearchInventoryPageInput,
  type RustResearchProviderLedgerTransitionInput,
  type RustResearchProviderLedgerReason,
  type RustResearchProviderRequestBudgetPlan,
} from '../rag/rust-core';
import type { SourceCitation } from '../chat/types';
import { getLanguage, t } from '../i18n';
import type { NativeVaultToolRuntimeLike } from './native-vault-tool';
import { selectAnswerCitations } from './citation-selection';

const LIST_PAGE_SIZE = 100;
const LOCAL_READ_CONCURRENCY = 8;
const PROVIDER_MAX_CHARS_PER_FILE = 9_000;
const PROVIDER_BATCH_MAX_CHARS = 80_000;
const SEGMENT_PLAN_BUDGET = {
  maxSelectedItems: 1,
  batchSize: 1,
  maxBatches: 1,
} as const;

export interface VaultResearchModel {
  chat(
    messages: ChatMessage[],
    temperature?: number,
    tools?: ToolDefinition[],
    options?: ChatOptions,
  ): Promise<string>;
}

export type VaultResearchPhase = 'inventory' | 'map' | 'reduce' | 'complete';

export interface VaultResearchProgress {
  phase: VaultResearchPhase;
  completedFiles: number;
  totalFiles: number;
  currentPath?: string;
}

export interface VaultResearchRunOptions {
  question: string;
  previousUserQuestions?: readonly string[];
  signal?: AbortSignal;
  onProgress?: (progress: VaultResearchProgress) => void;
}

export interface VaultResearchProviderTransfer {
  sentFiles: number;
  sentSegments: number;
  sentChars: number;
}

export interface VaultResearchResult {
  content: string;
  citations: SourceCitation[];
  processedFiles: number;
  totalFiles: number;
  failedFiles: string[];
  selection: RustResearchCandidateSelectionPlan;
  coverage: RustResearchCoverageReceipt;
  providerTransfer: VaultResearchProviderTransfer;
  providerRequestBudget: RustResearchProviderRequestBudgetPlan;
}

export interface VaultResearchAgentDependencies {
  wait?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
}

interface VaultFileInventoryItem {
  path: string;
  modifiedAt: number;
  size: number;
}

interface VaultListPayload {
  action: 'list';
  files: VaultFileInventoryItem[];
  nextCursor: number | null;
  total: number;
}

interface VaultReadPayload {
  action: 'read';
  path: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  truncated: boolean;
  content: string;
}

interface VaultInventory {
  files: VaultFileInventoryItem[];
  pages: RustResearchInventoryPageInput[];
  reportedTotal: number;
}

interface ScreenedFileEvidence {
  fileIndex: number;
  file: VaultFileInventoryItem;
  content: string;
  citations: SourceCitation[];
  retainedSegmentCount: number;
  providerOmitted: boolean;
}

interface LocalScreenResult {
  evidenceByIndex: Array<ScreenedFileEvidence | undefined>;
  unreadableIndices: number[];
  failedFiles: string[];
}

interface ResearchSummary {
  label: string;
  content: string;
  evidenceIndices: number[];
}

type ProviderRequestPhase = 'map' | 'reduce' | 'final' | 'repair';

interface ProviderRequestLedger {
  budget: RustResearchProviderRequestBudgetPlan;
  mapRequests: number;
  reductionRequests: number;
  finalRequests: number;
  repairRequests: number;
  providerAttempts: number;
  retryWaitMs: number;
  closedPhases: Set<ProviderRequestPhase>;
}

export function isWholeVaultResearchRequest(question: string): boolean {
  return isWholeVaultResearchIntentRust(question) === true;
}

export function getVaultResearchPhaseLabel(phase: VaultResearchPhase): string {
  switch (phase) {
    case 'inventory':
      return t('vaultResearchPhaseInventory');
    case 'map':
      return t('vaultResearchPhaseMap');
    case 'reduce':
      return t('vaultResearchPhaseReduce');
    case 'complete':
      return t('vaultResearchPhaseComplete');
  }
}

export class VaultResearchAgent {
  private readonly wait: (delayMs: number, signal?: AbortSignal) => Promise<void>;

  constructor(
    private readonly model: VaultResearchModel,
    private readonly vaultTool: NativeVaultToolRuntimeLike,
    dependencies: VaultResearchAgentDependencies = {},
  ) {
    this.wait = dependencies.wait ?? waitForDelay;
  }

  async run(options: VaultResearchRunOptions): Promise<VaultResearchResult> {
    throwIfAborted(options.signal);
    const previousUserQuestions = [...(options.previousUserQuestions ?? [])];
    options.onProgress?.({ phase: 'inventory', completedFiles: 0, totalFiles: 0 });
    const inventory = await this.listAllFiles(options.signal);
    const localScreen = await this.screenFilesLocally(
      inventory.files,
      options.question,
      previousUserQuestions,
      options,
    );
    const selection = requireCandidateSelection({
      currentQuestion: options.question,
      previousUserQuestions,
      paths: inventory.files.map((file) => file.path),
      samples: inventory.files.map(
        (_file, index) => localScreen.evidenceByIndex[index]?.content ?? '',
      ),
    });
    const providerRequestBudget = requireProviderRequestBudget(selection);
    const requestLedger = createProviderRequestLedger(providerRequestBudget);
    const selectedEvidence = selection.selectedIndices.flatMap((index) => {
      const evidence = localScreen.evidenceByIndex[index];
      return evidence ? [evidence] : [];
    });

    options.onProgress?.({
      phase: 'reduce',
      completedFiles: inventory.files.length,
      totalFiles: inventory.files.length,
    });
    const { summaries, transfer, failedIndices } = await this.analyzeSelectedEvidence(
      selectedEvidence,
      selection,
      options.question,
      previousUserQuestions,
      requestLedger,
      options.signal,
    );
    closeProviderRequestPhase(requestLedger, 'map');
    const finalSummaries = await this.reduceToBoundedSummaries(
      summaries,
      options.question,
      selection.providerBudget.batchSize,
      requestLedger,
      options.signal,
    );
    closeProviderRequestPhase(requestLedger, 'reduce');
    const transferredIndices = selectedEvidence.map((evidence) => evidence.fileIndex);
    const finalAnalyzedIndexSet = new Set(
      finalSummaries.flatMap((summary) => summary.evidenceIndices),
    );
    const analyzedIndices = selection.selectedIndices.filter((index) =>
      finalAnalyzedIndexSet.has(index),
    );
    const citationsById = new Map<string, SourceCitation>();
    for (const evidence of selectedEvidence) {
      if (!finalAnalyzedIndexSet.has(evidence.fileIndex)) continue;
      for (const citation of evidence.citations) citationsById.set(citation.id, citation);
    }
    const providerOmittedIndices = selection.selectedIndices.filter((index) => {
      const evidence = localScreen.evidenceByIndex[index];
      return !evidence || evidence.providerOmitted || !finalAnalyzedIndexSet.has(index);
    });
    const coverage = deriveResearchCoverageReceiptRust({
      inventory: {
        paths: inventory.files.map((file) => file.path),
        total: inventory.reportedTotal,
      },
      pages: inventory.pages,
      localScreen: {
        screenedIndices: inventory.files.map((_file, index) => index),
        selectedIndices: selection.selectedIndices,
        matchedCandidateCount: selection.matchedCandidateCount,
        unreadableIndices: localScreen.unreadableIndices,
        omittedIndices: [],
      },
      providerTransfer: {
        transferredIndices,
        analyzedIndices,
        omittedIndices: providerOmittedIndices,
        failedIndices,
        omittedCandidateCount: selection.omittedCandidateCount,
      },
    });
    if (!coverage) throw new Error(t('vaultResearchContractUnavailable'));

    const generatedContent =
      finalSummaries.length === 0
        ? this.createNoEvidenceContent(selection, coverage)
        : await this.createFinalAnswer(
            finalSummaries,
            options.question,
            previousUserQuestions,
            selection,
            coverage,
            requestLedger,
            options.signal,
          );
    const processedFiles = inventory.files.length - localScreen.failedFiles.length;
    const content = `${formatCoverageStatement(coverage, processedFiles)}\n\n${generatedContent}`;
    const citations = selectAnswerCitations(content, [...citationsById.values()], 0);
    options.onProgress?.({
      phase: 'complete',
      completedFiles: inventory.files.length,
      totalFiles: inventory.files.length,
    });
    return {
      content,
      citations,
      processedFiles,
      totalFiles: inventory.files.length,
      failedFiles: localScreen.failedFiles,
      selection,
      coverage,
      providerTransfer: transfer,
      providerRequestBudget,
    };
  }

  private async listAllFiles(signal?: AbortSignal): Promise<VaultInventory> {
    const files: VaultFileInventoryItem[] = [];
    const pages: RustResearchInventoryPageInput[] = [];
    let cursor = 0;
    let reportedTotal: number | undefined;
    while (true) {
      throwIfAborted(signal);
      const result = await this.vaultTool.execute(
        JSON.stringify({ action: 'list', cursor, limit: LIST_PAGE_SIZE }),
        signal,
      );
      const payload = parseListPayload(result.modelText);
      reportedTotal ??= payload.total;
      pages.push({
        cursor,
        paths: payload.files.map((file) => file.path),
        total: payload.total,
        nextCursor: payload.nextCursor,
      });
      files.push(...payload.files);
      if (payload.nextCursor === null) {
        return { files, pages, reportedTotal };
      }
      if (payload.nextCursor <= cursor) throw new Error(t('vaultResearchListStalled'));
      cursor = payload.nextCursor;
    }
  }

  private async screenFilesLocally(
    files: readonly VaultFileInventoryItem[],
    question: string,
    previousUserQuestions: readonly string[],
    options: VaultResearchRunOptions,
  ): Promise<LocalScreenResult> {
    const controller = new AbortController();
    const abort = (): void => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) controller.abort();
    const evidenceByIndex = new Array<ScreenedFileEvidence | undefined>(files.length);
    const unreadableByIndex = new Array<boolean>(files.length).fill(false);
    let nextIndex = 0;
    let completedFiles = 0;
    let fatalError: unknown;
    const worker = async (): Promise<void> => {
      while (true) {
        throwIfAborted(controller.signal);
        const index = nextIndex++;
        if (index >= files.length) return;
        const file = files[index];
        if (!file) continue;
        options.onProgress?.({
          phase: 'map',
          completedFiles,
          totalFiles: files.length,
          currentPath: file.path,
        });
        try {
          evidenceByIndex[index] = await this.screenFile(
            index,
            file,
            question,
            previousUserQuestions,
            controller.signal,
          );
        } catch (error) {
          if (error instanceof VaultResearchFileReadError) {
            unreadableByIndex[index] = true;
          } else {
            fatalError ??= error;
            controller.abort();
            throw error;
          }
        } finally {
          completedFiles++;
        }
      }
    };
    try {
      await Promise.all(
        Array.from({ length: Math.min(LOCAL_READ_CONCURRENCY, files.length) }, () => worker()),
      );
    } catch (error) {
      throw fatalError ?? error;
    } finally {
      options.signal?.removeEventListener('abort', abort);
    }
    return {
      evidenceByIndex,
      unreadableIndices: unreadableByIndex.flatMap((unreadable, index) =>
        unreadable ? [index] : [],
      ),
      failedFiles: unreadableByIndex.flatMap((unreadable, index) => {
        const file = files[index];
        return unreadable && file ? [file.path] : [];
      }),
    };
  }

  private async screenFile(
    fileIndex: number,
    file: VaultFileInventoryItem,
    question: string,
    previousUserQuestions: readonly string[],
    signal?: AbortSignal,
  ): Promise<ScreenedFileEvidence | undefined> {
    const citationsById = new Map<string, SourceCitation>();
    const retainedParts: string[] = [];
    const segmentSelectionBasis = requireCandidateSelection({
      currentQuestion: question,
      previousUserQuestions,
      paths: [file.path],
      samples: [''],
      providerBudget: SEGMENT_PLAN_BUDGET,
    });
    const segmentQuery = segmentSelectionBasis.terms.join(' ');
    const includeAllSegments = segmentSelectionBasis.selectionMode === 'bounded-inventory-sample';
    let retainedChars = 0;
    let retainedSegmentCount = 0;
    let providerOmitted = false;
    let startLine = 1;
    while (true) {
      throwIfAborted(signal);
      let result;
      let payload: VaultReadPayload;
      try {
        result = await this.vaultTool.execute(
          JSON.stringify({ action: 'read', path: file.path, start_line: startLine }),
          signal,
        );
        payload = parseReadPayload(result.modelText);
      } catch (error) {
        if (isAbortError(error)) throw error;
        throw new VaultResearchFileReadError(file.path, error);
      }
      if (includeAllSegments || requireSegmentContentMatch(segmentQuery, payload.content)) {
        const sourceIds = result.citations.map((citation) => citation.id).join(', ');
        const prefix = `${[
          `[Lines ${payload.startLine}-${payload.endLine}]`,
          sourceIds ? `Source IDs: ${sourceIds}` : '',
        ]
          .filter(Boolean)
          .join('\n')}\n`;
        const separator = retainedParts.length > 0 ? '\n\n' : '';
        const part = `${separator}${prefix}${payload.content}`;
        const transferPlan = planContextBudgetAppendRust(
          PROVIDER_MAX_CHARS_PER_FILE - retainedChars,
          part,
        );
        if (!transferPlan) throw new Error(t('vaultResearchBatchPlanFailed'));
        const contentOffset = separator.length + prefix.length;
        if (transferPlan.appended && transferPlan.text.length > contentOffset) {
          retainedParts.push(transferPlan.text);
          retainedChars += transferPlan.text.length;
          retainedSegmentCount++;
          for (const citation of result.citations) citationsById.set(citation.id, citation);
        }
        if (!transferPlan.complete) providerOmitted = true;
      }
      if (!payload.truncated || payload.endLine >= payload.totalLines) break;
      startLine = payload.endLine + 1;
    }
    if (retainedSegmentCount === 0) return undefined;
    return {
      fileIndex,
      file,
      content: retainedParts.join(''),
      citations: [...citationsById.values()],
      retainedSegmentCount,
      providerOmitted,
    };
  }

  private async analyzeSelectedEvidence(
    selectedEvidence: readonly ScreenedFileEvidence[],
    selection: RustResearchCandidateSelectionPlan,
    question: string,
    previousUserQuestions: readonly string[],
    requestLedger: ProviderRequestLedger,
    signal?: AbortSignal,
  ): Promise<{
    summaries: ResearchSummary[];
    transfer: VaultResearchProviderTransfer;
    failedIndices: number[];
  }> {
    if (selectedEvidence.length === 0) {
      return {
        summaries: [],
        transfer: { sentFiles: 0, sentSegments: 0, sentChars: 0 },
        failedIndices: [],
      };
    }
    const batches = planResearchSummaryBatchesRust(
      selectedEvidence.map((evidence) => evidence.content.length),
      selection.providerBudget.batchSize,
      PROVIDER_BATCH_MAX_CHARS,
    );
    if (
      !batches ||
      batches.length === 0 ||
      batches.length > selection.providerBudget.maxBatches ||
      batches.length > requestLedger.budget.maxMapRequests
    ) {
      throw new Error(t('vaultResearchBatchPlanFailed'));
    }
    const summaries: ResearchSummary[] = [];
    const failedIndices: number[] = [];
    for (const [batchIndex, batch] of batches.entries()) {
      throwIfAborted(signal);
      const documents = batch.flatMap((index) => {
        const evidence = selectedEvidence[index];
        return evidence ? [evidence] : [];
      });
      consumeProviderRequest(requestLedger, 'map');
      let content: string;
      try {
        content = await this.requestModel(
          [
            'Analyze this locally selected vault-evidence batch.',
            'Use only supplied document text. Preserve relevant [vault:...] source IDs.',
            'Extract facts, relationships, contradictions, decisions, and uncertainty relevant to the question.',
            'This is a bounded evidence batch. Do not claim that the whole vault was read or that material is absent.',
            `Question: ${question}`,
            previousUserQuestions.length > 0
              ? `Immediate conversation context: ${previousUserQuestions.join('\n')}`
              : '',
            ...documents.map((evidence) =>
              [
                `[Document ${evidence.file.path}]`,
                `Source IDs: ${evidence.citations.map((citation) => citation.id).join(', ')}`,
                evidence.content,
              ].join('\n'),
            ),
          ]
            .filter(Boolean)
            .join('\n\n'),
          requestLedger,
          signal,
        );
      } catch (error) {
        if (!(error instanceof VaultResearchProviderBudgetExhaustedError)) throw error;
        failedIndices.push(...documents.map((evidence) => evidence.fileIndex));
        continue;
      }
      summaries.push({
        label: `evidence-batch-${batchIndex + 1}`,
        content,
        evidenceIndices: documents.map((evidence) => evidence.fileIndex),
      });
    }
    return {
      summaries,
      transfer: {
        sentFiles: selectedEvidence.length,
        sentSegments: selectedEvidence.reduce(
          (total, evidence) => total + evidence.retainedSegmentCount,
          0,
        ),
        sentChars: selectedEvidence.reduce((total, evidence) => total + evidence.content.length, 0),
      },
      failedIndices: uniqueSortedIndices(failedIndices),
    };
  }

  private async reduceToBoundedSummaries(
    summaries: readonly ResearchSummary[],
    question: string,
    maxItems: number,
    requestLedger: ProviderRequestLedger,
    signal?: AbortSignal,
  ): Promise<ResearchSummary[]> {
    let current = [...summaries];
    while (current.length > 0) {
      throwIfAborted(signal);
      const transferPlan = planContextBudgetAppendRust(
        PROVIDER_BATCH_MAX_CHARS,
        formatResearchSummaryBlocks(current),
      );
      if (!transferPlan) throw new Error(t('vaultResearchBatchPlanFailed'));
      if (transferPlan.complete) return current;

      const batches = planResearchSummaryBatchesRust(
        current.map((summary) => formatResearchSummaryBlock(summary).length + 2),
        maxItems,
        PROVIDER_BATCH_MAX_CHARS,
      );
      if (!batches || batches.length === 0) {
        throw new Error(t('vaultResearchBatchPlanFailed'));
      }
      const remainingReductionRequests = getRemainingProviderRequests(requestLedger, 'reduce');
      if (remainingReductionRequests === 0) {
        return selectFinalSummariesWithinBudget(current);
      }
      const processedBatches = batches.slice(0, remainingReductionRequests);
      const next: ResearchSummary[] = [];
      for (const [batchIndex, batch] of processedBatches.entries()) {
        throwIfAborted(signal);
        const selected = batch.flatMap((index) => {
          const summary = current[index];
          return summary ? [summary] : [];
        });
        consumeProviderRequest(requestLedger, 'reduce');
        let content: string;
        try {
          content = await this.requestModel(
            [
              'Compress the following research summary batch without losing evidence.',
              'Preserve facts, relationships, contradictions, uncertainty, and source IDs directly relevant to the question.',
              `Question: ${question}`,
              formatResearchSummaryBlocks(selected),
            ].join('\n\n'),
            requestLedger,
            signal,
          );
        } catch (error) {
          if (!(error instanceof VaultResearchProviderBudgetExhaustedError)) throw error;
          return selectFinalSummariesWithinBudget(current);
        }
        next.push({
          label: `reduce-${batchIndex + 1}`,
          content,
          evidenceIndices: uniqueSortedIndices(
            selected.flatMap((summary) => summary.evidenceIndices),
          ),
        });
      }
      for (const index of batches.slice(processedBatches.length).flat()) {
        const summary = current[index];
        if (summary) next.push(summary);
      }
      current = next;
    }
    return current;
  }

  private async createFinalAnswer(
    summaries: readonly ResearchSummary[],
    question: string,
    previousUserQuestions: readonly string[],
    selection: RustResearchCandidateSelectionPlan,
    coverage: RustResearchCoverageReceipt,
    requestLedger: ProviderRequestLedger,
    signal?: AbortSignal,
  ): Promise<string> {
    const summaryTransferPlan = planContextBudgetAppendRust(
      PROVIDER_BATCH_MAX_CHARS,
      formatResearchSummaryBlocks(summaries),
    );
    if (!summaryTransferPlan?.complete) throw new Error(t('vaultResearchBatchPlanFailed'));
    consumeProviderRequest(requestLedger, 'final');
    let generated: string;
    try {
      generated = await this.requestModel(
        [
          'Write the final answer to the user question using only the evidence digests below.',
          'Clearly distinguish local vault evidence from uncertainty.',
          'Preserve supplied [vault:...] source IDs on evidence-backed statements.',
          'Do not claim that every file was read. Local screening and provider analysis are different.',
          'Do not add folder, tag, or note-organization suggestions unless the user explicitly requested them.',
          `Question: ${question}`,
          previousUserQuestions.length > 0
            ? `Immediate conversation context: ${previousUserQuestions.join('\n')}`
            : '',
          `Selection plan: ${JSON.stringify({
            mode: selection.selectionMode,
            matchedCandidates: selection.matchedCandidateCount,
            analyzedCandidates: coverage.providerAnalyzedCount,
            omittedCandidates: coverage.providerOmittedCount,
          })}`,
          `Coverage receipt: ${JSON.stringify(coverage)}`,
          'Evidence digests:',
          summaryTransferPlan.text,
        ]
          .filter(Boolean)
          .join('\n\n'),
        requestLedger,
        signal,
      );
    } catch (error) {
      if (!(error instanceof VaultResearchProviderBudgetExhaustedError)) throw error;
      return t('vaultResearchAnswerContractFallback');
    }
    return this.enforceAnswerContract(generated, coverage, requestLedger, signal);
  }

  private async enforceAnswerContract(
    answer: string,
    coverage: RustResearchCoverageReceipt,
    requestLedger: ProviderRequestLedger,
    signal?: AbortSignal,
  ): Promise<string> {
    const language = getLanguage();
    const firstPlan = planResearchAnswerContractRust({ answer, language, receipt: coverage });
    if (!firstPlan) throw new Error(t('vaultResearchContractUnavailable'));
    if (firstPlan.allowed) return answer;
    consumeProviderRequest(requestLedger, 'repair');
    let repaired: string;
    try {
      repaired = await this.requestModel(
        [
          'Rewrite the answer so every coverage claim matches the supplied contract.',
          'Keep supported evidence and source IDs, but remove unverified whole-vault reading and absence claims.',
          `Violations: ${firstPlan.violationCodes.join(', ')}`,
          `Required coverage wording: ${firstPlan.safeCoverageText}`,
          `Coverage receipt: ${JSON.stringify(coverage)}`,
          'Answer to repair:',
          answer,
        ].join('\n\n'),
        requestLedger,
        signal,
      );
    } catch (error) {
      if (!(error instanceof VaultResearchProviderBudgetExhaustedError)) throw error;
      return t('vaultResearchAnswerContractFallback');
    }
    const secondPlan = planResearchAnswerContractRust({
      answer: repaired,
      language,
      receipt: coverage,
    });
    if (!secondPlan) throw new Error(t('vaultResearchContractUnavailable'));
    return secondPlan.allowed ? repaired : t('vaultResearchAnswerContractFallback');
  }

  private createNoEvidenceContent(
    selection: RustResearchCandidateSelectionPlan,
    coverage: RustResearchCoverageReceipt,
  ): string {
    if (!coverage.exactNegativeAllowed) return t('vaultResearchEvidenceInconclusive');
    return t('vaultResearchNoMatchingEvidence', {
      terms: selection.terms.join(', ') || '—',
    });
  }

  private async requestModel(
    prompt: string,
    requestLedger: ProviderRequestLedger,
    signal?: AbortSignal,
  ): Promise<string> {
    for (let failedAttempt = 0; ; failedAttempt++) {
      throwIfAborted(signal);
      applyProviderLedgerTransition(requestLedger, {
        kind: 'attempt',
        retryDelayMs: 0,
      });
      try {
        const content = await this.model.chat(
          [
            {
              role: 'system',
              content:
                'You are the internal research engine for an Obsidian vault. Use only supplied evidence, preserve source IDs, and never invent coverage.',
            },
            { role: 'user', content: prompt },
          ],
          0.2,
          undefined,
          { signal },
        );
        if (!content.trim()) throw new Error(t('vaultResearchEmptySummary'));
        return content.trim();
      } catch (error) {
        if (isAbortError(error)) throw error;
        const plan = planResearchRequestFailureRust({
          message: error instanceof Error ? error.message : String(error),
          status: getNumericErrorField(error, 'status'),
          failedAttempt,
          retryAfterMs: getNumericErrorField(error, 'retryAfterMs'),
        });
        if (!plan) throw new Error(t('vaultResearchFailurePlanFailed'));
        if (!plan.retryable) throw error;
        applyProviderLedgerTransition(
          requestLedger,
          {
            kind: 'retry-wait',
            retryDelayMs: plan.retryDelayMs,
          },
          error,
        );
        await this.wait(plan.retryDelayMs, signal);
      }
    }
  }
}

class VaultResearchProviderBudgetExhaustedError extends Error {
  constructor(
    readonly reason: RustResearchProviderLedgerReason,
    cause?: unknown,
  ) {
    super(`Vault research provider budget exhausted: ${reason}`, { cause });
    this.name = 'VaultResearchProviderBudgetExhaustedError';
  }
}

class VaultResearchFileReadError extends Error {
  constructor(
    readonly path: string,
    cause: unknown,
  ) {
    super(`Could not read vault file: ${path}`, { cause });
    this.name = 'VaultResearchFileReadError';
  }
}

function requireCandidateSelection(
  input: Parameters<typeof planResearchCandidateSelectionRust>[0],
): RustResearchCandidateSelectionPlan {
  const plan = planResearchCandidateSelectionRust(input);
  if (!plan) throw new Error(t('vaultResearchContractUnavailable'));
  return plan;
}

function requireProviderRequestBudget(
  selection: RustResearchCandidateSelectionPlan,
): RustResearchProviderRequestBudgetPlan {
  const plan = planResearchProviderRequestBudgetRust({
    providerBatchCount: selection.providerBatchCount,
    providerBudget: selection.providerBudget,
  });
  if (!plan) throw new Error(t('vaultResearchContractUnavailable'));
  return plan;
}

function createProviderRequestLedger(
  budget: RustResearchProviderRequestBudgetPlan,
): ProviderRequestLedger {
  return {
    budget,
    mapRequests: 0,
    reductionRequests: 0,
    finalRequests: 0,
    repairRequests: 0,
    providerAttempts: 0,
    retryWaitMs: 0,
    closedPhases: new Set(),
  };
}

function getRemainingProviderRequests(
  ledger: ProviderRequestLedger,
  phase: ProviderRequestPhase,
): number {
  if (ledger.closedPhases.has(phase)) return 0;
  switch (phase) {
    case 'map':
      return Math.max(0, ledger.budget.maxMapRequests - ledger.mapRequests);
    case 'reduce':
      return Math.max(0, ledger.budget.maxReductionRequests - ledger.reductionRequests);
    case 'final':
      return Math.max(0, ledger.budget.reservedFinalRequests - ledger.finalRequests);
    case 'repair':
      return Math.max(0, ledger.budget.reservedRepairRequests - ledger.repairRequests);
  }
}

function closeProviderRequestPhase(
  ledger: ProviderRequestLedger,
  phase: ProviderRequestPhase,
): void {
  ledger.closedPhases.add(phase);
}

function getRemainingLogicalProviderRequests(ledger: ProviderRequestLedger): number {
  return (
    getRemainingProviderRequests(ledger, 'map') +
    getRemainingProviderRequests(ledger, 'reduce') +
    getRemainingProviderRequests(ledger, 'final') +
    getRemainingProviderRequests(ledger, 'repair')
  );
}

function applyProviderLedgerTransition(
  ledger: ProviderRequestLedger,
  event: RustResearchProviderLedgerTransitionInput['event'],
  cause?: unknown,
): void {
  const plan = planResearchProviderLedgerTransitionRust({
    maxProviderAttempts: ledger.budget.maxProviderAttempts,
    maxRetryWaitMs: ledger.budget.maxRetryWaitMs,
    providerAttempts: ledger.providerAttempts,
    retryWaitMs: ledger.retryWaitMs,
    remainingLogicalRequests: getRemainingLogicalProviderRequests(ledger),
    event,
  });
  if (!plan) throw new Error(t('vaultResearchContractUnavailable'));
  if (!plan.allowed) {
    if (!plan.reason) throw new Error(t('vaultResearchContractUnavailable'));
    throw new VaultResearchProviderBudgetExhaustedError(plan.reason, cause);
  }
  ledger.providerAttempts = plan.providerAttempts;
  ledger.retryWaitMs = plan.retryWaitMs;
}

function consumeProviderRequest(ledger: ProviderRequestLedger, phase: ProviderRequestPhase): void {
  const usedRequests =
    ledger.mapRequests + ledger.reductionRequests + ledger.finalRequests + ledger.repairRequests;
  if (
    getRemainingProviderRequests(ledger, phase) === 0 ||
    usedRequests >= ledger.budget.maxRequests
  ) {
    throw new Error(t('vaultResearchBatchPlanFailed'));
  }
  switch (phase) {
    case 'map':
      ledger.mapRequests += 1;
      return;
    case 'reduce':
      ledger.reductionRequests += 1;
      return;
    case 'final':
      ledger.finalRequests += 1;
      return;
    case 'repair':
      ledger.repairRequests += 1;
  }
}

function requireSegmentContentMatch(query: string, content: string): boolean {
  const indices = planFolderLexicalEvidenceIndicesRust(query, [`\n${content}`], 1, 'any');
  if (!indices) throw new Error(t('vaultResearchContractUnavailable'));
  return indices.includes(0);
}

function formatResearchSummaryBlock(summary: ResearchSummary): string {
  return `[${summary.label}]\n${summary.content}`;
}

function formatResearchSummaryBlocks(summaries: readonly ResearchSummary[]): string {
  return summaries.map(formatResearchSummaryBlock).join('\n\n');
}

function selectFinalSummariesWithinBudget(
  summaries: readonly ResearchSummary[],
): ResearchSummary[] {
  const selected: ResearchSummary[] = [];
  let remainingChars = PROVIDER_BATCH_MAX_CHARS;
  for (const summary of summaries) {
    const block = `${selected.length > 0 ? '\n\n' : ''}${formatResearchSummaryBlock(summary)}`;
    const transferPlan = planContextBudgetAppendRust(remainingChars, block);
    if (!transferPlan) throw new Error(t('vaultResearchBatchPlanFailed'));
    if (!transferPlan.complete) continue;
    selected.push(summary);
    remainingChars = transferPlan.remainingChars;
  }
  return selected;
}

function uniqueSortedIndices(indices: readonly number[]): number[] {
  return [...new Set(indices)].sort((left, right) => left - right);
}

function formatCoverageStatement(
  coverage: RustResearchCoverageReceipt,
  processedFiles: number,
): string {
  return coverage.wholeVaultLocallyScreened && coverage.allSelectedEvidenceAnalyzed
    ? t('vaultResearchCoverageComplete', {
        total: coverage.inventoryCount,
        selected: coverage.providerAnalyzedCount,
      })
    : t('vaultResearchCoverageLimited', {
        screened: processedFiles,
        total: coverage.inventoryCount,
        selected: coverage.providerAnalyzedCount,
      });
}

function parseListPayload(modelText: string): VaultListPayload {
  const parsed: unknown = JSON.parse(modelText);
  if (!isRecord(parsed) || parsed.action !== 'list' || !Array.isArray(parsed.files)) {
    throw new Error(t('vaultResearchInvalidListResult'));
  }
  const files = parsed.files.filter(isVaultFileInventoryItem);
  if (files.length !== parsed.files.length) {
    throw new Error(t('vaultResearchInvalidListItem'));
  }
  if (
    !(parsed.nextCursor === null || isNonNegativeInteger(parsed.nextCursor)) ||
    !isNonNegativeInteger(parsed.total)
  ) {
    throw new Error(t('vaultResearchInvalidListPage'));
  }
  return { action: 'list', files, nextCursor: parsed.nextCursor, total: parsed.total };
}

function parseReadPayload(modelText: string): VaultReadPayload {
  const parsed: unknown = JSON.parse(modelText);
  if (
    !isRecord(parsed) ||
    parsed.action !== 'read' ||
    typeof parsed.path !== 'string' ||
    !isNonNegativeInteger(parsed.startLine) ||
    !isNonNegativeInteger(parsed.endLine) ||
    !isNonNegativeInteger(parsed.totalLines) ||
    typeof parsed.truncated !== 'boolean' ||
    typeof parsed.content !== 'string'
  ) {
    throw new Error(t('vaultResearchInvalidReadResult'));
  }
  return {
    action: 'read',
    path: parsed.path,
    startLine: parsed.startLine,
    endLine: parsed.endLine,
    totalLines: parsed.totalLines,
    truncated: parsed.truncated,
    content: parsed.content,
  };
}

function isVaultFileInventoryItem(value: unknown): value is VaultFileInventoryItem {
  return (
    isRecord(value) &&
    typeof value.path === 'string' &&
    isNonNegativeInteger(value.modifiedAt) &&
    isNonNegativeInteger(value.size)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException(t('vaultResearchCancelled'), 'AbortError');
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function getNumericErrorField(
  error: unknown,
  field: 'status' | 'retryAfterMs',
): number | undefined {
  if (!(error instanceof Error) || !(field in error)) return undefined;
  const value = (error as Error & Partial<Record<typeof field, unknown>>)[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function waitForDelay(delayMs: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, delayMs);
    const abort = (): void => {
      window.clearTimeout(timeoutId);
      reject(new DOMException(t('vaultResearchCancelled'), 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}
