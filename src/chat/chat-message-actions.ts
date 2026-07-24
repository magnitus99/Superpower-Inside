export const CHAT_MESSAGE_ACTION_ATTRIBUTE = 'data-chat-action-id';

export type ChatMessageActionId =
  | 'copy'
  | 'regenerate'
  | 'insert-into-note'
  | 'save-as-note'
  | 'branch'
  | 'edit-and-send'
  | 'error-diagnostics';

export interface ChatMessageActionRenderState {
  focusedActionId?: string;
  diagnosticsExpanded: boolean;
  diagnosticsContentId: string;
}

export function createChatMessageActionId(actionId: ChatMessageActionId): string {
  return `message:${actionId}`;
}

export function createRecoveryMessageActionId(actionId: string): string {
  return `recovery:${actionId}`;
}

export function createChatMessageActionRenderState(input: {
  messageId: string;
  focusedActionId?: string | null;
  diagnosticsExpanded?: string | null;
  legacyDiagnosticsOpen?: boolean;
  diagnosticsContentId?: string | null;
}): ChatMessageActionRenderState {
  const focusedActionId = input.focusedActionId?.trim() || undefined;
  const diagnosticsContentId =
    input.diagnosticsContentId?.trim() ||
    `superpower-inside-chat-error-diagnostics-${encodeURIComponent(input.messageId)}`;
  let diagnosticsExpanded = input.legacyDiagnosticsOpen ?? false;
  if (input.diagnosticsExpanded === 'true') {
    diagnosticsExpanded = true;
  } else if (input.diagnosticsExpanded === 'false') {
    diagnosticsExpanded = false;
  }
  return {
    focusedActionId,
    diagnosticsExpanded,
    diagnosticsContentId,
  };
}
