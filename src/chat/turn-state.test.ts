import { describe, expect, it } from 'vitest';
import {
  createChatTurnState,
  getChatTurnStageStatus,
  isChatTurnTerminal,
  transitionChatTurn,
} from './turn-state';

describe('Chat turn state machine', () => {
  it('정상 스트리밍 답변 흐름을 명시적인 stage로 전이한다', () => {
    let state = createChatTurnState();
    state = transitionChatTurn(state, { type: 'submit' });
    expect(state.stage).toBe('building-context');
    state = transitionChatTurn(state, { type: 'context-built' });
    expect(state.stage).toBe('waiting-provider');
    state = transitionChatTurn(state, { type: 'answer-delta' });
    expect(state.stage).toBe('streaming-answer');
    state = transitionChatTurn(state, { type: 'complete' });

    expect(state).toMatchObject({
      stage: 'complete',
      stopReason: 'complete',
      activeToolCalls: 0,
    });
    expect(isChatTurnTerminal(state.stage)).toBe(true);
    expect(getChatTurnStageStatus(state.stage)).toBe('complete');
  });

  it('reasoning stream 이후 tool planning과 approval 대기로 전이한다', () => {
    let state = createChatTurnState();
    state = transitionChatTurn(state, { type: 'submit' });
    state = transitionChatTurn(state, { type: 'context-built' });
    state = transitionChatTurn(state, { type: 'reasoning-delta' });
    expect(state.stage).toBe('streaming-reasoning');
    state = transitionChatTurn(state, { type: 'tool-call-delta', activeToolCalls: 2 });
    expect(state).toMatchObject({ stage: 'planning-tools', activeToolCalls: 2 });
    state = transitionChatTurn(state, { type: 'await-tool-approval' });

    expect(state).toMatchObject({
      stage: 'awaiting-tool-approval',
      activeToolCalls: 2,
      canStop: true,
      canRetry: false,
    });
    expect(getChatTurnStageStatus(state.stage)).toBe('pending');
  });

  it('tool 실행과 final answer 이후 complete로 종료한다', () => {
    let state = createChatTurnState();
    state = transitionChatTurn(state, { type: 'tool-call-delta', activeToolCalls: 1 });
    state = transitionChatTurn(state, { type: 'tools-running', activeToolCalls: 1 });
    expect(state).toMatchObject({ stage: 'running-tools', toolRound: 1, activeToolCalls: 1 });
    state = transitionChatTurn(state, { type: 'tools-complete' });
    expect(state).toMatchObject({
      stage: 'finalizing-after-tools',
      toolRound: 1,
      activeToolCalls: 0,
    });
    state = transitionChatTurn(state, { type: 'complete' });

    expect(state).toMatchObject({
      stage: 'complete',
      stopReason: 'complete',
      activeToolCalls: 0,
    });
  });

  it('tool 실패와 provider 오류는 retry 가능한 terminal error로 종료한다', () => {
    const toolFailure = transitionChatTurn(
      transitionChatTurn(createChatTurnState(), { type: 'tools-running', activeToolCalls: 1 }),
      { type: 'tool-failure' },
    );
    const providerError = transitionChatTurn(createChatTurnState(), {
      type: 'error',
      errorMessage: 'provider failed',
    });

    expect(toolFailure).toMatchObject({
      stage: 'error',
      stopReason: 'tool-failed',
      activeToolCalls: 0,
      canRetry: true,
    });
    expect(providerError).toMatchObject({
      stage: 'error',
      stopReason: 'error',
      errorMessage: 'provider failed',
      canRetry: true,
    });
  });

  it('취소 후에는 running tool call이나 streaming status가 남지 않는다', () => {
    const state = transitionChatTurn(
      transitionChatTurn(createChatTurnState(), { type: 'tools-running', activeToolCalls: 3 }),
      { type: 'cancel' },
    );

    expect(state).toMatchObject({
      stage: 'cancelled',
      stopReason: 'cancelled',
      activeToolCalls: 0,
      canStop: false,
      canRetry: true,
    });
    expect(getChatTurnStageStatus(state.stage)).toBe('complete');
  });
});
