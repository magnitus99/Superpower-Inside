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

function reviewOptions(overrides: Partial<IndexedVaultReviewOptions> = {}): IndexedVaultReviewOptions {
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
    // 제거된 문서는 채택 문서·coverage에서 빠지고 미확정·읽기 실패로만 남습니다.
    expect(result.coverageNotice).toBe(
      t('indexedReviewIncompleteNotice', {
        total: 2,
        screened: 2,
        floor: 1,
        machineExcluded: 0,
        accepted: 1,
        rejected: 1,
        undecided: 1,
        unreadable: 1,
      }),
    );
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
        screened: 2,
        floor: 0,
        machineExcluded: 0,
        accepted: 0,
        rejected: 2,
        undecided: 2,
        unreadable: 2,
      }),
    );
  });

  it('인용 형식 오류는 정상 해석 1회와 교정 1회까지만 재생성한다', async () => {
    const calls: ChatMessage[][] = [];
    let attempt = 0;
    const provider = {
      streamChat: (messages: ChatMessage[], consume: (chunk: { content: string }) => void) => {
        calls.push(messages);
        attempt += 1;
        consume({
          content:
            attempt === 1
              ? JSON.stringify({ paragraphs: [{ text: '형식 오류', sources: ['missing-source'] }] })
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
    expect(calls.every((messages) => !(messages[0]?.content ?? '').includes('스크리닝'))).toBe(
      true,
    );
  });

  it('교정 1회도 실패하면 세 번째 해석 호출 없이 불가 고지를 남긴다', async () => {
    const calls: ChatMessage[][] = [];
    const provider = {
      streamChat: (messages: ChatMessage[], consume: (chunk: { content: string }) => void) => {
        calls.push(messages);
        consume({
          content: JSON.stringify({ paragraphs: [{ text: '형식 오류', sources: ['missing-source'] }] }),
        });
        return Promise.resolve();
      },
    } as unknown as LLMProvider;
    const result = await reviewIndexedVault(reviewOptions({ provider }));
    expect(calls).toHaveLength(2);
    expect(result.diagnostics.counts.answerCorrectionRequests).toBe(1);
    expect(result.content).toContain(t('indexedReviewAnswerUnavailable'));
  });

  it('deferAnswer면 답변을 만들지 않고 검증 근거만 돌려준다', async () => {
    const { provider, calls } = answerProvider();
    const result = await reviewIndexedVault(
      reviewOptions({ provider, deferAnswer: true }),
    );
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
