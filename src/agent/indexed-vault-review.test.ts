import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../i18n';
import { LLMProviderHttpError, type ChatMessage, type LLMProvider } from '../llm/providers';
import {
  planIndexedEvidenceRust,
  planModelContextRust,
  verifyIndexedEvidenceRust,
  type RustIndexedEvidencePlan,
  type RustIndexedEvidenceVerification,
} from '../rag/rust-core';
import {
  reviewIndexedVault,
  searchIndexedVault,
  type IndexedVaultCorpus,
  type IndexedVaultReviewOptions,
} from './indexed-vault-review';

vi.mock('../rag/rust-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../rag/rust-core')>();
  return {
    ...actual,
    planIndexedEvidenceRust: vi.fn(actual.planIndexedEvidenceRust),
    verifyIndexedEvidenceRust: vi.fn(actual.verifyIndexedEvidenceRust),
  };
});

const RELEVANT = 'Synthetic/Relevant.md';
const OTHER = 'Synthetic/Other.md';
const SOURCE_ID = RELEVANT + '#L3-L4';

function corpusFixture(): IndexedVaultCorpus {
  const records = [
    {
      filePath: RELEVANT,
      contentHash: 'hash-relevant',
      sourceMtime: 1,
      sourceSize: 10,
      vectorCount: 1,
      updated: 1,
    },
    {
      filePath: OTHER,
      contentHash: 'hash-other',
      sourceMtime: 1,
      sourceSize: 10,
      vectorCount: 1,
      updated: 1,
    },
  ];
  const entries = [
    {
      id: 'chunk-relevant',
      vector: [],
      metadata: {
        filePath: RELEVANT,
        startLine: 3,
        endLine: 4,
        text: 'Quartz restarts only after two cooling cycles.',
        contentHash: 'hash-relevant',
      },
    },
    {
      id: 'chunk-other',
      vector: [],
      metadata: {
        filePath: OTHER,
        startLine: 1,
        endLine: 1,
        text: 'Delivery schedule for the northern region.',
        contentHash: 'hash-other',
      },
    },
  ];
  return {
    getEntriesByFilePaths: (paths) =>
      Promise.resolve(entries.filter((entry) => paths.includes(entry.metadata.filePath))),
    getFileIndexRecords: () => Promise.resolve(records),
  };
}

function planFixture(): RustIndexedEvidencePlan {
  return {
    queryTokens: [],
    phrases: [],
    order: [SOURCE_ID],
    evidence: [
      {
        sourceId: SOURCE_ID,
        path: RELEVANT,
        revision: '1:10',
        startLine: 3,
        endLine: 4,
        quote: 'Quartz restarts only after two cooling cycles.',
        contextBefore: '',
        contextAfter: '',
        score: 1,
        rank: 1,
        signal: 'lexical',
        phraseMatches: 1,
        proximityScore: 1,
        fieldScore: 1,
        exactSignals: [],
        fieldMatches: [],
        negatedNearby: false,
        highlights: [],
        duplicateOf: null,
      },
    ],
    diagnostics: {
      candidateDepth: 2,
      candidateDocuments: 2,
      selectedDocuments: 1,
      truncated: false,
      droppedDocuments: { budget: 0, belowThreshold: 1, filtered: 0 },
      zeroHitReason: null,
      unmatchedTerms: [],
      candidateChunks: 2,
      selectedChunks: 1,
      missingCandidatePaths: 0,
    },
    coverage: {
      status: 'supported',
      reviewedDocuments: 2,
      unreviewedDocuments: 0,
      notIndexedDocuments: 0,
    },
    budget: { maxDocuments: 64, maxPassages: 24, maxChars: 262_144, usedChars: 120 },
  };
}

function verificationFixture(): RustIndexedEvidenceVerification {
  return {
    statuses: [
      {
        sourceId: SOURCE_ID,
        path: RELEVANT,
        status: 'verified',
        exists: true,
        lineMatches: true,
        offsetMatches: null,
        revisionState: 'match',
        scopeState: 'in-scope',
        reviewState: 'reviewed',
        duplicateOf: null,
      },
    ],
  };
}

