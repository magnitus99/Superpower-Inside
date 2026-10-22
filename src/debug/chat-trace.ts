import type { ChatMessageWithMeta } from '../chat/types';
import type { ChatTraceRuntimeSnapshot } from './chat-trace-runtime';
import type { IndexedReviewDiagnostics } from '../agent/indexed-vault-review';
import { DEBUG_TRACE_BUILD_ENABLED } from './build-flags';

/** 채팅 파일에 기록하는 추적 문서의 스키마 버전입니다. */
export const CHAT_DEBUG_TRACE_VERSION = 1;
/** 추적 섹션 제목입니다. 저장된 세션 파일에서 이 제목으로 검색합니다. */
export const CHAT_DEBUG_TRACE_HEADING = '#### Debug Trace';

const MAX_QUERY_RESULTS = 20;
const MAX_QUERY_DIAGNOSTICS = 8;
const MAX_TOOL_CALLS = 40;
const MAX_TEXT_CHARS = 600;
const MAX_TRACE_BYTES = 64 * 1024;
const MAX_UNMATCHED_TERMS = 40;

const SECRET_PATTERNS: readonly (readonly [RegExp, string])[] = [
  [/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{10,}/gu, '[redacted]'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{10,}/gu, 'Bearer [redacted]'],
  [
    /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|secret|password|authorization|cookie)\b["'\s:=]{1,4}[^\s"',}]{8,}/giu,
    '$1=[redacted]',
  ],
];

/** 비밀값 패턴을 지운 추적용 문자열을 만듭니다. */
export function redactTraceText(value: string): string {
  return SECRET_PATTERNS.reduce(
    (result, [pattern, replacement]) => result.replace(pattern, replacement),
    value,
  );
}

