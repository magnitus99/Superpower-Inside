import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../i18n';
import type { ChatMessage, LLMProvider } from '../llm/providers';
import {
  planIndexedEvidenceRust,
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
    revisionReader: () => Promise.resolve('1:10'),
    provider: answerProvider().provider,
    ...overrides,
  };
}

describe('엔진 근거 기반 색인 검토', () => {
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
    expect(result.toolFallback).toBe(false);
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0]?.filePath).toBe(RELEVANT);
    expect(result.citations[0]?.line).toBe(3);
    expect(result.content).toContain('두 번 냉각한 뒤');
  });

  it('엔진이 선별하지 못하면 도구 fallback으로 표시하고 LLM을 부르지 않는다', async () => {
    vi.mocked(planIndexedEvidenceRust).mockReturnValue(null);
    const { provider, calls } = answerProvider();
    const result = await reviewIndexedVault(reviewOptions({ provider }));
    expect(calls).toHaveLength(0);
    expect(result.toolFallback).toBe(true);
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
    expect(result.toolFallback).toBe(true);
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
    expect(result.toolFallback).toBe(false);
    // 제거된 문서는 채택 문서·coverage에서 빠지고 원문 재확인 실패 문서로만 남습니다.
    expect(result.coverageNotice).toBe(
      t('indexedReviewIncompleteNotice', {
        total: 2,
        accepted: 1,
        machineExcluded: 0,
        rejected: 0,
        budgetExcluded: 0,
        notIndexed: 0,
        unreviewed: 0,
        unreadable: 1,
      }),
    );
    expect(result.rejectedFiles).toBe(0);
  });

  it('stale 제거로 결과가 비면 완료로 승격하지 않고 미완료 고지·도구 fallback을 유지한다', async () => {
    vi.mocked(planIndexedEvidenceRust).mockReturnValue(twoDocumentPlan());
    vi.mocked(verifyIndexedEvidenceRust).mockImplementation(verifiedStatuses);
    const { provider, calls } = answerProvider();
    const result = await reviewIndexedVault(
      reviewOptions({ provider, revisionReader: () => Promise.resolve('2:99') }),
    );
    expect(calls).toHaveLength(0);
    expect(result.citations).toHaveLength(0);
    expect(result.toolFallback).toBe(true);
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
        unreviewed: 0,
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

  it('supported에서 두 답변 시도가 실패하면 coverage와 답변 불가만 표시한다', async () => {
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
    expect(result.content).toBe(`${coverage}\n\n${t('indexedReviewAnswerUnavailable')}`);
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

  it('미색인 문서가 있으면 supported가 아니라 미완료 고지에 수치를 남긴다', async () => {
    const plan = planFixture();
    vi.mocked(planIndexedEvidenceRust).mockReturnValue({
      ...plan,
      coverage: { ...plan.coverage, status: 'incomplete', notIndexedDocuments: 1 },
    });
    const { provider } = answerProvider();
    const result = await reviewIndexedVault(reviewOptions({ provider }));
    expect(result.coverageNotice).toBe(
      t('indexedReviewIncompleteNotice', {
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
    const payload = JSON.parse(result.content) as { evidence: { quote: string }[] };
    expect(payload.evidence[0]?.quote).toContain('cooling cycles');
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
    expect(result.toolFallback).toBe(true);
  });

  it('색인에 청크 해시가 없으면 엔진 입력에서 제외한다', async () => {
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
    expect(search).toBeNull();
  });

  it('코퍼스 청크 sourceMtime(ms epoch)을 엔진 modifiedAt으로 배선한다', async () => {
    const sourceMtime = 1_700_000_000_000;
    const corpus = corpusFixture();
    const stamped: IndexedVaultCorpus = {
      getFileIndexRecords: () => corpus.getFileIndexRecords(),
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