function twoDocumentPlan(): RustIndexedEvidencePlan {
  const fixture = planFixture();
  const first = fixture.evidence[0];
  if (!first) throw new Error('plan fixture without evidence');
  return {
    ...fixture,
    order: [SOURCE_ID, OTHER + '#L1-L1'],
    evidence: [
      first,
      {
        ...first,
        sourceId: OTHER + '#L1-L1',
        path: OTHER,
        revision: '1:10',
        startLine: 1,
        endLine: 1,
        quote: 'Delivery schedule for the northern region.',
        rank: 2,
      },
    ],
    diagnostics: {
      ...fixture.diagnostics,
      candidateDocuments: 2,
      candidateChunks: 2,
      selectedDocuments: 2,
      selectedChunks: 2,
      droppedDocuments: { budget: 0, belowThreshold: 0, filtered: 0 },
    },
    coverage: { ...fixture.coverage, reviewedDocuments: 2 },
  };
}

function verifiedStatuses(input: Parameters<typeof verifyIndexedEvidenceRust>[0]) {
  return {
    statuses: input.evidence.map((item) => ({
      sourceId: item.sourceId,
      path: item.path,
      status: 'verified' as const,
      exists: true,
      lineMatches: true,
      offsetMatches: null,
      revisionState: 'match' as const,
      scopeState: 'in-scope' as const,
      reviewState: 'reviewed' as const,
      duplicateOf: null,
    })),
  };
}

function answerProvider(): { provider: LLMProvider; calls: ChatMessage[][] } {
  const calls: ChatMessage[][] = [];
  const provider = {
    streamChat: async (messages: ChatMessage[], consume: (chunk: { content: string }) => void) => {
      calls.push(messages);
      consume({
        content: JSON.stringify({
          paragraphs: [{ text: '두 번 냉각한 뒤 재시작합니다.', sources: [SOURCE_ID] }],
        }),
      });
      return Promise.resolve();
    },
  } as unknown as LLMProvider;
  calls.length = 0;
  return { provider, calls };
}

function reviewOptions(
  overrides: Partial<IndexedVaultReviewOptions> = {},
): IndexedVaultReviewOptions {
  return {
    question: 'Quartz cooling cycles',
    indexedPaths: [RELEVANT, OTHER],
    scopes: [],
    corpus: corpusFixture(),
    candidates: [
      { path: RELEVANT, score: 2, source: 'bm25', rank: 1 },
      { path: OTHER, score: 1, source: 'bm25', rank: 2 },
    ],
    revisionReader: () => Promise.resolve('1:10'),
    provider: answerProvider().provider,
    ...overrides,
  };
}