function clip(value: string, limit = MAX_TEXT_CHARS): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}…(+${value.length - limit})`;
}

function redactedClip(value: string | undefined, limit = MAX_TEXT_CHARS): string | undefined {
  if (value === undefined || value.length === 0) return undefined;
  return clip(redactTraceText(value), limit);
}

/** 추적에 함께 남기는 설정 스냅샷입니다. */
export interface ChatTraceConfigSnapshot {
  rag: {
    chunkSize: number;
    overlap: number;
    embeddingProvider: string;
    embeddingModel: string;
    minScore: number;
    enableBM25: boolean;
    bm25Weight: number;
    annEnabled: boolean;
    structuralGraphEnabled: boolean;
  };
  chat: {
    mcpToolExecutionPolicy: string;
    mcpServerCount: number;
    pluginAwareEnabled: boolean;
    autoSaveEnabled: boolean;
  };
}

interface ChatTraceTurn {
  messageId: string;
  status: string;
  providerKey?: string;
  providerLabel?: string;
  model?: string;
  stopReason?: string;
  turnStage?: string;
  toolRound?: number;
  errorKind?: string;
  errorMessage?: string;
}

interface ChatTraceInput {
  question?: string;
  questionChars?: number;
  assistantQuestion?: { question: string; options?: readonly string[] };
}

interface ChatTraceAttachment {
  id: string;
  type: string;
  status: string;
  label: string;
  actualChars?: number;
  estimatedChars?: number;
  excluded?: boolean;
  detail?: string;
}

interface ChatTraceContext {
  attachments: ChatTraceAttachment[];
  budget?: {
    maxChars: number;
    usedChars: number;
    remainingChars?: number;
    attachmentCount: number;
    citationCount: number;
    truncated: boolean;
    includedAttachmentIds: readonly string[];
    excludedAttachmentIds: readonly string[];
  };
  boundary?: {
    localOnly: readonly string[];
    sentToProvider: readonly string[];
    sentToMcp: readonly string[];
    privacyNotes: readonly string[];
    providerPayload?: Record<string, number | boolean | undefined>;
  };
}

interface ChatTraceProviderDiagnostic {
  providerId: string;
  source: string;
  status: string;
  readiness: string;
  durationMs: number;
  candidateCount: number;
  receivedCandidateCount?: number;
  skippedReason?: string;
  error?: string;
  consecutiveTimeouts?: number;
  cooldownRemainingMs?: number;
  ranking?: Record<string, number>;
}

interface ChatTraceRetrievalQuery {
  query: string;
  status?: string;
  diagnostics: ChatTraceProviderDiagnostic[];
  results: {
    filePath: string;
    line?: number;
    endLine?: number;
    bm25Score?: number;
    vectorScore?: number;
    selectionReason?: string;
  }[];
}

interface ChatTraceToolCall {
  name: string;
  serverName?: string;
  executionKind?: string;
  status: string;
  approved?: boolean;
  arguments?: string;
  resultChars?: number;
  resultSummary?: string;
  citationCount?: number;
}

interface ChatTraceAnswerBasis {
  contentChars: number;
  reasoningChars: number;
  citations: {
    filePath: string;
    line?: number;
    heading?: string;
    status?: string;
    score?: number;
    selectionReason?: string;
  }[];
  sourceWarnings: string[];
  coverageNotice?: string;
  noCitations: boolean;
  hasCoverageNotice: boolean;
}

interface ChatTraceReviewSearch {
  candidateDepth: number;
  candidateDocuments: number;
  candidateChunks: number;
  selectedDocuments: number;
  selectedChunks: number;
  truncated: boolean;
  droppedDocuments: { budget: number; belowThreshold: number; filtered: number };
  unmatchedTerms: string[];
  missingCandidatePaths: number;
  zeroHitReason: string | null;
}

interface ChatTraceReview {
  outcome?: string;
  counts: IndexedReviewDiagnostics['counts'];
  phases: IndexedReviewDiagnostics['phases'];
  search?: ChatTraceReviewSearch;
}

/** 채팅 세션 파일에 저장되는 한 턴의 추적 문서입니다. */
export interface ChatDebugTrace {
  version: number;
  generatedAt: string;
  session: { filePath?: string; title?: string };
  turn: ChatTraceTurn;
  input: ChatTraceInput;
  config: ChatTraceConfigSnapshot;
  context: ChatTraceContext;
  retrieval: { queries: ChatTraceRetrievalQuery[]; providerSummary: ChatTraceProviderDiagnostic[] };
  review?: ChatTraceReview;
  runtime?: ChatTraceRuntimeSnapshot;
  tools: ChatTraceToolCall[];
  llm: {
    rounds: number;
    toolRoundStatuses: string[];
    usage?: ChatMessageWithMeta['usageSnapshot'];
  };
  answerBasis: ChatTraceAnswerBasis;
  truncated?: true;
}

export interface ChatTraceBuildInput {
  message: ChatMessageWithMeta;
  previousUserMessage?: ChatMessageWithMeta;
  config: ChatTraceConfigSnapshot;
  session?: { filePath?: string; title?: string };
  runtime?: ChatTraceRuntimeSnapshot;
  now?: number;
}

/** 설정·빌드 플래그를 함께 확인해 추적 기록 여부를 결정합니다. */
export function shouldRecordChatTrace(
  chatTraceEnabled: boolean,
  buildEnabled: boolean = DEBUG_TRACE_BUILD_ENABLED,
): boolean {
  return buildEnabled && chatTraceEnabled;
}

function buildAttachments(message: ChatMessageWithMeta): ChatTraceAttachment[] {
  return (message.contextAttachments ?? []).map((attachment) => ({
    id: attachment.id,
    type: attachment.type,
    status: attachment.status,
    label: redactTraceText(attachment.label) ?? attachment.label,
    actualChars: attachment.actualChars,
    estimatedChars: attachment.estimatedChars,
    excluded: attachment.excluded,
    detail: redactedClip(attachment.detail),
  }));
}

function buildRetrieval(message: ChatMessageWithMeta): {
  queries: ChatTraceRetrievalQuery[];
  providerSummary: ChatTraceProviderDiagnostic[];
} {
  const queries = (message.retrievalTrace ?? []).map((record) => ({
    query: redactTraceText(record.query),
    status: record.status,
    diagnostics: record.diagnostics.slice(0, MAX_QUERY_DIAGNOSTICS).map((diagnostic) => ({
      providerId: diagnostic.providerId,
      source: diagnostic.source,
      status: diagnostic.status,
      readiness: diagnostic.readiness,
      durationMs: Math.round(diagnostic.durationMs),
      candidateCount: diagnostic.candidateCount,
      receivedCandidateCount: diagnostic.receivedCandidateCount,
      skippedReason: diagnostic.skippedReason,
      error: redactedClip(diagnostic.error, 200),
      consecutiveTimeouts: diagnostic.consecutiveTimeouts,
      cooldownRemainingMs: diagnostic.cooldownRemainingMs,
      ranking: diagnostic.ranking,
    })),
    results: record.results.slice(0, MAX_QUERY_RESULTS).map((result) => ({
      filePath: result.filePath,
      line: result.line,
      endLine: result.endLine,
      bm25Score: result.bm25Score,
      vectorScore: result.vectorScore,
      selectionReason: result.selectionReason,
    })),
  }));
  const seen = new Set<string>();
  const providerSummary: ChatTraceProviderDiagnostic[] = [];
  for (const query of queries) {
    for (const diagnostic of query.diagnostics) {
      if (seen.has(diagnostic.providerId)) continue;
      seen.add(diagnostic.providerId);
      providerSummary.push(diagnostic);
    }
  }
  return { queries, providerSummary };
}

function buildReview(message: ChatMessageWithMeta): ChatTraceReview | undefined {
  const diagnostics = message.indexedReviewDiagnostics;
  if (!diagnostics) return undefined;
  const search = diagnostics.search;
  return {
    outcome: diagnostics.outcome,
    counts: diagnostics.counts,
    phases: diagnostics.phases,
    search: search
      ? {
          candidateDepth: search.candidateDepth,
          candidateDocuments: search.candidateDocuments,
          candidateChunks: search.candidateChunks,
          selectedDocuments: search.selectedDocuments,
          selectedChunks: search.selectedChunks,
          truncated: search.truncated,
          droppedDocuments: {
            budget: search.droppedDocuments.budget,
            belowThreshold: search.droppedDocuments.belowThreshold,
            filtered: search.droppedDocuments.filtered,
          },
          unmatchedTerms: search.unmatchedTerms
            .slice(0, MAX_UNMATCHED_TERMS)
            .map((term) => redactTraceText(term)),
          missingCandidatePaths: search.missingCandidatePaths,
          zeroHitReason: search.zeroHitReason ? redactTraceText(search.zeroHitReason) : null,
        }
      : undefined,
  };
}

function buildTools(message: ChatMessageWithMeta): ChatTraceToolCall[] {
  return (message.toolCalls ?? []).slice(0, MAX_TOOL_CALLS).map((toolCall) => ({
    name: toolCall.name,
    serverName: toolCall.serverName,
    executionKind: toolCall.executionKind,
    status: toolCall.status,
    approved: toolCall.approved,
    arguments: redactedClip(toolCall.arguments, 300),
    resultChars: toolCall.result?.length,
    resultSummary: redactedClip(toolCall.resultSummary ?? toolCall.result, 300),
    citationCount: toolCall.citations?.length,
  }));
}

function buildAnswerBasis(message: ChatMessageWithMeta): ChatTraceAnswerBasis {
  const citations = (message.citations ?? []).map((citation) => ({
    filePath: citation.filePath,
    line: citation.line,
    heading: citation.heading,
    status: citation.status,
    score: citation.score,
    selectionReason: citation.selectionReason,
  }));
  return {
    contentChars: message.content.length,
    reasoningChars: message.reasoning?.length ?? 0,
    citations,
    sourceWarnings: (message.sourceWarnings ?? []).map(
      (warning) => `${redactTraceText(warning.label)}: ${redactTraceText(warning.detail)}`,
    ),
    coverageNotice: redactedClip(message.indexedReviewNotice, 800),
    noCitations: citations.length === 0,
    hasCoverageNotice: (message.indexedReviewNotice ?? '').length > 0,
  };
}

function trimToByteBudget(trace: ChatDebugTrace): ChatDebugTrace {
  if (JSON.stringify(trace).length <= MAX_TRACE_BYTES) return trace;
  return {
    ...trace,
    retrieval: { ...trace.retrieval, queries: [] },
    tools: trace.tools.slice(0, 5),
    truncated: true,
  };
}

/** 한 턴의 입력·검색·도구·답변 근거를 하나의 추적 문서로 묶습니다. */
export function buildChatDebugTrace(input: ChatTraceBuildInput): ChatDebugTrace {
  const { message, previousUserMessage, config, session } = input;
  const retrieval = buildRetrieval(message);
  const budget = message.contextBudgetSnapshot;
  const boundary = message.dataBoundarySnapshot;
  const trace: ChatDebugTrace = {
    version: CHAT_DEBUG_TRACE_VERSION,
    generatedAt: new Date(input.now ?? Date.now()).toISOString(),
    session: { filePath: session?.filePath, title: session?.title },
    turn: {
      messageId: message.id,
      status: message.status,
      providerKey: message.providerKey,
      providerLabel: message.providerLabel,
      model: message.model,
      stopReason: message.stopReason,
      turnStage: message.turnStage,
      toolRound: message.toolRound,
      errorKind: message.errorKind,
      errorMessage: redactedClip(message.errorMessage),
    },
    input: {
      question: redactedClip(previousUserMessage?.content, 2_000),
      questionChars: previousUserMessage?.content.length,
      assistantQuestion: message.assistantQuestion
        ? {
            question: redactTraceText(message.assistantQuestion.prompt),
            options: message.assistantQuestion.choices.map((choice) =>
              redactTraceText(choice.label),
            ),
          }
        : undefined,
    },
    config,
    context: {
      attachments: buildAttachments(message),
      budget: budget
        ? {
            maxChars: budget.maxChars,
            usedChars: budget.usedChars,
            remainingChars: budget.remainingChars,
            attachmentCount: budget.attachmentCount,
            citationCount: budget.citationCount,
            truncated: budget.truncated,
            includedAttachmentIds: budget.includedAttachmentIds ?? [],
            excludedAttachmentIds: budget.excludedAttachmentIds ?? [],
          }
        : undefined,
      boundary: boundary
        ? {
            localOnly: boundary.localOnly,
            sentToProvider: boundary.sentToProvider,
            sentToMcp: boundary.sentToMcp,
            privacyNotes: boundary.privacyNotes,
            providerPayload: boundary.providerPayload as
              | Record<string, number | boolean | undefined>
              | undefined,
          }
        : undefined,
    },
    retrieval,
    review: buildReview(message),
    runtime: input.runtime,
    tools: buildTools(message),
    llm: {
      rounds: message.toolRoundLogs?.length ?? 0,
      toolRoundStatuses: (message.toolRoundLogs ?? []).map((log) => `${log.round}:${log.status}`),
      usage: message.usageSnapshot,
    },
    answerBasis: buildAnswerBasis(message),
  };
  return trimToByteBudget(trace);
}

/** 추적 문서를 세션 파일에 넣을 Markdown 줄로 직렬화합니다. */
export function formatChatDebugTraceSection(trace: ChatDebugTrace): string[] {
  // JSON 문자열 안의 백틱 3개가 펜스를 닫지 않도록 이스케이프합니다.
  const body = JSON.stringify(trace, null, 2).replace(/```/gu, '\\u0060\\u0060\\u0060');
  return ['', CHAT_DEBUG_TRACE_HEADING, '', '```json', ...body.split('\n'), '```'];
}

/** 세션 파일 본문에서 추적 문서를 다시 읽습니다. 없으면 null입니다. */
export function extractChatDebugTrace(content: string): ChatDebugTrace | null {
  const headingIndex = content.indexOf(CHAT_DEBUG_TRACE_HEADING);
  if (headingIndex === -1) return null;
  const fenceStart = content.indexOf('```json', headingIndex);
  if (fenceStart === -1) return null;
  const bodyStart = content.indexOf('\n', fenceStart);
  if (bodyStart === -1) return null;
  const fenceEnd = content.indexOf('```', bodyStart + 1);
  if (fenceEnd === -1) return null;
  try {
    return JSON.parse(content.slice(bodyStart + 1, fenceEnd)) as ChatDebugTrace;
  } catch {
    return null;
  }
}
