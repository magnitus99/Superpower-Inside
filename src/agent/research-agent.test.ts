import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '../llm/providers';
import { setLanguage } from '../i18n';
import { planModelContextRust } from '../rag/rust-core';
import type {
  NativeVaultToolExecutionResult,
  NativeVaultToolRuntimeLike,
} from './native-vault-tool';
import {
  VaultResearchAgent,
  getVaultResearchPhaseLabel,
  isWholeVaultResearchRequest,
  isScopedVaultResearchRequest,
} from './research-agent';

describe('로컬 선별 우선 Vault Research Agent', () => {
  it('최종 연구 답변만 스트리밍하고 내부 요약은 표시하지 않는다', async () => {
    const runtime = createRuntime(
      new Map([['synthetic/relay.md', 'Copper relay requires inspection.']]),
    );
    const chat = vi.fn(() => Promise.resolve('Copper relay inspection evidence.'));
    let release = (): void => {};
    let arrived = (): void => {};
    const started = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    const streamChat = vi.fn(
      async (
        _messages: ChatMessage[],
        consume: (chunk: { content: string; done: boolean }) => void,
      ) => {
        consume({ content: 'Copper relay ', done: false });
        arrived();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        consume({ content: 'requires inspection.', done: false });
        consume({ content: '', done: true });
      },
    );
    const answers: string[] = [];
    const pending = new VaultResearchAgent({ chat, streamChat }, runtime).run({
      question: 'copper relay inspection',
      scopePath: 'synthetic',
      onAnswer: (content) => answers.push(content),
    });
    await started;
    expect(answers).toEqual(['', 'Copper relay ']);
    expect(chat).toHaveBeenCalled();
    release();
    const result = await pending;
    expect(result.content).toContain('Copper relay requires inspection.');
    expect(streamChat).toHaveBeenCalledOnce();
  });
  it('작은 모델 예산에서도 질문과 맞는 후반 구절의 실제 행을 전달한다', async () => {
    const text =
      'title: Synthetic inspection\ndate: not-recorded\n\n' +
      'unrelated background.\n'.repeat(600) +
      '\nCopper relay requires inspection.';
    const line = text.split('\n').findIndex((value) => value.includes('Copper relay')) + 1;
    const runtime = createRuntime(new Map([['fixtures/inspection.md', text]]));
    const prompts: string[] = [];
    const chat = vi.fn((messages: ChatMessage[]) => {
      prompts.push(lastPrompt(messages));
      return Promise.resolve(
        'Inspection evidence [vault:fixtures/inspection.md:' + line + '-' + line + ']',
      );
    });
    const result = await new VaultResearchAgent(
      { chat, contextBudget: planModelContextRust({})! },
      runtime,
    ).run({ question: 'copper relay inspection을 비교해줘', scopePath: 'fixtures' });
    const prompt = prompts.find((value) => value.includes('Analyze this locally selected'));
    expect(prompt).toContain('Copper relay requires inspection.');
    expect(prompt).toContain('not-recorded');
    expect(result.providerTransfer.sentChars).toBeLessThanOrEqual(1704);
    expect(result.coverage.reasonCodes).toContain('provider-omitted');
    expect(result.coverage.exactNegativeAllowed).toBe(false);
  });

  it('한 행 중간에서 잘린 원문을 nextStartOffset으로 끝까지 이어 읽는다', async () => {
    const runtime = createRuntime(new Map([['docs/Aurora.txt', 'Aurora 근거']]));
    const execute = runtime.execute.getMockImplementation()!;
    runtime.execute.mockImplementation(async (argumentsText, signal) => {
      const request = JSON.parse(argumentsText) as { action: string; start_offset?: number };
      if (request.action !== 'read') return execute(argumentsText, signal);
      const continued = request.start_offset === 100;
      const content = continued ? 'Aurora OFFSET_TAIL_EVIDENCE' : 'irrelevant '.repeat(100);
      return result({
        action: 'read',
        path: 'docs/Aurora.txt',
        startLine: 1,
        endLine: 1,
        totalLines: 1,
        truncated: !continued,
        nextStartLine: continued ? null : 1,
        nextStartOffset: continued ? null : 100,
        content,
        citations: [
          {
            id: 'vault:docs/Aurora.txt:1-1',
            filePath: 'docs/Aurora.txt',
            line: 1,
            endLine: 1,
            preview: content,
          },
        ],
      });
    });
    const prompts: string[] = [];
    const chat = vi.fn((messages: ChatMessage[]) => {
      prompts.push(lastPrompt(messages));
      return Promise.resolve('Aurora 근거 [vault:docs/Aurora.txt:1-1]');
    });
    await new VaultResearchAgent({ chat }, runtime).run({ question: 'Aurora 개념을 종합해줘' });
    expect(readRequests(runtime)).toEqual([
      expect.objectContaining({ start_line: 1 }),
      expect.objectContaining({ start_line: 1, start_offset: 100 }),
    ]);
    expect(prompts.some((value) => value.includes('OFFSET_TAIL_EVIDENCE'))).toBe(true);
  });
  it.each([
    {
      synthesis: '@[fixtures] 센서와 배선 점검 결과를 비교해줘',
      quote: '@[fixtures] 센서 관련 인용 구절을 찾아줘',
    },
    {
      synthesis: '@[fixtures] summarize the maintenance records',
      quote: '@[fixtures] find a quotation about the relay',
    },
  ])('폴더 종합과 좁은 인용문 검색을 구분한다: $synthesis', ({ synthesis, quote }) => {
    expect(isScopedVaultResearchRequest(synthesis)).toBe(true);
    expect(isScopedVaultResearchRequest(quote)).toBe(false);
  });
  it('모든 inventory 페이지와 최종 답변이 지정 폴더 범위를 유지한다', async () => {
    const runtime = createRuntime(new Map([['docs/a.md', 'Aurora concept evidence']]));
    const chat = vi.fn().mockResolvedValue('확인한 Aurora 근거 [vault:docs/a.md:1-1]');
    const result = await new VaultResearchAgent({ chat }, runtime).run({
      question: 'Aurora 개념을 종합해줘',
      scopePath: 'docs',
    });
    const lists = runtime.execute.mock.calls
      .map((call) => JSON.parse(call[0]) as { action: string; path?: string })
      .filter((request) => request.action === 'list');
    expect(lists.every((request) => request.path === 'docs')).toBe(true);
    expect(result.content).toContain('조사 범위: docs');
    expect(result.totalFiles).toBe(1);
  });
  beforeEach(() => {
    setLanguage('ko');
  });

  it('내부 phase 이름을 사용자 작업 언어로 표시한다', () => {
    expect(getVaultResearchPhaseLabel('inventory')).toBe('문서 확인');
    expect(getVaultResearchPhaseLabel('map')).toBe('문서 읽기');
    expect(getVaultResearchPhaseLabel('reduce')).toBe('내용 종합');
    setLanguage('en');
    expect(getVaultResearchPhaseLabel('map')).toBe('Reading documents');
  });

  it('명시적인 볼트 전체 요약과 전수 조사를 research workflow로 분류한다', () => {
    expect(isWholeVaultResearchRequest('이 옵시디언 볼트를 요약해줘')).toBe(true);
    expect(
      isWholeVaultResearchRequest('볼트 내에서 genesis와 관련된 모든 것들을 조사하면 되지 않아?'),
    ).toBe(true);
    expect(isWholeVaultResearchRequest('Alpha 노트의 고객 문제는 뭐야?')).toBe(false);
  });

  it('모든 문서는 로컬에서 읽고 선택 근거를 묶어 두 번의 provider 호출로 답한다', async () => {
    const runtime = createRuntime(
      new Map([
        ['Alpha.md', 'Alpha 내용'],
        ['Beta.md', 'Beta 내용'],
      ]),
    );
    const chat = vi.fn((messages: ChatMessage[]) => {
      const prompt = lastPrompt(messages);
      return Promise.resolve(
        prompt.includes('Write the final answer')
          ? '볼트 전체 요약 [vault:Alpha.md:1-1] [vault:Beta.md:1-1]'
          : 'Alpha와 Beta 핵심 [vault:Alpha.md:1-1] [vault:Beta.md:1-1]',
      );
    });
    const progress = vi.fn();

    const result = await new VaultResearchAgent({ chat }, runtime).run({
      question: '이 볼트를 요약해줘',
      onProgress: progress,
    });

    expect(readRequests(runtime)).toEqual([
      expect.objectContaining({ path: 'Alpha.md' }),
      expect.objectContaining({ path: 'Beta.md' }),
    ]);
    expect(chat).toHaveBeenCalledTimes(2);
    expect(
      chat.mock.calls.every(([messages]) => /비신뢰|untrusted/i.test(messages[0]?.content ?? '')),
    ).toBe(true);
    expect(result.content).toContain('볼트 문서 2개를 로컬에서 확인했고');
    expect(result.content).toContain('볼트 전체 요약');
    expect(result.citations.map((citation) => citation.filePath)).toEqual(['Alpha.md', 'Beta.md']);
    expect(result).toMatchObject({
      processedFiles: 2,
      totalFiles: 2,
      failedFiles: [],
      providerTransfer: { sentFiles: 2, sentSegments: 2 },
      coverage: {
        wholeVaultLocallyScreened: true,
        allSelectedEvidenceAnalyzed: true,
      },
    });
    expect(progress).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: 'complete', completedFiles: 2, totalFiles: 2 }),
    );
  });

  it('사용자 답변 지침을 최종 합성과 교정에 전달하고 내부 자료 추출에는 섞지 않는다', async () => {
    const runtime = createRuntime(new Map([['Alpha.md', 'Alpha 근거 '.repeat(2_000)]]));
    const instruction = 'Answer in English with exactly three bullets.';
    const chat = vi.fn((messages: ChatMessage[]) =>
      Promise.resolve(
        lastPrompt(messages).includes('Write the final answer')
          ? '모든 파일을 전부 읽었습니다.'
          : lastPrompt(messages).includes('Rewrite the answer')
            ? '확인한 근거 [vault:Alpha.md:1-1]'
            : 'Alpha 근거 [vault:Alpha.md:1-1]',
      ),
    );
    await new VaultResearchAgent({ chat }, runtime).run({
      question: 'Alpha 관련 모든 자료를 조사해줘',
      systemPrompt: instruction,
    });
    const requests = chat.mock.calls.map(([messages]) => messages);
    expect(requests[0]?.[0]?.content).not.toContain(instruction);
    expect(requests[1]?.[0]?.content).toContain(instruction);
    expect(requests[2]?.[0]?.content).toContain(instruction);
    expect(
      requests.every((messages) => messages[0]?.content.includes('never invent coverage')),
    ).toBe(true);
  });

  it('이전 질문의 맥락과 현재 주제를 도메인 중립적으로 결합하고 1,406개 중 51개만 provider에 보낸다', async () => {
    const files = new Map<string, string>();
    for (let index = 0; index < 1_406; index++) {
      files.set(
        index < 51
          ? `Projects/Migration/${String(index).padStart(2, '0')}.md`
          : `Archive/${String(index).padStart(4, '0')}.md`,
        index < 51 ? 'Migration decision record' : '관련 없는 기록',
      );
    }
    const runtime = createRuntime(files);
    const chat = vi.fn((messages: ChatMessage[]) =>
      Promise.resolve(
        lastPrompt(messages).includes('Write the final answer')
          ? '현재 검색 범위에서 Aurora의 migration 근거를 정리했습니다.'
          : '선택 근거를 확인했습니다.',
      ),
    );

    const result = await new VaultResearchAgent({ chat }, runtime).run({
      question: 'Migration과 관련된 모든 자료를 조사해줘',
      previousUserQuestions: ['Aurora는 migration을 어떻게 설명했어?'],
    });

    expect(result.processedFiles).toBe(1_406);
    expect(result.selection.selectedIndices).toHaveLength(51);
    expect(result.selection.terms).toEqual(expect.arrayContaining(['migration', 'aurora']));
    expect(result.providerTransfer.sentFiles).toBe(51);
    expect(result.coverage.exactNegativeAllowed).toBe(true);
    expect(chat).toHaveBeenCalledTimes(8);
    expect(listRequests(runtime)).toHaveLength(15);
  });

  it('읽기 실패를 격리하고 전수 결론을 금지한다', async () => {
    const runtime = createRuntime(
      new Map([
        ['Alpha.md', 'Alpha 내용'],
        ['Beta.md', 'Beta 내용'],
      ]),
      { unreadablePaths: new Set(['Beta.md']) },
    );
    const chat = vi.fn((messages: ChatMessage[]) =>
      Promise.resolve(
        lastPrompt(messages).includes('Write the final answer')
          ? '읽은 문서의 요약 [vault:Alpha.md:1-1]'
          : 'Alpha 핵심 [vault:Alpha.md:1-1]',
      ),
    );

    const result = await new VaultResearchAgent({ chat }, runtime).run({
      question: '볼트 전체를 요약해줘',
    });

    expect(result).toMatchObject({
      processedFiles: 1,
      totalFiles: 2,
      failedFiles: ['Beta.md'],
      coverage: {
        wholeVaultLocallyScreened: false,
        exactNegativeAllowed: false,
      },
    });
    expect(result.content).toContain('볼트 문서 1/2개를 로컬에서 확인했고');
    expect(result.content).toContain('전수 결론은 내리지 않았습니다');
  });

  it('직접 일치 후보가 없으면 provider를 호출하지 않고 범위가 검증된 답을 만든다', async () => {
    const runtime = createRuntime(
      new Map([
        ['Alpha.md', '제품 전략'],
        ['Beta.md', '검색 안정성'],
      ]),
    );
    const chat = vi.fn(() => Promise.reject(new Error('호출되면 안 됨')));

    const result = await new VaultResearchAgent({ chat }, runtime).run({
      question: '제우스에 관한 모든 자료를 조사해줘',
    });

    expect(chat).not.toHaveBeenCalled();
    expect(result.selection.selectedIndices).toEqual([]);
    expect(result.coverage.exactNegativeAllowed).toBe(true);
    expect(result.content).toContain('현재 질문과 직접 일치하는 볼트 근거를 찾지 못했습니다');
    expect(result.citations).toEqual([]);
    expect(result.providerTransfer).toEqual({ sentFiles: 0, sentSegments: 0, sentChars: 0 });
  });

  it('provider 전송 상한을 넘는 문서는 부재 단정이 불가능한 coverage로 표시한다', async () => {
    const runtime = createRuntime(
      new Map([['notes/Ledger.md', `원장 ${'긴 본문 '.repeat(3_000)}`]]),
    );
    const chat = vi.fn((messages: ChatMessage[]) =>
      Promise.resolve(
        lastPrompt(messages).includes('Write the final answer')
          ? '선택 근거에서 확인한 원장 내용입니다.'
          : '근거 요약',
      ),
    );

    const result = await new VaultResearchAgent({ chat }, runtime).run({
      question: '원장 관련 모든 내용을 조사해줘',
    });

    expect(result.providerTransfer.sentChars).toBeLessThanOrEqual(9_000);
    expect(result.coverage.reasonCodes).toContain('provider-omitted');
    expect(result.coverage.exactNegativeAllowed).toBe(false);
    expect(result.content).toContain('전수 결론은 내리지 않았습니다');
  });

  it('부분 발췌의 실제 행과 후속 일치 구절을 함께 전달한다', async () => {
    const firstContent = 'copper relay 점검 ' + '가'.repeat(9_500);
    const runtime = createSegmentedRuntime(
      new Map([
        [
          'fixtures/parts.md',
          [
            { startLine: 1, endLine: 400, content: firstContent },
            { startLine: 401, endLine: 800, content: 'copper relay FOLLOWUP_SEGMENT' },
            { startLine: 801, endLine: 1200, content: '무관한 UNSENT_SEGMENT' },
          ],
        ],
      ]),
    );
    const prompts: string[] = [];
    const chat = vi.fn((messages: ChatMessage[]) => {
      prompts.push(lastPrompt(messages));
      return Promise.resolve(
        '근거 [vault:fixtures/parts.md:1-1] [vault:fixtures/parts.md:401-800]',
      );
    });
    const result = await new VaultResearchAgent({ chat }, runtime).run({
      question: 'copper relay 점검을 비교해줘',
    });
    const prompt = prompts.find((value) =>
      value.includes('Analyze this locally selected vault-evidence batch.'),
    );
    expect(prompt).toContain('vault:fixtures/parts.md:1-1');
    expect(prompt).not.toContain('vault:fixtures/parts.md:1-400');
    expect(prompt).toContain('vault:fixtures/parts.md:401-800');
    expect(prompt).toContain('FOLLOWUP_SEGMENT');
    expect(prompt).not.toContain('UNSENT_SEGMENT');
    expect(prompt).not.toContain('vault:fixtures/parts.md:801-1200');
    expect(result.providerTransfer).toMatchObject({ sentFiles: 1, sentSegments: 2 });
    expect(result.providerTransfer.sentChars).toBeLessThan(9_000);
    expect(result.citations.map((citation) => citation.id)).toEqual([
      'vault:fixtures/parts.md:1-1',
      'vault:fixtures/parts.md:401-800',
    ]);
  });

  it('파일명 일치는 segment를 채우지 않고 9,000자 뒤의 실제 content 일치를 선택한다', async () => {
    const runtime = createSegmentedRuntime(
      new Map([
        [
          'notes/Ledger.md',
          [
            { startLine: 1, endLine: 400, content: `무관한 앞부분 ${'가'.repeat(9_500)}` },
            { startLine: 401, endLine: 800, content: '원장 LATE_RELEVANT_SEGMENT' },
          ],
        ],
      ]),
    );
    const prompts: string[] = [];
    const chat = vi.fn((messages: ChatMessage[]) => {
      const prompt = lastPrompt(messages);
      prompts.push(prompt);
      return Promise.resolve(
        prompt.includes('Write the final answer')
          ? '후반 근거 [vault:notes/Ledger.md:401-800]'
          : '후반 근거 [vault:notes/Ledger.md:401-800]',
      );
    });

    const result = await new VaultResearchAgent({ chat }, runtime).run({
      question: '원장 관련 모든 내용을 조사해줘',
    });
    const batchPrompt = prompts.find((prompt) =>
      prompt.includes('Analyze this locally selected vault-evidence batch.'),
    );

    expect(batchPrompt).toContain('LATE_RELEVANT_SEGMENT');
    expect(batchPrompt).toContain('vault:notes/Ledger.md:401-800');
    expect(batchPrompt).not.toContain('vault:notes/Ledger.md:1-400');
    expect(result.providerTransfer.sentSegments).toBe(1);
    expect(result.providerTransfer.sentChars).toBeLessThan(9_000);
    expect(result.citations.map((citation) => citation.id)).toEqual([
      'vault:notes/Ledger.md:401-800',
    ]);
  });

  it('batch summary 총량을 계층적으로 줄여 final prompt의 evidence digest를 제한한다', async () => {
    const runtime = createRuntime(
      new Map(
        Array.from({ length: 64 }, (_, index) => [
          `Notes/${String(index).padStart(2, '0')}.md`,
          `문서 ${index}`,
        ]),
      ),
    );
    const prompts: string[] = [];
    const chat = vi.fn((messages: ChatMessage[]) => {
      const prompt = lastPrompt(messages);
      prompts.push(prompt);
      if (prompt.includes('Write the final answer')) return Promise.resolve('최종 요약');
      if (prompt.includes('Compress the following research summary batch')) {
        return Promise.resolve(`축약 ${'나'.repeat(1_000)}`);
      }
      return Promise.resolve(`배치 요약 ${'가'.repeat(12_000)}`);
    });

    await new VaultResearchAgent({ chat }, runtime).run({
      question: '볼트 전체를 요약해줘',
    });
    const finalPrompt = prompts.find((prompt) => prompt.includes('Write the final answer'));
    const evidenceDigests = finalPrompt?.split('Evidence digests:\n\n')[1] ?? '';

    expect(finalPrompt).toBeDefined();
    expect(
      prompts.filter((prompt) => prompt.includes('Compress the following research summary batch')),
    ).toHaveLength(2);
    expect(evidenceDigests.length).toBeLessThanOrEqual(80_000);
    expect(finalPrompt).not.toContain('배치 요약');
  });

  it('64개 장문 요약에서도 호출 상한을 지키고 final에 도달한 근거만 분석했다고 기록한다', async () => {
    const runtime = createRuntime(
      new Map(
        Array.from({ length: 64 }, (_, index) => [
          `Notes/${String(index).padStart(2, '0')}.md`,
          `문서 ${index}`,
        ]),
      ),
    );
    const prompts: string[] = [];
    let mapCall = 0;
    let reduceCall = 0;
    const chat = vi.fn((messages: ChatMessage[]) => {
      const prompt = lastPrompt(messages);
      prompts.push(prompt);
      if (prompt.includes('Rewrite the answer')) {
        return Promise.resolve(
          '볼트 전체를 로컬로 선별했고 최종 합성에 전달된 선택 근거만 분석했습니다. [vault:Notes/63.md:1-1]',
        );
      }
      if (prompt.includes('Write the final answer')) {
        return Promise.resolve('모든 파일을 전부 읽고 분석했습니다.');
      }
      if (prompt.includes('Compress the following research summary batch')) {
        reduceCall += 1;
        return Promise.resolve(`축약 ${reduceCall} ${'나'.repeat(30_000)}`);
      }
      mapCall += 1;
      return Promise.resolve(`배치 ${mapCall} ${'가'.repeat(30_000)}`);
    });

    const result = await new VaultResearchAgent({ chat }, runtime).run({
      question: '볼트 전체를 요약해줘',
    });
    const finalPrompt = prompts.find((prompt) => prompt.includes('Write the final answer'));

    expect(result.providerRequestBudget.maxRequests).toBe(12);
    expect(chat).toHaveBeenCalledTimes(result.providerRequestBudget.maxRequests);
    expect(result.coverage).toMatchObject({
      providerAnalyzedCount: 32,
      providerOmittedCount: 32,
      allSelectedEvidenceAnalyzed: false,
      exactNegativeAllowed: false,
    });
    expect(result.coverage.reasonCodes).toEqual(
      expect.arrayContaining(['provider-analysis-incomplete', 'provider-omitted']),
    );
    expect(finalPrompt).toContain('"analyzedCandidates":32');
    expect(finalPrompt).toContain('"omittedCandidates":32');
    expect(result.content).not.toContain('모든 파일을 전부 읽고 분석했습니다');
    expect(result.content).toContain('[vault:Notes/63.md:1-1]');
    expect(result.citations.map((citation) => citation.id)).not.toContain('vault:Notes/63.md:1-1');
  });

  it('전수 읽기·광범위 부재 단정은 한 번 repair하고 안전한 답만 남긴다', async () => {
    const files = new Map(
      Array.from({ length: 65 }, (_, index) => [`Notes/${index}.md`, `문서 ${index}`] as const),
    );
    const runtime = createRuntime(files);
    const chat = vi.fn((messages: ChatMessage[]) => {
      const prompt = lastPrompt(messages);
      if (prompt.includes('Rewrite the answer')) {
        return Promise.resolve(
          '볼트 전체를 로컬로 선별했지만 provider 예산으로 선택 근거 일부만 분석했습니다.',
        );
      }
      if (prompt.includes('Write the final answer')) {
        return Promise.resolve('모든 파일을 전부 읽었고 관련 자료는 전혀 없습니다.');
      }
      return Promise.resolve('선택 근거 요약');
    });

    const result = await new VaultResearchAgent({ chat }, runtime).run({
      question: '볼트 전체를 요약해줘',
    });

    expect(result.selection.omittedCandidateCount).toBe(1);
    expect(result.coverage.exactNegativeAllowed).toBe(false);
    expect(
      chat.mock.calls.some(([messages]) => lastPrompt(messages).includes('Rewrite the answer')),
    ).toBe(true);
    expect(result.content).not.toContain('관련 자료는 전혀 없습니다');
    expect(result.content).toContain('선택 근거 일부만 분석했습니다');
  });

  it('영어 UI의 repair 문구는 답변에 한국어 고유명사가 있어도 영어를 유지한다', async () => {
    setLanguage('en');
    const repairPrompts: string[] = [];
    const chat = vi.fn((messages: ChatMessage[]) => {
      const prompt = lastPrompt(messages);
      if (prompt.includes('Rewrite the answer')) {
        repairPrompts.push(prompt);
        return Promise.resolve(
          'The whole vault was screened locally, but selected-evidence analysis is incomplete.',
        );
      }
      if (prompt.includes('Write the final answer')) {
        return Promise.resolve('After checking every note, I found evidence about Quillon.');
      }
      return Promise.resolve('Evidence about Quillon.');
    });

    await new VaultResearchAgent(
      { chat },
      createRuntime(
        new Map(
          Array.from({ length: 65 }, (_, index) => [
            `Notes/${String(index).padStart(2, '0')}.md`,
            `퀼런 관련 근거 ${index}`,
          ]),
        ),
      ),
    ).run({ question: '볼트 전체를 요약해줘' });

    expect(repairPrompts).toHaveLength(1);
    expect(repairPrompts[0]).toContain(
      'Required coverage wording: The whole vault was screened locally, but selected-evidence analysis is incomplete.',
    );
    expect(repairPrompts[0]).not.toContain('Required coverage wording: 볼트');
  });

  it('일시적인 provider 실패만 제한적으로 재시도한다', async () => {
    const wait = vi.fn<(delayMs: number, signal?: AbortSignal) => Promise<void>>(() =>
      Promise.resolve(),
    );
    let failed = false;
    const chat = vi.fn((messages: ChatMessage[]) => {
      const prompt = lastPrompt(messages);
      if (!failed) {
        failed = true;
        return Promise.reject(createProviderError('rate limited', 429, 25));
      }
      return Promise.resolve(
        prompt.includes('Write the final answer')
          ? '최종 요약 [vault:Alpha.md:1-1]'
          : '문서 요약 [vault:Alpha.md:1-1]',
      );
    });

    const result = await new VaultResearchAgent(
      { chat },
      createRuntime(new Map([['Alpha.md', 'Alpha 내용']])),
      { wait },
    ).run({ question: '볼트 전체를 요약해줘' });

    expect(result.processedFiles).toBe(1);
    expect(wait).toHaveBeenCalledOnce();
    expect(wait.mock.calls[0]?.[0]).toBe(500);
    expect(wait.mock.calls[0]?.[1]).toBeUndefined();
  });

  it('모든 논리 단계에 걸쳐 provider 실제 시도 상한을 공유하고 초과 retry를 건너뛴다', async () => {
    const wait = vi.fn<(delayMs: number, signal?: AbortSignal) => Promise<void>>(() =>
      Promise.resolve(),
    );
    let attempt = 0;
    const chat = vi.fn((messages: ChatMessage[]) => {
      attempt += 1;
      if (attempt % 2 === 1) {
        return Promise.reject(createProviderError('rate limited', 429, 25));
      }
      const prompt = lastPrompt(messages);
      return Promise.resolve(
        prompt.includes('Write the final answer') ? '최종 요약' : `근거 요약 ${attempt}`,
      );
    });
    const files = new Map(
      Array.from({ length: 64 }, (_, index) => [
        `Notes/${String(index).padStart(2, '0')}.md`,
        `문서 ${index}`,
      ]),
    );

    const result = await new VaultResearchAgent({ chat }, createRuntime(files), { wait }).run({
      question: '볼트 전체를 요약해줘',
    });

    expect(chat.mock.calls.length).toBeLessThanOrEqual(
      result.providerRequestBudget.maxProviderAttempts,
    );
    expect(wait).toHaveBeenCalledTimes(3);
    expect(result.content).toContain('최종 요약');
    expect(result.coverage.providerAnalyzedCount).toBeLessThan(result.totalFiles);
  });

  it('누적 retry 대기 상한을 넘기지 않고 남은 근거로 최종 요약한다', async () => {
    const wait = vi.fn<(delayMs: number, signal?: AbortSignal) => Promise<void>>(() =>
      Promise.resolve(),
    );
    let attempt = 0;
    const chat = vi.fn((messages: ChatMessage[]) => {
      attempt += 1;
      if (attempt === 1 || attempt === 3) {
        return Promise.reject(createProviderError('provider server error', 503, 30_000));
      }
      const prompt = lastPrompt(messages);
      return Promise.resolve(
        prompt.includes('Write the final answer') ? '남은 근거의 최종 요약' : '근거 요약',
      );
    });
    const files = new Map(
      Array.from({ length: 16 }, (_, index) => [`Notes/${index}.md`, `문서 ${index}`]),
    );

    const result = await new VaultResearchAgent({ chat }, createRuntime(files), { wait }).run({
      question: '볼트 전체를 요약해줘',
    });

    expect(wait).toHaveBeenCalledOnce();
    expect(wait.mock.calls[0]?.[0]).toBe(result.providerRequestBudget.maxRetryWaitMs);
    expect(result.content).toContain('남은 근거의 최종 요약');
    expect(result.coverage).toMatchObject({
      providerAnalyzedCount: 8,
      providerOmittedCount: 8,
      allSelectedEvidenceAnalyzed: false,
    });
  });

  it('사용하지 않은 reduce 단계는 닫고 실제 시도 상한 안에서 repair 한 번을 보장한다', async () => {
    const wait = vi.fn<(delayMs: number, signal?: AbortSignal) => Promise<void>>(() =>
      Promise.resolve(),
    );
    let mapAttempts = 0;
    let finalAttempts = 0;
    const chat = vi.fn((messages: ChatMessage[]) => {
      const prompt = lastPrompt(messages);
      if (prompt.includes('Analyze this locally selected vault-evidence batch.')) {
        mapAttempts += 1;
        return mapAttempts <= 2
          ? Promise.reject(createProviderError('provider server error', 503, 25))
          : Promise.resolve('근거 요약');
      }
      if (prompt.includes('Write the final answer')) {
        finalAttempts += 1;
        return finalAttempts === 1
          ? Promise.reject(createProviderError('provider server error', 503, 25))
          : Promise.resolve('모든 파일을 전부 읽었습니다.');
      }
      if (prompt.includes('Rewrite the answer')) {
        return Promise.resolve('볼트 전체를 로컬로 선별했고 선택된 근거를 분석했습니다.');
      }
      return Promise.reject(new Error('unexpected provider prompt'));
    });

    const result = await new VaultResearchAgent(
      { chat },
      createRuntime(new Map([['Alpha.md', `Alpha 내용 ${'가'.repeat(10_000)}`]])),
      { wait },
    ).run({ question: '볼트 전체를 요약해줘' });

    expect(chat).toHaveBeenCalledTimes(result.providerRequestBudget.maxProviderAttempts);
    expect(
      chat.mock.calls.filter(([messages]) => lastPrompt(messages).includes('Rewrite the answer')),
    ).toHaveLength(1);
    expect(result.content).toContain('선택된 근거를 분석했습니다');
    expect(result.content).not.toContain('모든 파일을 전부 읽었습니다');
  });

  it('인증 오류는 재시도하지 않고 즉시 전달한다', async () => {
    const wait = vi.fn<(delayMs: number, signal?: AbortSignal) => Promise<void>>(() =>
      Promise.resolve(),
    );
    const chat = vi.fn(() => Promise.reject(createProviderError('invalid api key', 401)));
    const agent = new VaultResearchAgent(
      { chat },
      createRuntime(new Map([['Alpha.md', 'Alpha 내용']])),
      { wait },
    );

    await expect(agent.run({ question: '볼트 전체를 요약해줘' })).rejects.toMatchObject({
      status: 401,
    });
    expect(chat).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it('취소 신호가 이미 중단됐으면 도구나 모델을 호출하지 않는다', async () => {
    const execute = vi.fn(() => Promise.reject(new Error('호출되면 안 됨')));
    const chat = vi.fn(() => Promise.reject(new Error('호출되면 안 됨')));
    const controller = new AbortController();
    controller.abort();
    const agent = new VaultResearchAgent({ chat }, { isNativeTool: () => true, execute });

    await expect(
      agent.run({ question: '볼트 전체를 요약해줘', signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(execute).not.toHaveBeenCalled();
    expect(chat).not.toHaveBeenCalled();
  });
});

interface RuntimeOptions {
  unreadablePaths?: ReadonlySet<string>;
  segmentsByPath?: ReadonlyMap<string, readonly RuntimeReadSegment[]>;
}

interface RuntimeReadSegment {
  startLine: number;
  endLine: number;
  content: string;
}

function createRuntime(
  files: ReadonlyMap<string, string>,
  options: RuntimeOptions = {},
): NativeVaultToolRuntimeLike & {
  execute: ReturnType<typeof vi.fn<NativeVaultToolRuntimeLike['execute']>>;
} {
  const inventory = [...files.entries()].map(([path, content]) => ({
    path,
    modifiedAt: 1,
    size: content.length,
  }));
  const execute = vi.fn<NativeVaultToolRuntimeLike['execute']>((argumentsText) => {
    const request = JSON.parse(argumentsText) as {
      action: string;
      path?: string;
      cursor?: number;
      limit?: number;
      start_line?: number;
    };
    if (request.action === 'list') {
      const cursor = request.cursor ?? 0;
      const limit = request.limit ?? 100;
      const page = inventory.slice(cursor, cursor + limit);
      const nextCursor = cursor + page.length < inventory.length ? cursor + page.length : null;
      return Promise.resolve(
        result({
          action: 'list',
          path: '',
          exists: true,
          files: page,
          nextCursor,
          total: inventory.length,
          citations: [],
        }),
      );
    }
    if (request.action !== 'read' || !request.path) {
      return Promise.reject(new Error(`unexpected action: ${request.action}`));
    }
    if (options.unreadablePaths?.has(request.path)) {
      return Promise.reject(new Error('adapter read failure'));
    }
    const content = files.get(request.path);
    if (content === undefined) return Promise.reject(new Error('missing note'));
    const configuredSegments = options.segmentsByPath?.get(request.path);
    const segments =
      configuredSegments && configuredSegments.length > 0
        ? configuredSegments
        : [{ startLine: 1, endLine: 1, content }];
    const requestedStartLine = request.start_line ?? 1;
    const segmentIndex = segments.findIndex((segment) => segment.startLine === requestedStartLine);
    const segment = segments[segmentIndex];
    if (!segment) return Promise.reject(new Error(`missing segment at line ${requestedStartLine}`));
    const totalLines = segments.at(-1)?.endLine ?? segment.endLine;
    const citation = {
      id: `vault:${request.path}:${segment.startLine}-${segment.endLine}`,
      filePath: request.path,
      line: segment.startLine,
      endLine: segment.endLine,
      preview: segment.content.slice(0, 300),
      status: 'verified' as const,
    };
    return Promise.resolve(
      result({
        action: 'read',
        path: request.path,
        startLine: segment.startLine,
        endLine: segment.endLine,
        totalLines,
        truncated: segmentIndex < segments.length - 1,
        content: segment.content,
        citations: [citation],
      }),
    );
  });
  return { isNativeTool: () => true, execute };
}

function createSegmentedRuntime(
  segmentsByPath: ReadonlyMap<string, readonly RuntimeReadSegment[]>,
): ReturnType<typeof createRuntime> {
  return createRuntime(
    new Map(
      [...segmentsByPath].map(([path, segments]) => [
        path,
        segments.map((segment) => segment.content).join('\n'),
      ]),
    ),
    { segmentsByPath },
  );
}

function result<T extends { citations: NativeVaultToolExecutionResult['citations'] }>(
  payload: T,
): NativeVaultToolExecutionResult {
  return {
    displayText: 'ok',
    modelText: JSON.stringify(payload),
    citations: payload.citations,
  };
}

function lastPrompt(messages: ChatMessage[]): string {
  return messages.at(-1)?.content ?? '';
}

function readRequests(
  runtime: ReturnType<typeof createRuntime>,
): Array<{ action: string; path?: string }> {
  return runtime.execute.mock.calls
    .map(([argumentsText]) => JSON.parse(argumentsText) as { action: string; path?: string })
    .filter((request) => request.action === 'read');
}

function listRequests(
  runtime: ReturnType<typeof createRuntime>,
): Array<{ action: string; cursor?: number }> {
  return runtime.execute.mock.calls
    .map(([argumentsText]) => JSON.parse(argumentsText) as { action: string; cursor?: number })
    .filter((request) => request.action === 'list');
}

function createProviderError(message: string, status: number, retryAfterMs?: number): Error {
  return Object.assign(new Error(message), { status, retryAfterMs });
}