describe('엔진 근거 기반 색인 검토', () => {
  it('기본 review는 후보만 조회하고 all은 명시할 때 전체를 조회한다', async () => {
    const corpus = corpusFixture();
    const read = vi.spyOn(corpus, 'getEntriesByFilePaths');
    const options = reviewOptions({
      corpus,
      candidates: [{ path: RELEVANT, score: 1, source: 'bm25', rank: 1 }],
      deferAnswer: true,
    });
    const candidate = await reviewIndexedVault(options);
    expect(read.mock.calls).toEqual([[[RELEVANT]]]);
    expect(candidate.dossier.documentScope).toBe('candidates');
    expect(candidate.totalFiles).toBe(1);
    read.mockClear();
    const all = await reviewIndexedVault({ ...options, documentScope: 'all' });
    expect(read.mock.calls).toEqual([[[RELEVANT, OTHER]]]);
    expect(all.dossier.documentScope).toBe('all');
  });

  it.each([
    ['initializing', 'indexing', 'indexedReviewIndexing'],
    ['indexing', 'indexing', 'indexedReviewIndexing'],
    ['unavailable', 'engine-unavailable', 'indexedReviewSearchUnavailable'],
  ] as const)(
    '%s 상태는 LLM과 도구 없이 현재 엔진 상태를 반환한다',
    async (candidatesState, outcome, messageKey) => {
      const streamChat = vi.fn<LLMProvider['streamChat']>();
      const result = await reviewIndexedVault(
        reviewOptions({ candidatesState, provider: { streamChat } }),
      );
      expect(result.outcome).toBe(outcome);
      expect(result.evidence).toEqual([]);
      expect(result.content).toBe(t(messageKey));
      expect(result.coverage.status).toBe('incomplete');
      expect(streamChat).not.toHaveBeenCalled();
    },
  );

  it.each(['format', 'http'] as const)(
    '%s 오류 후에도 verified 근거와 인용을 evidence-only로 반환한다',
    async (failure) => {
      const streamChat = vi.fn((...args: Parameters<LLMProvider['streamChat']>) => {
        if (failure === 'http')
          return Promise.reject(new LLMProviderHttpError('synthetic failure', 503));
        args[1]({ content: '{"invalid":true}', done: false });
        return Promise.resolve();
      });
      const result = await reviewIndexedVault(reviewOptions({ provider: { streamChat } }));
      expect(streamChat).toHaveBeenCalledTimes(failure === 'format' ? 2 : 1);
      expect(result.outcome).toBe('evidence-only');
      expect(result.evidence).toHaveLength(1);
      expect(result.dossier.evidence).toEqual(result.evidence);
      expect(result.citations[0]).toMatchObject({ id: SOURCE_ID, status: 'verified' });
      expect(result.content).toContain('> Quartz restarts');
      expect(result.content).not.toContain('{"invalid"');
      expect(result).not.toHaveProperty('toolFallback');
      const payload: unknown = JSON.parse(String(streamChat.mock.calls[0]?.[0]?.[1]?.content));
      expect(payload).toEqual(result.dossier);
      expect(streamChat.mock.calls[0]?.[4]?.toolChoice).toBe('none');
    },
  );

  it('provider의 AbortError는 evidence-only로 삼키지 않는다', async () => {
    const streamChat = vi.fn(() => Promise.reject(new DOMException('cancelled', 'AbortError')));
    await expect(
      reviewIndexedVault(reviewOptions({ provider: { streamChat } })),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('검증 근거가 0개면 dossier와 no-evidence만 반환하고 모델을 호출하지 않는다', async () => {
    const plan = planFixture();
    vi.mocked(planIndexedEvidenceRust).mockReturnValue({ ...plan, evidence: [], order: [] });
    vi.mocked(verifyIndexedEvidenceRust).mockReturnValue({ statuses: [] });
    const { provider, calls } = answerProvider();
    const result = await reviewIndexedVault(reviewOptions({ provider }));
    expect(calls).toHaveLength(0);
    expect(result.outcome).toBe('no-evidence');
    expect(result.dossier.evidence).toEqual([]);
    expect(result.citations).toEqual([]);
  });

  it('후보가 없으면 기본 review는 저장소와 모델을 읽지 않고 빈 dossier를 반환한다', async () => {
    const actual = await vi.importActual<typeof import('../rag/rust-core')>('../rag/rust-core');
    vi.mocked(planIndexedEvidenceRust).mockImplementation(actual.planIndexedEvidenceRust);
    vi.mocked(verifyIndexedEvidenceRust).mockImplementation(actual.verifyIndexedEvidenceRust);
    const corpus = corpusFixture();
    const read = vi.spyOn(corpus, 'getEntriesByFilePaths');
    const records = vi.spyOn(corpus, 'getFileIndexRecords');
    const { provider, calls } = answerProvider();
    const result = await reviewIndexedVault(
      reviewOptions({ corpus, provider, candidates: undefined }),
    );
    expect(read).not.toHaveBeenCalled();
    expect(records).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
    expect(result.outcome).toBe('no-evidence');
    expect(result.coverage.requestedPaths).toEqual([]);
  });

  it('질문·검색 질문·이전 사용자 질문은 dossier에 보존한다', async () => {
    const { provider, calls } = answerProvider();
    const result = await reviewIndexedVault(
      reviewOptions({
        provider,
        question: 'Follow-up?',
        scoringQuestion: 'Quartz cooling cycles',
        previousUserQuestions: ['Original question?'],
      }),
    );
    expect(result.dossier).toMatchObject({
      question: 'Follow-up?',
      scoringQuestion: 'Quartz cooling cycles',
      previousUserQuestions: ['Original question?'],
    });
    const payload: unknown = JSON.parse(String(calls[0]?.[1]?.content));
    expect(payload).toEqual(result.dossier);
  });

  it('입력 예산을 넘으면 모델을 호출하지 않고 evidence-only를 반환한다', async () => {
    const { provider, calls } = answerProvider();
    const budget = planModelContextRust({});
    if (!budget) throw new Error('모델 예산 계약을 초기화하지 못했습니다.');
    const contextBudget = { ...budget, inputBytes: 1 };
    const result = await reviewIndexedVault(
      reviewOptions({ provider: { ...provider, contextBudget } }),
    );
    expect(calls).toHaveLength(0);
    expect(result.outcome).toBe('evidence-only');
    expect(result.citations[0]?.status).toBe('verified');
    expect(result.providerTransfer.sentFiles).toBe(0);
  });

  it('진행 중 취소와 늦은 provider 응답은 결과·콜백을 만들지 않는다', async () => {
    const controller = new AbortController();
    const onAnswer = vi.fn();
    let finish: (() => void) | undefined;
    let consume: Parameters<LLMProvider['streamChat']>[1] | undefined;
    const streamChat = vi.fn((...args: Parameters<LLMProvider['streamChat']>) => {
      consume = args[1];
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    const pending = reviewIndexedVault(
      reviewOptions({ provider: { streamChat }, signal: controller.signal, onAnswer }),
    );
    const observed = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(streamChat).toHaveBeenCalledTimes(1));
    controller.abort();
    await observed;
    consume?.({ content: '{"late":true}', done: false });
    finish?.();
    await Promise.resolve();
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it('현재 원문 revision 조회가 멈춰도 취소는 즉시 완료된다', async () => {
    const controller = new AbortController();
    const revisionReader = vi.fn(() => new Promise<string | null>(() => undefined));
    const pending = reviewIndexedVault(
      reviewOptions({ revisionReader, signal: controller.signal }),
    );
    const outcome = pending.catch((error: unknown) => error);
    await vi.waitFor(() => expect(revisionReader).toHaveBeenCalledTimes(1));
    controller.abort();
    const result: unknown = await Promise.race([
      outcome,
      new Promise((resolve) => setTimeout(() => resolve({ name: 'timeout' }), 100)),
    ]);
    expect(result).toMatchObject({ name: 'AbortError' });
  });

  it('evidence-only의 Markdown은 원문 이미지·링크·HTML을 실행하지 않는다', async () => {
    const plan = planFixture();
    const quote = '![tracking](https://example.com/image)\n<script>bad()</script>\n[[Private]]';
    vi.mocked(planIndexedEvidenceRust).mockReturnValue({
      ...plan,
      evidence: plan.evidence.map((item) => ({ ...item, quote })),
    });
    const result = await reviewIndexedVault(reviewOptions({ deferAnswer: true }));
    expect(result.evidence[0]?.quote).toBe(quote);
    expect(result.content).not.toContain('![');
    expect(result.content).not.toContain('<script>');
    expect(result.content).not.toContain('[[Private]]');
    expect(result.content).toContain('&#60;script&#62;');
    expect(result.content).toContain('\n> ');
    expect(result.citations[0]?.preview).toBe(quote);
  });
  beforeEach(() => {
    vi.mocked(planIndexedEvidenceRust).mockReturnValue(planFixture());
    vi.mocked(verifyIndexedEvidenceRust).mockReturnValue(verificationFixture());
  });

  it('엔진이 채택·검증한 근거만 인용하고 최종 해석 한 번만 호출한다', async () => {
    const { provider, calls } = answerProvider();
    const result = await reviewIndexedVault(reviewOptions({ provider }));
    expect(calls).toHaveLength(1);
    const instruction = calls[0]?.[0]?.content ?? '';
    expect(instruction).toContain(t('llmIndexedReviewAnswer'));
    expect(result.outcome).toBe('answered');
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0]?.filePath).toBe(RELEVANT);
    expect(result.citations[0]?.line).toBe(3);
    expect(result.content).toContain('두 번 냉각한 뒤');
  });

  it('엔진이 없으면 engine-unavailable을 반환하고 LLM을 부르지 않는다', async () => {
    vi.mocked(planIndexedEvidenceRust).mockReturnValue(null);
    const { provider, calls } = answerProvider();
    const result = await reviewIndexedVault(reviewOptions({ provider }));
    expect(calls).toHaveLength(0);
    expect(result.outcome).toBe('engine-unavailable');
    expect(result.engineUnavailable).toBe(true);
    expect(result.citations).toHaveLength(0);
  });

  it('현재 vault 리비전이 어긋난 채택 문서는 인용에서 제외한다', async () => {
    const { provider, calls } = answerProvider();
    const result = await reviewIndexedVault(
      reviewOptions({ provider, revisionReader: () => Promise.resolve('2:99') }),
    );
    expect(calls).toHaveLength(0);
    expect(result.citations).toHaveLength(0);
    expect(result.outcome).toBe('no-evidence');
  });

  it('stale로 제거된 근거는 채택·coverage에서 제거 이후 기준으로 다시 반영한다', async () => {
    vi.mocked(planIndexedEvidenceRust).mockReturnValue(twoDocumentPlan());
    vi.mocked(verifyIndexedEvidenceRust).mockImplementation(verifiedStatuses);
    const { provider, calls } = answerProvider();
    const result = await reviewIndexedVault(
      reviewOptions({
        provider,
        revisionReader: (path) => Promise.resolve(path === RELEVANT ? '1:10' : '2:99'),
      }),
    );
    expect(calls).toHaveLength(1);
    expect(result.citations.map((citation) => citation.filePath)).toEqual([RELEVANT]);
    expect(result.providerTransfer.sentFiles).toBe(1);
    expect(result.outcome).toBe('answered');
    // 제거된 문서는 채택 문서·coverage에서 빠지고 원문 재확인 실패 문서로만 남습니다.
    expect(result.coverageNotice).toBe(
      t('indexedReviewIncompleteNotice', {
        total: 2,
        accepted: 1,
        machineExcluded: 0,
        rejected: 0,
        budgetExcluded: 0,
        notIndexed: 0,
        unreviewed: 1,
        unreadable: 1,
      }),
    );
    expect(result.rejectedFiles).toBe(0);
  });

  it('stale 제거로 결과가 비면 no-evidence와 미완료 고지를 유지한다', async () => {
    vi.mocked(planIndexedEvidenceRust).mockReturnValue(twoDocumentPlan());
    vi.mocked(verifyIndexedEvidenceRust).mockImplementation(verifiedStatuses);
    const { provider, calls } = answerProvider();
    const result = await reviewIndexedVault(
      reviewOptions({ provider, revisionReader: () => Promise.resolve('2:99') }),
    );
    expect(calls).toHaveLength(0);
    expect(result.citations).toHaveLength(0);
    expect(result.outcome).toBe('no-evidence');
    expect(result.engineUnavailable).toBe(false);
    expect(result.coverageNotice).toBe(result.content);
    expect(result.content).toBe(
      t('indexedReviewIncompleteNotice', {
        total: 2,
        accepted: 0,
        machineExcluded: 0,
        rejected: 0,
        budgetExcluded: 0,
        notIndexed: 0,
        unreviewed: 2,
        unreadable: 2,
      }),
    );
  });

  it('중복 vault 접두사는 첫 원문을 assistant로 전달해 정확한 ID로 한 번 교정한다', async () => {
    const calls: ChatMessage[][] = [];
    let attempt = 0;
    const invalidAnswer = JSON.stringify({
      paragraphs: [{ text: '형식 오류', sources: [`vault:vault:${SOURCE_ID}`] }],
    });
    const provider = {
      streamChat: (messages: ChatMessage[], consume: (chunk: { content: string }) => void) => {
        calls.push(messages);
        attempt += 1;
        consume({
          content:
            attempt === 1
              ? invalidAnswer
              : JSON.stringify({
                  paragraphs: [{ text: '두 번 냉각한 뒤 재시작합니다.', sources: [SOURCE_ID] }],
                }),
        });
        return Promise.resolve();
      },
    } as unknown as LLMProvider;
    const result = await reviewIndexedVault(reviewOptions({ provider }));
    expect(calls).toHaveLength(2);
    expect(result.diagnostics.counts.answerCorrectionRequests).toBe(1);
    expect(result.content).toContain('두 번 냉각한 뒤');
    expect(calls[1]).toContainEqual({ role: 'assistant', content: invalidAnswer });
    expect(calls[1]?.at(-1)).toEqual({
      role: 'user',
      content: t('llmIndexedReviewAnswerCorrection'),
    });
    expect(calls[0]?.[0]?.content).toContain('sourceId를 그대로 복사');
    expect(calls[1]?.at(-1)?.content).toContain('vault: 접두사를 붙이지');
  });

  it('단일 vault 접두사는 원본 sourceId로 정규화해 교정 없이 채택한다', async () => {
    const calls: ChatMessage[][] = [];
    const provider = {
      streamChat: (messages: ChatMessage[], consume: (chunk: { content: string }) => void) => {
        calls.push(messages);
        consume({
          content: JSON.stringify({
            paragraphs: [
              { text: '두 번 냉각한 뒤 재시작합니다.', sources: ['vault:' + SOURCE_ID] },
            ],
          }),
        });
        return Promise.resolve();
      },
    } as unknown as LLMProvider;
    const result = await reviewIndexedVault(reviewOptions({ provider }));
    expect(calls).toHaveLength(1);
    expect(result.diagnostics.counts.answerCorrectionRequests).toBe(0);
    expect(result.content).toContain('두 번 냉각한 뒤');
  });

  it('첫 응답이 빈 문자열이면 assistant 원문 없이 교정 요청을 한 번 수행한다', async () => {
    const calls: ChatMessage[][] = [];
    let attempt = 0;
    const provider = {
      streamChat: (messages: ChatMessage[], consume: (chunk: { content: string }) => void) => {
        calls.push(messages);
        attempt += 1;
        consume({
          content:
            attempt === 1
              ? ''
              : JSON.stringify({
                  paragraphs: [{ text: '두 번 냉각한 뒤 재시작합니다.', sources: [SOURCE_ID] }],
                }),
        });
        return Promise.resolve();
      },
    } as unknown as LLMProvider;
    const result = await reviewIndexedVault(reviewOptions({ provider }));
    expect(calls).toHaveLength(2);
    expect(result.diagnostics.counts.answerCorrectionRequests).toBe(1);
    expect(calls[1]?.some((message) => message.role === 'assistant')).toBe(false);
    expect(calls[1]?.at(-1)).toEqual({
      role: 'user',
      content: t('llmIndexedReviewAnswerCorrection'),
    });
    expect(result.content).toContain('두 번 냉각한 뒤');
  });

  it('supported에서 두 답변 시도가 실패하면 coverage와 검증된 원문을 표시한다', async () => {
    const calls: ChatMessage[][] = [];
    const provider = {
      streamChat: (messages: ChatMessage[], consume: (chunk: { content: string }) => void) => {
        calls.push(messages);
        consume({
          content: JSON.stringify({
            paragraphs: [{ text: '형식 오류', sources: ['missing-source'] }],
          }),
        });
        return Promise.resolve();
      },
    } as unknown as LLMProvider;
    const result = await reviewIndexedVault(reviewOptions({ provider }));
    expect(calls).toHaveLength(2);
    expect(result.diagnostics.counts.answerCorrectionRequests).toBe(1);
    const coverage = t('indexedReviewCoverage', {
      total: 2,
      accepted: 1,
      machineExcluded: 1,
      rejected: 0,
      budgetExcluded: 0,
      notIndexed: 0,
      unreviewed: 0,
      unreadable: 0,
    });
    expect(result.coverageNotice).toBe(coverage);
    expect(result.content.startsWith(`${coverage}\n\n`)).toBe(true);
    expect(result.content).toContain('> Quartz restarts');
    expect(result.outcome).toBe('evidence-only');
    expect(result.citations[0]?.status).toBe('verified');
    expect(result.content).not.toContain('검수 미완료');
  });

  it('budget-exhausted이고 실제 미검토 문서가 없으면 근거 범위 제한 고지와 답변을 낸다', async () => {
    const plan = planFixture();
    vi.mocked(planIndexedEvidenceRust).mockReturnValue({
      ...plan,
      coverage: { ...plan.coverage, status: 'budget-exhausted' },
    });
    const { provider, calls } = answerProvider();
    const result = await reviewIndexedVault(reviewOptions({ provider }));
    const limited = t('indexedReviewLimitedNotice', {
      total: 2,
      accepted: 1,
      machineExcluded: 1,
      rejected: 0,
      budgetExcluded: 0,
      notIndexed: 0,
      unreviewed: 0,
      unreadable: 0,
    });
    expect(calls).toHaveLength(1);
    expect(result.coverageNotice).toBe(limited);
    expect(result.content.startsWith(`${limited}\n\n`)).toBe(true);
    expect(result.content).toContain('두 번 냉각한 뒤');
    expect(result.coverageNotice).not.toContain('검수 미완료');
  });

  it('budget-exhausted여도 실제 미검토 문서가 있으면 incomplete 고지를 쓴다', async () => {
    const plan = planFixture();
    vi.mocked(planIndexedEvidenceRust).mockReturnValue({
      ...plan,
      coverage: {
        ...plan.coverage,
        status: 'budget-exhausted',
        reviewedDocuments: 1,
        unreviewedDocuments: 1,
      },
    });
    const { provider } = answerProvider();
    const result = await reviewIndexedVault(reviewOptions({ provider }));
    const incomplete = t('indexedReviewIncompleteNotice', {
      total: 2,
      accepted: 1,
      machineExcluded: 1,
      rejected: 0,
      budgetExcluded: 0,
      notIndexed: 0,
      unreviewed: 1,
      unreadable: 0,
    });
    expect(result.coverageNotice).toBe(incomplete);
    expect(result.content.startsWith(`${incomplete}\n\n`)).toBe(true);
    expect(result.content).not.toContain(
      t('indexedReviewLimitedNotice', {
        total: 2,
        accepted: 1,
        machineExcluded: 1,
        rejected: 0,
        budgetExcluded: 0,
        notIndexed: 0,
        unreviewed: 1,
        unreadable: 0,
      }),
    );
  });

  it('기계 선별·예산 제외 후보를 색인 범위 밖 문서로 표현하지 않는다', async () => {
    const { provider } = answerProvider();
    const result = await reviewIndexedVault(reviewOptions({ provider }));
    expect(result.coverageNotice).toContain('점수·필터로 제외된 후보 1개');
    expect(result.coverageNotice).not.toContain('색인 범위 밖 제외 1개');
  });

  it('후보 검토의 지원 상태와 전역 미색인 문서 수치를 구분한다', async () => {
    const plan = planFixture();
    vi.mocked(planIndexedEvidenceRust).mockReturnValue({
      ...plan,
      coverage: { ...plan.coverage, status: 'incomplete', notIndexedDocuments: 1 },
    });
    const { provider } = answerProvider();
    const result = await reviewIndexedVault(reviewOptions({ provider }));
    expect(result.coverageNotice).toBe(
      t('indexedReviewCoverage', {
        total: 2,
        accepted: 1,
        machineExcluded: 1,
        rejected: 0,
        budgetExcluded: 0,
        unreviewed: 0,
        notIndexed: 1,
        unreadable: 0,
      }),
    );
    expect(result.coverageNotice).toContain('미색인 문서 1개');
  });

  it('원문 검증 제외·원문 확인 후 예산 제외·원문 재확인 실패를 섞지 않는다', async () => {
    const base = planFixture();
    const selected = base.evidence[0];
    if (!selected) throw new Error('plan fixture without evidence');
    const verificationFailedId = RELEVANT + '#L5-L6';
    const budgetExcludedId = OTHER + '#L1-L1';
    const plan: RustIndexedEvidencePlan = {
      ...base,
      order: [selected.sourceId, verificationFailedId, budgetExcludedId],
      evidence: [
        { ...selected, score: 3, rank: 1 },
        {
          ...selected,
          sourceId: verificationFailedId,
          startLine: 5,
          endLine: 6,
          quote: 'A quotation that no longer matches the indexed source.',
          score: 2,
          rank: 2,
        },
        {
          ...selected,
          sourceId: budgetExcludedId,
          path: OTHER,
          startLine: 1,
          endLine: 1,
          quote: 'Delivery schedule for the northern region.',
          score: 1,
          rank: 3,
        },
      ],
      coverage: { ...base.coverage, status: 'incomplete', unreviewedDocuments: 1 },
    };
    vi.mocked(planIndexedEvidenceRust).mockReturnValue(plan);
    vi.mocked(verifyIndexedEvidenceRust).mockImplementation((input) => ({
      statuses: verifiedStatuses(input).statuses.map((status) => {
        if (status.sourceId === verificationFailedId) {
          return {
            ...status,
            status: 'quote-missing' as const,
            exists: false,
            lineMatches: false,
          };
        }
        if (status.sourceId === budgetExcludedId) {
          return {
            ...status,
            status: 'unreviewed' as const,
            reviewState: 'unreviewed' as const,
          };
        }
        return status;
      }),
    }));
    const result = await reviewIndexedVault(reviewOptions());
    const incomplete = t('indexedReviewIncompleteNotice', {
      total: 2,
      accepted: 1,
      machineExcluded: 1,
      rejected: 1,
      budgetExcluded: 1,
      notIndexed: 0,
      unreviewed: 1,
      unreadable: 0,
    });
    expect(result.coverageNotice).toBe(incomplete);
    expect(result.rejectedFiles).toBe(1);
  });

  it('deferAnswer면 답변을 만들지 않고 검증 근거만 돌려준다', async () => {
    const { provider, calls } = answerProvider();
    const result = await reviewIndexedVault(reviewOptions({ provider, deferAnswer: true }));
    expect(calls).toHaveLength(0);
    expect(result.dossier.evidence[0]?.quote).toContain('cooling cycles');
    expect(result.outcome).toBe('evidence-only');
    expect(result.providerTransfer.sentFiles).toBe(0);
  });

  it('해시와 mtime:size는 비교 영역이 달라 해시 근거는 verified로 승격하지 않는다', async () => {
    const plan = planFixture();
    vi.mocked(planIndexedEvidenceRust).mockReturnValue({
      ...plan,
      evidence: plan.evidence.map((item) => ({ ...item, revision: 'hash-relevant' })),
    });
    const { provider, calls } = answerProvider();
    const result = await reviewIndexedVault(reviewOptions({ provider }));
    expect(calls).toHaveLength(0);
    expect(result.citations).toHaveLength(0);
    expect(result.outcome).toBe('no-evidence');
  });

  it('색인에 청크 해시가 없으면 엔진 입력에서 제외한다', async () => {
    const actual = await vi.importActual<typeof import('../rag/rust-core')>('../rag/rust-core');
    vi.mocked(planIndexedEvidenceRust).mockImplementation(actual.planIndexedEvidenceRust);
    vi.mocked(verifyIndexedEvidenceRust).mockImplementation(actual.verifyIndexedEvidenceRust);
    const corpus = corpusFixture();
    const stale: IndexedVaultCorpus = {
      getFileIndexRecords: () => corpus.getFileIndexRecords(),
      getEntriesByFilePaths: async (paths) =>
        (await corpus.getEntriesByFilePaths(paths)).map((entry) => ({
          ...entry,
          metadata: { ...entry.metadata, contentHash: undefined },
        })),
    };
    const search = await searchIndexedVault({
      question: 'Quartz cooling cycles',
      indexedPaths: [RELEVANT],
      scopes: [],
      corpus: stale,
    });
    expect(search?.evidence).toEqual([]);
    expect(search?.coverage.status).toBe('incomplete');
  });

  it('코퍼스 청크 sourceMtime(ms epoch)을 엔진 modifiedAt으로 배선한다', async () => {
    const sourceMtime = 1_700_000_000_000;
    const corpus = corpusFixture();
    const stamped: IndexedVaultCorpus = {
      getFileIndexRecords: async () =>
        (await corpus.getFileIndexRecords()).map((record) => ({ ...record, sourceMtime })),
      getEntriesByFilePaths: async (paths) =>
        (await corpus.getEntriesByFilePaths(paths)).map((entry) => ({
          ...entry,
          metadata: { ...entry.metadata, sourceMtime },
        })),
    };
    await searchIndexedVault({
      question: 'Quartz cooling cycles',
      indexedPaths: [RELEVANT],
      scopes: [],
      corpus: stamped,
    });
    const documents = vi.mocked(planIndexedEvidenceRust).mock.calls.at(-1)?.[0]?.documents ?? [];
    expect(documents).toHaveLength(1);
    expect(documents[0]?.modifiedAt).toBe(sourceMtime);
  });

  it('코퍼스가 sourceMtime을 주지 않으면 modifiedAt 키를 만들지 않는다', async () => {
    await searchIndexedVault({
      question: 'Quartz cooling cycles',
      indexedPaths: [RELEVANT],
      scopes: [],
      corpus: corpusFixture(),
    });
    const documents = vi.mocked(planIndexedEvidenceRust).mock.calls.at(-1)?.[0]?.documents ?? [];
    expect(documents).toHaveLength(1);
    expect(documents[0]).not.toHaveProperty('modifiedAt');
  });
});
