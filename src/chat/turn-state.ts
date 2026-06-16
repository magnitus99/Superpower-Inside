export type ChatTurnStage =
  | 'draft'
  | 'building-context'
  | 'waiting-provider'
  | 'streaming-reasoning'
  | 'streaming-answer'
  | 'planning-tools'
  | 'awaiting-tool-approval'
  | 'running-tools'
  | 'finalizing-after-tools'
  | 'complete'
  | 'cancelled'
  | 'error';

export type ChatTurnStopReason = 'complete' | 'cancelled' | 'error' | 'tool-failed';

export type ChatTurnMessageStatus = 'pending' | 'streaming' | 'complete' | 'error';

export interface ChatTurnState {
  stage: ChatTurnStage;
  canStop: boolean;
  canRetry: boolean;
  activeToolCalls: number;
  toolRound: number;
  stopReason?: ChatTurnStopReason;
  errorMessage?: string;
}

export type ChatTurnEvent =
  | { type: 'submit' }
  | { type: 'context-built' }
  | { type: 'reasoning-delta' }
  | { type: 'answer-delta' }
  | { type: 'tool-call-delta'; activeToolCalls?: number }
  | { type: 'await-tool-approval' }
  | { type: 'tools-running'; activeToolCalls?: number }
  | { type: 'tools-complete' }
  | { type: 'complete' }
  | { type: 'cancel' }
  | { type: 'tool-failure'; errorMessage?: string }
  | { type: 'error'; errorMessage?: string };

export function createChatTurnState(): ChatTurnState {
  return {
    stage: 'draft',
    canStop: false,
    canRetry: false,
    activeToolCalls: 0,
    toolRound: 0,
  };
}

export function transitionChatTurn(
  current: ChatTurnState,
  event: ChatTurnEvent,
): ChatTurnState {
  switch (event.type) {
    case 'submit':
      return runningState(current, 'building-context');
    case 'context-built':
      return runningState(current, 'waiting-provider');
    case 'reasoning-delta':
      return runningState(current, 'streaming-reasoning');
    case 'answer-delta':
      return runningState(current, 'streaming-answer');
    case 'tool-call-delta':
      return runningState(current, 'planning-tools', event.activeToolCalls ?? 1);
    case 'await-tool-approval':
      return {
        ...runningState(current, 'awaiting-tool-approval', current.activeToolCalls),
        canRetry: false,
      };
    case 'tools-running':
      return {
        ...runningState(current, 'running-tools', event.activeToolCalls ?? current.activeToolCalls),
        toolRound: current.toolRound + 1,
      };
    case 'tools-complete':
      return runningState(current, 'finalizing-after-tools', 0);
    case 'complete':
      return terminalState(current, 'complete', 'complete');
    case 'cancel':
      return terminalState(current, 'cancelled', 'cancelled');
    case 'tool-failure':
      return terminalState(current, 'error', 'tool-failed', event.errorMessage);
    case 'error':
      return terminalState(current, 'error', 'error', event.errorMessage);
    default:
      return current;
  }
}

export function isChatTurnTerminal(stage: ChatTurnStage): boolean {
  return stage === 'complete' || stage === 'cancelled' || stage === 'error';
}

export function getChatTurnStageStatus(stage: ChatTurnStage): ChatTurnMessageStatus {
  if (stage === 'error') return 'error';
  if (stage === 'complete' || stage === 'cancelled') return 'complete';
  if (stage === 'draft' || stage === 'awaiting-tool-approval') return 'pending';
  return 'streaming';
}

function runningState(
  current: ChatTurnState,
  stage: ChatTurnStage,
  activeToolCalls = current.activeToolCalls,
): ChatTurnState {
  return {
    ...current,
    stage,
    activeToolCalls: Math.max(0, activeToolCalls),
    canStop: true,
    canRetry: false,
    stopReason: undefined,
    errorMessage: undefined,
  };
}

function terminalState(
  current: ChatTurnState,
  stage: 'complete' | 'cancelled' | 'error',
  stopReason: ChatTurnStopReason,
  errorMessage?: string,
): ChatTurnState {
  return {
    ...current,
    stage,
    stopReason,
    errorMessage,
    activeToolCalls: 0,
    canStop: false,
    canRetry: stage !== 'complete',
  };
}
