import type { ChatMessage } from '../llm/providers';

/** 기록 중인 툴 호출 상태 */
export interface ToolCallRecord {
	id: string;
	name: string;
	arguments: string;
	result?: string;
	status: 'running' | 'success' | 'error';
}

/** 메시지 메타데이터를 포함한 채팅 메시지 */
export interface ChatMessageWithMeta extends ChatMessage {
	id: string;
	timestamp: number;
	reasoning?: string;
	toolCalls?: ToolCallRecord[];
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
	messageCount: number;
}

/** 자동 저장 설정 */
export interface AutoSaveConfig {
	enabled: boolean;
	debounceMs: number;
}