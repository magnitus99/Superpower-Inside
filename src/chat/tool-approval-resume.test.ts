import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';
import { createNativeVaultToolDefinition } from '../agent/native-vault-tool';
import { setLanguage } from '../i18n';
import type { ToolDefinition } from '../llm/providers';
import { createDataBoundarySnapshot } from './context-composer';
import {
  createToolApprovalResumePlan,
  resolveToolApprovalQuestionContext,
} from './tool-approval-resume';
import { appendAssistantToolRound } from './tool-execution';
import type { ChatMessageWithMeta, ToolCallRecord } from './types';

describe('승인 대기 도구 provider 재개 계약', () => {
  beforeEach(() => {
    setLanguage('ko');
  });

  it('native provider 재개에도 근거 prompt와 실제 재주입 결과 수를 함께 적용한다', () => {
    const definitions = [createNativeVaultToolDefinition(), createMcpToolDefinition()];
    const toolCalls = createResumeToolCalls();
    const dataBoundarySnapshot = createDataBoundarySnapshot({
      providerLabel: 'OpenAI',
      model: 'gpt',
      hasUserQuestion: true,
      recentConversationMessageCount: 1,
      hasSystemPrompt: true,
      attachments: [],
      citations: [],
      mcpServerNames: ['remote'],
    });

    const plan = createToolApprovalResumePlan({
      promptSystemPrompt: '기본 시스템 지침',
      toolDefinitions: definitions,
      providerSupportsToolCalling: true,
      toolCalls,
      dataBoundarySnapshot,
    });
    const actualReinjectedCount = appendAssistantToolRound([], '', toolCalls).filter(
      (message) => message.role === 'tool',
    ).length;

    expect(plan.systemPrompt).toContain('기본 시스템 지침');
    expect(plan.systemPrompt).toContain(
      '[Superpower Inside proactive research and evidence contract]',
    );
    expect(plan.systemPrompt).not.toContain('[Superpower Inside tool protocol]');
    expect(plan.providerToolDefinitions).toEqual(definitions);
    expect(plan.reinjectedToolResultCount).toBe(actualReinjectedCount);
    expect(plan.reinjectedToolResultCount).toBe(3);
    expect(plan.dataBoundarySnapshot?.providerPayload?.toolResults).toBe(3);
  });

  it('compatibility provider 재개에는 같은 근거 계약을 포함한 JSON 도구 prompt를 붙인다', () => {
    const plan = createToolApprovalResumePlan({
      promptSystemPrompt: null,
      toolDefinitions: [createNativeVaultToolDefinition()],
      providerSupportsToolCalling: false,
      toolCalls: createResumeToolCalls(),
      dataBoundarySnapshot: undefined,
    });

    expect(plan.systemPrompt).toContain('[Superpower Inside tool protocol]');
    expect(plan.systemPrompt).toContain(
      '[Superpower Inside proactive research and evidence contract]',
    );
    expect(plan.systemPrompt).toContain(
      '<tool_call>{"name":"tool_name","arguments":{}}</tool_call>',
    );
    expect(plan.providerToolDefinitions).toEqual([]);
    expect(plan.dataBoundarySnapshot).toBeUndefined();
  });

  it('승인 assistant 이전의 현재 질문과 그 직전 질문만 현재 세션에서 선택한다', () => {
    const messages = [
      createMessage({ id: 'user-1', role: 'user', content: '네빌은 누구야?' }),
      createMessage({ id: 'assistant-1', role: 'assistant', content: '첫 답변' }),
      createMessage({ id: 'user-2', role: 'user', content: '창세기 근거를 찾아줘' }),
      createMessage({ id: 'assistant-2', role: 'assistant', content: '승인 대기' }),
      createMessage({ id: 'user-3', role: 'user', content: '뒤의 다른 질문' }),
    ];

    expect(resolveToolApprovalQuestionContext(messages, 'assistant-2', 'fallback')).toEqual({
      currentQuestion: '창세기 근거를 찾아줘',
      previousUserQuestions: ['네빌은 누구야?'],
    });
    expect(resolveToolApprovalQuestionContext([], 'missing', 'fallback')).toEqual({
      currentQuestion: 'fallback',
      previousUserQuestions: [],
    });
  });

  it('승인 클릭부터 도구와 provider 재개까지 하나의 취소 가능한 run이 소유한다', () => {
    const viewSource = readFileSync(resolve(__dirname, 'view.ts'), 'utf8');
    const approvalStart = viewSource.indexOf(
      'private async approveToolCall(messageId: string, toolCallId: string): Promise<void>',
    );
    const approvalEnd = viewSource.indexOf('private async buildPromptContext(', approvalStart);
    const approvalSource = viewSource.slice(approvalStart, approvalEnd);
    const runOwnershipIndex = approvalSource.indexOf('this.activeRun = run;');
    const approvedStateIndex = approvalSource.indexOf("turnStage: 'running-tools'");
    const durableSaveIndex = approvalSource.indexOf(
      'await this.saveCurrentSession(true);',
      approvedStateIndex,
    );
    const toolExecutionIndex = approvalSource.indexOf('await this.executeAssistantToolCalls(');
    const providerResumeIndex = approvalSource.indexOf('await this.runToolResponseLoop({');

    expect(approvalSource).toContain('if (this.isStreaming) return;');
    expect(approvalSource).toContain('const abortController = new AbortController();');
    expect(approvalSource).toContain('this.abortController = abortController;');
    expect(approvalSource).toContain('this.setLoading(true);');
    expect(approvalSource).toContain('setHidden(this.typingIndicator, false);');
    expect(runOwnershipIndex).toBeGreaterThanOrEqual(0);
    expect(approvedStateIndex).toBeGreaterThan(runOwnershipIndex);
    expect(durableSaveIndex).toBeGreaterThan(approvedStateIndex);
    expect(toolExecutionIndex).toBeGreaterThan(durableSaveIndex);
    expect(toolExecutionIndex).toBeGreaterThan(runOwnershipIndex);
    expect(providerResumeIndex).toBeGreaterThan(toolExecutionIndex);
    expect(approvalSource).toContain('abortController,');
    expect(approvalSource).toContain('planChatRunFinalization(this.activeRun, run, false)');
    expect(approvalSource).toContain('if (!isChatRunOwner(this.activeRun, run))');
    expect(approvalSource).toContain(
      'const resumeDataBoundarySnapshot = createDataBoundarySnapshot({',
    );
    expect(approvalSource).toContain('citations: promptContext.citations,');
    expect(approvalSource).toContain('contextAttachments: promptContext.attachments,');
    expect(approvalSource.match(/saveCurrentSession\(true\)/g)).toHaveLength(2);
  });

  it('초기·승인 데이터 경계는 후보 MCP가 아니라 실제 실행 서버만 나중에 기록한다', () => {
    const viewSource = readFileSync(resolve(__dirname, 'view.ts'), 'utf8');
    const handleStart = viewSource.indexOf('private async handleSend(): Promise<void>');
    const handleEnd = viewSource.indexOf('private setLoading(', handleStart);
    const handleSource = viewSource.slice(handleStart, handleEnd);
    const initialBoundaryStart = handleSource.indexOf('const dataBoundarySnapshot =');
    const initialBoundaryEnd = handleSource.indexOf('const branchOf =', initialBoundaryStart);
    const initialBoundarySource = handleSource.slice(initialBoundaryStart, initialBoundaryEnd);
    const approvalStart = viewSource.indexOf('private async approveToolCall(');
    const approvalEnd = viewSource.indexOf('private async buildPromptContext(', approvalStart);
    const approvalSource = viewSource.slice(approvalStart, approvalEnd);
    const resumeBoundaryStart = approvalSource.indexOf(
      'const resumeDataBoundarySnapshot = createDataBoundarySnapshot({',
    );
    const resumeBoundaryEnd = approvalSource.indexOf('const resumePlan =', resumeBoundaryStart);
    const resumeBoundarySource = approvalSource.slice(resumeBoundaryStart, resumeBoundaryEnd);
    const loopStart = viewSource.indexOf('private async runToolResponseLoop(');
    const loopEnd = viewSource.indexOf('private getMentionedServerNames(', loopStart);
    const loopSource = viewSource.slice(loopStart, loopEnd);

    expect(initialBoundarySource).toContain('hasSystemPrompt: true');
    expect(initialBoundarySource).toContain('mcpServerNames: []');
    expect(resumeBoundarySource).toContain('hasSystemPrompt: true');
    expect(resumeBoundarySource).toContain('mcpServerNames: []');
    expect(loopSource).toContain('collectCompletedMcpServerNames(allToolCalls)');
    expect(loopSource).toContain('mcpServerNames,');
  });

  it('초기 provider와 compatibility 최종 표시에도 native 근거 계약을 적용한다', () => {
    const viewSource = readFileSync(resolve(__dirname, 'view.ts'), 'utf8');
    const handleStart = viewSource.indexOf('private async handleSend(): Promise<void>');
    const handleEnd = viewSource.indexOf('private setLoading(', handleStart);
    const handleSource = viewSource.slice(handleStart, handleEnd);
    const contractIndex = handleSource.indexOf(
      'fullText = enforceNativeToolAnswerContract(fullText, toolCalls).content;',
    );
    const displayedCitationsIndex = handleSource.indexOf(
      'const displayedCitations = selectDisplayedAnswerCitations(',
    );

    expect(contractIndex).toBeGreaterThanOrEqual(0);
    expect(displayedCitationsIndex).toBeGreaterThan(contractIndex);
    expect(handleSource.match(/enforceNativeToolAnswerContract\(/g)).toHaveLength(3);
  });
});

function createResumeToolCalls(): ToolCallRecord[] {
  return [
    {
      id: 'runtime-success',
      name: 'superpower_inside',
      arguments: '{}',
      normalizedResult: '{"hits":[]}',
      status: 'success',
    },
    {
      id: 'stored-summary',
      name: 'read_remote_resource',
      arguments: '{}',
      resultSummary: '저장된 제한 요약',
      resumePayloadSource: 'resultSummary',
      status: 'success',
    },
    {
      id: 'runtime-error',
      name: 'read_remote_resource',
      arguments: '{}',
      result: '원격 오류',
      status: 'error',
    },
    {
      id: 'legacy-summary',
      name: 'read_remote_resource',
      arguments: '{}',
      resultSummary: '명시적 재개 marker가 없는 과거 요약',
      status: 'success',
    },
    {
      id: 'pending',
      name: 'read_remote_resource',
      arguments: '{}',
      status: 'running',
      approved: false,
    },
  ];
}

function createMcpToolDefinition(): ToolDefinition {
  return {
    type: 'function',
    function: {
      name: 'read_remote_resource',
      description: '원격 자료를 읽습니다.',
      parameters: { type: 'object', properties: {} },
    },
  };
}

function createMessage(overrides: Partial<ChatMessageWithMeta>): ChatMessageWithMeta {
  const now = '2026-07-23T00:00:00.000Z';
  return {
    id: overrides.id ?? 'message',
    role: overrides.role ?? 'assistant',
    content: overrides.content ?? '',
    timestamp: Date.parse(now),
    createdAt: now,
    updatedAt: now,
    status: overrides.status ?? 'complete',
    ...overrides,
  };
}
