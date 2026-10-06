import { describe, expect, it, vi } from 'vitest';
import {
  collectPrivateJudgeEvidence,
  collectPrivateJudgeObservations,
  evaluateObsidianVault,
  isEvaluationHostAlive,
} from './chat-tool-evaluation.mjs';
import {
  createPrivateVaultCases,
  createPublicToolCases,
  summarizePrivateEvaluation,
} from './chat-tool-scenarios.mjs';

describe('범용 도구 평가와 비공개 결과 경계', () => {
  it('종료된 평가 호스트를 진행 중으로 취급하지 않는다', () => {
    expect(isEvaluationHostAlive(process.pid)).toBe(true);
    expect(isEvaluationHostAlive(0)).toBe(false);
    const kill = vi.spyOn(process, 'kill').mockImplementationOnce(() => {
      throw new Error('호스트 종료');
    });
    try {
      expect(isEvaluationHostAlive(process.pid)).toBe(false);
      expect(kill).toHaveBeenCalledWith(process.pid, 0);
    } finally {
      kill.mockRestore();
    }
  });

  it('기존 8개 도구 시나리오의 열 배를 서로 다른 입력과 작업으로 만든다', () => {
    const cases = createPublicToolCases();
    expect(cases).toHaveLength(80);
    expect(new Set(cases.map((item) => item.id)).size).toBe(80);
    expect(new Set(cases.map((item) => item.category)).size).toBe(10);
    expect(new Set(cases.map((item) => item.question)).size).toBe(80);
    for (const item of cases) {
      expect(item.expectedFacts.length).toBeGreaterThan(0);
      expect(item.toolRounds.length).toBeGreaterThan(1);
      expect(
        item.relevantPaths.every((value) => item.files.some((file) => file.path === value)),
      ).toBe(true);
    }
  });

  it('원문이나 식별자를 지우는 대신 허용된 숫자와 상태만 새 결과에 복사한다', () => {
    const secret = 'PRIVATE_CANARY_NOT_A_REAL_NOTE';
    const report = summarizePrivateEvaluation(
      [
        {
          id: secret,
          category: 'read',
          protocol: 'native',
          contractPassed: true,
          answer: secret,
          trace: [secret],
          retrieval: [{ query: secret }],
          readPaths: [secret],
          elapsedMs: 3,
          providerCalls: 2,
          toolCalls: 1,
          keywordCoverage: 1,
          semantic: { grounded: true, complete: true, followsInstructions: true, reason: secret },
        },
        {
          id: secret,
          category: secret,
          protocol: secret,
          contractPassed: false,
          error: secret,
          elapsedMs: secret,
          providerCalls: secret,
          toolCalls: 0,
        },
      ],
      { candidateFiles: 2, model: secret, vault: secret, source: secret },
    );
    expect(JSON.stringify(report)).not.toContain(secret);
    expect(report).toMatchObject({
      candidateFiles: 2,
      executions: 2,
      passed: 1,
      failed: 1,
      providerCalls: 2,
      toolCalls: 1,
      semanticAssessed: 1,
      semanticPassed: 1,
    });
  });

  it('정답 누락과 판정 실패를 성공으로 계산하지 않는다', () => {
    const report = summarizePrivateEvaluation([
      { category: 'read', protocol: 'compatibility', contractPassed: true, keywordCoverage: 0 },
      {
        category: 'compare',
        protocol: 'native',
        contractPassed: true,
        keywordCoverage: 1,
        semantic: { grounded: false, complete: true, followsInstructions: true },
      },
    ]);
    expect(report.passed).toBe(0);
    expect(report.semanticPassed).toBe(0);
  });

  it('볼트 사례는 다양한 파일의 현재 원문을 읽어 메모리에서만 만들고 쓰기 API를 요구하지 않는다', async () => {
    const files = Array.from({ length: 100 }, (_, index) => ({
      path: `generic/Record-${index}.md`,
      stat: { size: 1000 + index },
    }));
    const app = {
      vault: {
        cachedRead: async (file) =>
          Array.from(
            { length: 20 },
            (_, line) =>
              `Generic concept ${file.path} line ${line}: a premise supports a bounded conclusion and requires evidence.`,
          ).join('\n'),
      },
      metadataCache: { resolvedLinks: {} },
    };
    const cases = await createPrivateVaultCases({ app, files });
    expect(cases).toHaveLength(80);
    expect(new Set(cases.map((item) => item.relevantPaths[0])).size).toBe(80);
    expect(new Set(cases.map((item) => item.category)).size).toBe(8);
    for (const item of cases) {
      expect(item.expectedFacts).toEqual(item.evidence.map((source) => source.text));
      expect(item.evidence.every((source) => source.context.includes(source.text))).toBe(true);
    }
  });

  it('자료 부족을 통과하거나 임의의 합성 볼트로 대체하지 않는다', async () => {
    await expect(createPrivateVaultCases({ files: [], app: {} }, 1)).rejects.toThrow('자료가 부족');
  });

  it('실모델 판정을 요구한 사례는 판정 누락을 성공으로 세지 않는다', () => {
    const report = summarizePrivateEvaluation([
      {
        category: 'head',
        protocol: 'native',
        contractPassed: true,
        keywordCoverage: 1,
        semanticRequired: true,
      },
    ]);
    expect(report).toMatchObject({ passed: 0, failed: 1, semanticAssessed: 0 });
  });

  it('판정은 추가로 읽은 원문을 포함하되 실패 결과와 미검증 검색 후보를 근거로 사용하지 않는다', () => {
    const seed = { path: 'generic/Seed.md', context: 'Initial evidence.' };
    const evidence = collectPrivateJudgeEvidence(
      { evidence: [seed] },
      {
        trace: [
          {
            status: 'success',
            result: JSON.stringify({
              action: 'read',
              path: 'generic/Other.md',
              startLine: 2,
              endLine: 3,
              content: 'Additional verified context.',
            }),
          },
          {
            status: 'error',
            result: JSON.stringify({ action: 'read', content: 'Failed evidence.' }),
          },
          {
            status: 'success',
            result: JSON.stringify({
              action: 'search',
              hits: [
                { path: 'Candidate.md', citationStatus: 'candidate', preview: 'Unverified.' },
                {
                  path: 'Verified.md',
                  citationStatus: 'verified',
                  startLine: 1,
                  endLine: 1,
                  preview: 'Current text.',
                },
              ],
            }),
          },
        ],
      },
    );
    expect(evidence.map((item) => item.context)).toEqual([
      'Initial evidence.',
      'Additional verified context.',
      'Current text.',
    ]);
  });

  it('목록·링크·검색 실패를 실행 근거로 전달하고 읽기 본문과 구분한다', () => {
    const observations = collectPrivateJudgeObservations({
      trace: [
        {
          name: 'read',
          status: 'success',
          result: JSON.stringify({
            action: 'read',
            path: 'Generic.md',
            content: 'Private source.',
          }),
        },
        {
          name: 'list',
          status: 'success',
          result: JSON.stringify({ action: 'list', totalFiles: 1 }),
        },
        {
          name: 'links',
          status: 'success',
          result: JSON.stringify({ action: 'links', totalLinks: 2 }),
        },
        {
          name: 'related',
          status: 'error',
          result: JSON.stringify({ action: 'related', error: 'engine-unavailable' }),
        },
      ],
    });
    expect(JSON.stringify(observations)).not.toContain('Private source.');
    expect(observations.map((item) => item.result)).toEqual([
      { action: 'read', path: 'Generic.md' },
      { action: 'list', totalFiles: 1 },
      { action: 'links', totalLinks: 2 },
      { action: 'related', error: 'engine-unavailable' },
    ]);
    expect(observations[3].status).toBe('error');
  });

  it.each([1, 2])(
    '동시 실행 %i개에서 429 이후 새 사례와 진행 중 판정 호출을 중단한다',
    async (concurrency) => {
      const streamChat = vi.fn(async () => {
        if (streamChat.mock.calls.length === 1) {
          throw Object.assign(new Error('비공개 응답'), { status: 429 });
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      const chat = vi.fn(
        async () => '{"grounded":true,"complete":true,"followsInstructions":true}',
      );
      const provider = { capability: { maxToolRounds: 1 }, streamChat, chat };
      const files = Array.from({ length: 6 }, (_, index) => ({
        path: `generic/${index}.md`,
        stat: { size: 500 },
      }));
      const runtime = {
        appLogger: { configure: vi.fn(), clear: vi.fn() },
        initializeChatGPTOAuth: vi.fn(),
        createProviderForStrategy: () => provider,
        getRagCandidateFiles: async () => files,
        NativeVaultToolRuntime: class {},
        ObsidianNativeVaultToolPort: class {},
        createNativeVaultToolDefinitions: () => [],
        planAgenticToolTurn: () => ({ toolChoice: 'auto' }),
        selectAgenticToolDefinitions: () => [],
        appendAgenticCheckpoint: (messages) => messages,
        prepareProviderRequest: (messages) => ({ messages }),
        createToolEvidencePrompt: () => '',
        createCompatibilityToolPrompt: () => '',
        parseCompatibilityToolTurn: () => ({
          visibleContent: '',
          visibleReasoning: '',
          toolCalls: [],
        }),
        enforceNativeToolAnswerContract: () => ({ content: '', violationCodes: [] }),
        collectToolCitations: () => [],
      };
      const app = {
        vault: {
          cachedRead: async () =>
            'A generic concept uses explicit premises to justify a bounded conclusion with independently verifiable evidence.',
        },
        metadataCache: { resolvedLinks: {} },
        plugins: { plugins: {} },
      };
      const settings = {
        chat: { defaultModel: 'profile:test:selected' },
        rag: {},
        providerProfiles: [
          { id: 'test', enabled: true, models: [{ id: 'selected' }], strategy: 'openAIChatGPT' },
        ],
      };
      const report = await evaluateObsidianVault(runtime, app, settings, {
        count: 3,
        concurrency,
      });
      expect(streamChat).toHaveBeenCalledTimes(concurrency);
      expect(chat).not.toHaveBeenCalled();
      expect(report).toMatchObject({
        executions: 6,
        attemptedExecutions: concurrency,
        completedExecutions: 0,
        blockedExecutions: concurrency,
        skippedExecutions: 6 - concurrency,
        passed: 0,
        providerCalls: concurrency,
      });
      expect(JSON.stringify(report)).not.toContain('비공개 응답');
    },
  );
});
