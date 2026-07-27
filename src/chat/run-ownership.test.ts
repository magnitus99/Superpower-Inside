import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import {
  isChatRunActive,
  isChatRunOwner,
  planChatRunFinalization,
  type ChatRunHandle,
} from './run-ownership';

interface TestController {
  readonly label: string;
}

function createRun(token: number, label: string): ChatRunHandle<TestController> {
  return {
    token,
    controller: { label },
  };
}

interface TestAbortController {
  readonly label: string;
  readonly signal: { aborted: boolean };
}

function createAbortRun(token: number, label: string): ChatRunHandle<TestAbortController> {
  return {
    token,
    controller: {
      label,
      signal: { aborted: false },
    },
  };
}

describe('chat run ownership', () => {
  it('취소된 A의 늦은 finally가 새 실행 B의 공유 상태를 정리하지 않는다', () => {
    const runA = createRun(1, 'A');
    const runB = createRun(2, 'B');

    expect(planChatRunFinalization(runB, runA, true)).toEqual({
      ownsRun: false,
      restoreSubmittedDraft: false,
      clearPendingState: false,
      saveSession: false,
      clearLoading: false,
    });
    expect(isChatRunOwner(runB, runB)).toBe(true);
  });

  it('현재 실행만 draft, save, loading 정리를 소유한다', () => {
    const run = createRun(3, 'current');

    expect(planChatRunFinalization(run, run, false)).toEqual({
      ownsRun: true,
      restoreSubmittedDraft: false,
      clearPendingState: true,
      saveSession: true,
      clearLoading: true,
    });
  });

  it('token이 같아도 controller가 다르면 소유권을 인정하지 않는다', () => {
    const staleRun = createRun(4, 'stale');
    const currentRun = createRun(4, 'current');

    expect(isChatRunOwner(currentRun, staleRun)).toBe(false);
  });

  it('취소된 A 뒤 B가 시작되면 A의 늦은 callback은 B의 signal이나 실행 권한을 얻지 못한다', () => {
    const runA = createAbortRun(5, 'A');
    runA.controller.signal.aborted = true;
    const runB = createAbortRun(6, 'B');

    expect(isChatRunActive(runB, runA)).toBe(false);
    expect(isChatRunActive(runB, runB)).toBe(true);
    expect(runA.controller.signal).not.toBe(runB.controller.signal);
  });

  it('provider와 도구 경로는 전역 controller 대신 호출 run과 active gate를 사용한다', () => {
    const viewSource = readFileSync(resolve(__dirname, 'view.ts'), 'utf8');
    const executeStart = viewSource.indexOf('private async executeAssistantToolCalls(');
    const executeEnd = viewSource.indexOf('private async approveToolCall(', executeStart);
    const executeSource = viewSource.slice(executeStart, executeEnd);
    const handleStart = viewSource.indexOf('private async handleSend(): Promise<void>');
    const handleEnd = viewSource.indexOf('private setLoading(', handleStart);
    const handleSource = viewSource.slice(handleStart, handleEnd);
    const streamStart = viewSource.indexOf('private async streamFinalAnswerAfterTools(');
    const streamEnd = viewSource.indexOf('private async runToolResponseLoop(', streamStart);
    const streamSource = viewSource.slice(streamStart, streamEnd);
    const providerAwaitIndex = handleSource.indexOf('await provider.streamChat(');
    const providerResolveGateIndex = handleSource.indexOf(
      '      );\n      if (!isChatRunActive(this.activeRun, run)) return;',
      providerAwaitIndex,
    );
    const toolExecutionIndex = handleSource.indexOf(
      'await this.executeAssistantToolCalls(',
      providerAwaitIndex,
    );

    expect(executeSource).toContain('run: ChatRunHandle<AbortController>');
    expect(executeSource).toContain('if (!isChatRunActive(this.activeRun, run))');
    expect(executeSource).toContain('signal: run.controller.signal');
    expect(executeSource).not.toContain('this.abortController?.signal');
    expect(
      handleSource.match(/if \(!isChatRunActive\(this\.activeRun, run\)\) return;/g)?.length,
    ).toBeGreaterThanOrEqual(8);
    expect(providerAwaitIndex).toBeGreaterThanOrEqual(0);
    expect(providerResolveGateIndex).toBeGreaterThan(providerAwaitIndex);
    expect(toolExecutionIndex).toBeGreaterThan(providerResolveGateIndex);
    expect(streamSource).toContain('if (!isChatRunActive(this.activeRun, args.run)) return;');
  });

  it('제출 user 다음 assistant placeholder는 첫 비동기 저장·도구 정의 gap보다 먼저 생긴다', () => {
    const viewSource = readFileSync(resolve(__dirname, 'view.ts'), 'utf8');
    const handleStart = viewSource.indexOf('private async handleSend(): Promise<void>');
    const handleEnd = viewSource.indexOf('private setLoading(', handleStart);
    const handleSource = viewSource.slice(handleStart, handleEnd);
    const userMessageIndex = handleSource.indexOf("this.addMessage('user'");
    const assistantMessageIndex = handleSource.indexOf("this.addMessage(\n      'assistant'");
    const saveIndex = handleSource.indexOf('await this.saveCurrentSession(true)', userMessageIndex);
    const collectToolsIndex = handleSource.indexOf(
      'await this.collectToolDefinitions(',
      userMessageIndex,
    );

    expect(userMessageIndex).toBeGreaterThanOrEqual(0);
    expect(assistantMessageIndex).toBeGreaterThan(userMessageIndex);
    expect(saveIndex).toBeGreaterThan(assistantMessageIndex);
    expect(collectToolsIndex).toBeGreaterThan(assistantMessageIndex);
  });

  it('세션 전환 진입점은 기존 run을 먼저 취소·무효화한다', () => {
    const viewSource = readFileSync(resolve(__dirname, 'view.ts'), 'utf8');
    for (const signature of [
      'async onClose(): Promise<void>',
      'clearMessages(): void',
      'async startNewSession(): Promise<void>',
      'async loadSession(filePath: string): Promise<void>',
      'private async openSessionHistoryModal(): Promise<void>',
    ]) {
      const start = viewSource.indexOf(signature);
      const bodyEnd = viewSource.indexOf('\n  }', start);
      const source = viewSource.slice(start, bodyEnd);
      expect(source).toContain('this.invalidateActiveChatRun(false);');
    }
  });
});
