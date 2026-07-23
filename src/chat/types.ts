import type { ChatMessage } from '../llm/providers';
import type { ProviderCapabilitySnapshot } from '../llm/provider-capabilities';
import type { ChatTurnStage } from './turn-state';

/** 기록 중인 툴 호출 상태 */
export interface ToolCallRecord {
  id: string;
  name: string;
  arguments: string;
  result?: string;
  resultSummary?: string;
  normalizedResult?: string;
  status: 'running' | 'success' | 'error';
  serverName?: string;
  approved?: boolean;
  executionKind?: 'native' | 'mcp';
  citations?: SourceCitation[];
}

/** 채팅 메시지의 저장/표시 상태 */
export type ChatMessageStatus = 'pending' | 'streaming' | 'complete' | 'error';

export type ChatStopReason = 'complete' | 'cancelled' | 'error' | 'tool-failed';

export type ChatErrorKind =
  | 'auth'
  | 'rate-limit'
  | 'network'
  | 'timeout'
  | 'provider-response'
  | 'context-build'
  | 'tool-not-found'
  | 'tool-failed'
  | 'source-validation'
  | 'unknown';

export interface AssistantQuestionChoice {
  id: string;
  label: string;
}

export interface AssistantQuestion {
  prompt: string;
  choices: AssistantQuestionChoice[];
  selectionMode: 'single' | 'multiple';
  allowFreeText: boolean;
  source: 'answer' | 'reasoning-leak';
}

export type SourceSelectionReason =
  | 'strong-graph-evidence'
  | 'graph-structural-evidence'
  | 'keyword-vector'
  | 'keyword'
  | 'vector'
  | 'hybrid';

export type AutoRagReason =
  | 'no-mentions'
  | 'server-only'
  | 'server-and-vault'
  | 'vault-mention'
  | 'implicit'
  | 'disabled';

export type FolderLimitReason = 'max-files' | 'budget' | 'read-error';

export interface SourceCitation {
  id: string;
  filePath: string;
  heading?: string;
  line?: number;
  endLine?: number;
  score?: number;
  vectorScore?: number;
  bm25Score?: number;
  status?: 'candidate' | 'verified' | 'missing' | 'stale' | 'low-relevance';
  detail?: string;
  preview: string;
  previewTruncated?: boolean;
  selectionReason?: SourceSelectionReason;
  graphType?: 'entity' | 'relation' | 'community';
}

export interface SourceValidationWarning {
  id: string;
  label: string;
  detail: string;
  kind: 'missing-link' | 'unverified-source';
}

export interface ContextAttachment {
  id: string;
  type: 'file' | 'folder' | 'reference' | 'rag' | 'graph-rag' | 'mcp-server';
  name: string;
  label: string;
  status: 'attached' | 'partial' | 'missing' | 'error' | 'low-relevance';
  detail?: string;
  sourceIds?: string[];
  reason?: string;
  estimatedChars?: number;
  actualChars?: number;
  pinned?: boolean;
  excluded?: boolean;
  fileCount?: number;
  filteredCount?: number;
  autoRagReason?: AutoRagReason;
  folderLimitReason?: FolderLimitReason;
}

export type ChatAction =
  | 'retry'
  | 'regenerate'
  | 'edit'
  | 'branch'
  | 'insert'
  | 'save-note'
  | 'copy';

export type ChatActionHistoryAction =
  | ChatAction
  | 'tool-approved'
  | 'tool-rejected'
  | 'resumed'
  | 'cancelled';

export interface ToolRoundLog {
  round: number;
  toolCallIds: string[];
  status: 'planned' | 'running' | 'complete' | 'error';
  startedAt?: string;
  completedAt?: string;
  errorMessage?: string;
}

export interface ContextBudgetSnapshot {
  maxChars: number;
  usedChars: number;
  remainingChars?: number;
  attachmentCount: number;
  citationCount: number;
  truncated: boolean;
  includedAttachmentIds?: string[];
  excludedAttachmentIds?: string[];
}

export interface DataBoundarySnapshot {
  providerLabel?: string;
  model?: string;
  localOnly: string[];
  sentToProvider: string[];
  sentToMcp: string[];
  privacyNotes: string[];
}

export interface ChatActionHistoryEntry {
  id: string;
  action: ChatActionHistoryAction;
  at: string;
  detail?: string;
}

export interface ToolExecutionPolicy {
  mode: 'mentioned-auto' | 'always-manual' | 'always-auto';
  manualApproval?: boolean;
  allowlist?: string[];
  trustedMentionedServers?: string[];
  dangerousToolNamePatterns?: string[];
}

/** 메시지 메타데이터를 포함한 채팅 메시지 */
export interface ChatMessageWithMeta extends Omit<ChatMessage, 'toolCalls'> {
  id: string;
  schemaVersion?: number;
  /** legacy 저장 파일 호환용 타임스탬프 */
  timestamp: number;
  createdAt: string;
  updatedAt: string;
  providerKey?: string;
  providerLabel?: string;
  model?: string;
  status: ChatMessageStatus;
  errorMessage?: string;
  reasoning?: string;
  toolCalls?: ToolCallRecord[];
  citations?: SourceCitation[];
  sourceWarnings?: SourceValidationWarning[];
  contextAttachments?: ContextAttachment[];
  assistantQuestion?: AssistantQuestion;
  branchOf?: string;
  branchRoot?: string;
  variantOf?: string;
  stopReason?: ChatStopReason;
  originalContent?: string;
  providerCapability?: ProviderCapabilitySnapshot;
  turnStage?: ChatTurnStage;
  toolRound?: number;
  toolRoundLogs?: ToolRoundLog[];
  contextBudgetSnapshot?: ContextBudgetSnapshot;
  dataBoundarySnapshot?: DataBoundarySnapshot;
  errorKind?: ChatErrorKind;
  actionHistory?: ChatActionHistoryEntry[];
}

/** 저장된 세션 데이터 (파일에서 로드) */
export interface ChatSession {
  systemPrompt?: string;
  title?: string;
  messages: ChatMessageWithMeta[];
}

/** 런타임 세션 상태 (현재 작업 중인 세션 추적) */
export interface SessionState {
  /** 볼트 내 상대 경로 (.md 파일), 미저장 시 null */
  filePath: string | null;
  /** 세션 제목 (첫 사용자 메시지에서 자동 생성 또는 사용자 지정) */
  title: string;
  /** 마지막 저장 이후 변경 사항이 있으면 true */
  isDirty: boolean;
}

/** 세션 목록용 경량 메타데이터 (전체 파일 파싱 없이 frontmatter만 읽음) */
export interface ChatSessionMeta {
  filePath: string;
  title: string;
  created: string;
  updated?: string;
  messageCount: number;
  /** 첫 번째 사용자 메시지 미리보기 (최대 120자) */
  preview?: string;
  /** 마지막으로 사용된 프로바이더 라벨 */
  provider?: string;
  /** 마지막으로 사용된 모델명 */
  model?: string;
}

/** 자동 저장 설정 */
export interface AutoSaveConfig {
  enabled: boolean;
  debounceMs: number;
}
