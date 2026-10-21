import { describe, expect, it, vi } from 'vitest';
import {
  reviewIndexedVault,
  searchIndexedVault,
  type IndexedEvidenceDossier,
  type IndexedVaultCorpus,
} from '../agent/indexed-vault-review';
import type { LLMProvider } from '../llm/providers';
import { LLMProviderHttpError } from '../llm/providers';
import { t } from '../i18n';

const RELEVANT = 'Synthetic/Valve.md';
const OTHER = 'Synthetic/Calendar.md';
const TEXT = 'The copper valve closes after three pressure pulses.';

function fixture() {
  const paths = [RELEVANT, OTHER];
  const records = paths.map((filePath) => ({
    filePath,
    contentHash: filePath,
    sourceMtime: 1,
    sourceSize: 100,
    vectorCount: 1,
    updated: 1,
  }));
  const entries = paths.map((filePath, index) => ({
    id: filePath,
    vector: [],
    metadata: {
      filePath,
      startLine: 0,
      endLine: 0,
      contentHash: filePath,
      text: index === 0 ? TEXT : 'The annual calendar starts in February.',
    },
  }));
  const read = vi.fn((requested: readonly string[]) =>
    Promise.resolve(entries.filter((entry) => requested.includes(entry.metadata.filePath))),
  );
  const corpus: IndexedVaultCorpus = {
    getEntriesByFilePaths: read,
    getFileIndexRecords: () => Promise.resolve(records),
  };
  return {
    question: 'When does the copper valve close?',
    indexedPaths: paths,
    scopes: [],
    corpus,
    read,
    candidates: [{ path: RELEVANT, score: 1, source: 'bm25' as const, rank: 1 }],
    revisionReader: vi.fn((_path: string) => Promise.resolve('1:100')),
  };
}

describe('실제 WASM 검색 엔진의 합성 제품 여정', () => {
  it('전체 색인 검색·검증 → dossier → 해석 1회 → 검증 출처를 연결한다', async () => {
    const input = fixture();
    const search = await searchIndexedVault({ ...input });
    if (!search) throw new Error('합성 검색에서 실제 WASM 엔진을 사용할 수 없습니다.');
    expect(search.evidence.length).toBeGreaterThan(0);
    expect(search.coverage.documentScope).toBe('all');
    expect(search.coverage.requestedPaths).toEqual([RELEVANT, OTHER]);
    const stream = vi.fn<LLMProvider['streamChat']>(
      (messages, onChunk, _temperature, tools, options) => {
        expect(tools).toBeUndefined();
        expect(options?.toolChoice).toBe('none');
        const dossier = JSON.parse(
          messages.find((message) => message.role === 'user')?.content ?? '',
        ) as IndexedEvidenceDossier;
        expect(dossier.documentScope).toBe('all');
        expect(dossier.evidence).toEqual(search.evidence);
        onChunk({
          content: JSON.stringify({
            paragraphs: [
              {
                text: 'The valve closes after three pulses.',
                sources: [dossier.evidence[0]?.sourceId],
              },
            ],
          }),
          done: true,
        });
        return Promise.resolve();
      },
    );
    const result = await reviewIndexedVault({ ...input, provider: { streamChat: stream } });
    expect(result.outcome).toBe('answered');
    expect(stream).toHaveBeenCalledOnce();
    expect(result.citations).toEqual([
      expect.objectContaining({ filePath: RELEVANT, status: 'verified' }),
    ]);
    expect(result.content).toContain('three pulses');
    expect(result.content).toContain(result.citations[0]?.id);
    expect([
      ...new Set(input.read.mock.calls.flatMap(([paths]) => [...paths])),
    ]).toEqual([RELEVANT, OTHER]);
    expect(input.revisionReader.mock.calls).toEqual([[RELEVANT]]);
  });

  it('후보 신호가 비어도 전체 색인 본문을 읽어 답한다', async () => {
    const input = fixture();
    const stream = vi.fn<LLMProvider['streamChat']>((messages, onChunk) => {
      const dossier = JSON.parse(
        messages.find((message) => message.role === 'user')?.content ?? '',
      ) as IndexedEvidenceDossier;
      onChunk({
        content: JSON.stringify({
          paragraphs: [
            {
              text: 'The valve closes after three pulses.',
              sources: [dossier.evidence[0]?.sourceId],
            },
          ],
        }),
        done: true,
      });
      return Promise.resolve();
    });
    const result = await reviewIndexedVault({
      ...input,
      candidates: [],
      provider: { streamChat: stream },
    });
    expect(result.outcome).toBe('answered');
    expect(input.read.mock.calls.flatMap(([paths]) => [...paths])).toEqual([RELEVANT, OTHER]);
    expect(result.citations).toEqual([
      expect.objectContaining({ filePath: RELEVANT, status: 'verified' }),
    ]);
    expect(stream).toHaveBeenCalledOnce();
  });

  it('provider HTTP 실패는 원문 표시와 verified citations를 보존한다', async () => {
    const input = fixture();
    const stream = vi
      .fn<LLMProvider['streamChat']>()
      .mockRejectedValue(new LLMProviderHttpError('synthetic unavailable', 503));
    const result = await reviewIndexedVault({ ...input, provider: { streamChat: stream } });
    expect(result.outcome).toBe('evidence-only');
    expect(stream).toHaveBeenCalledOnce();
    expect(result.content).toContain(t('indexedReviewEvidenceOnly'));
    expect(result.content).toContain(TEXT.replace('.', '&#46;'));
    expect(result.dossier.evidence).toEqual(result.evidence);
    expect(result.citations).toEqual([
      expect.objectContaining({ filePath: RELEVANT, status: 'verified', preview: TEXT }),
    ]);
  });

  it('명시적 mixed 요청은 해석 호출 없이 구조화 dossier와 출처를 반환한다', async () => {
    const input = fixture();
    const stream = vi.fn<LLMProvider['streamChat']>();
    const result = await reviewIndexedVault({
      ...input,
      deferAnswer: true,
      provider: { streamChat: stream },
    });
    expect(result.outcome).toBe('evidence-only');
    expect(result.dossier.evidence.length).toBeGreaterThan(0);
    expect(result.citations.every((citation) => citation.status === 'verified')).toBe(true);
    expect(stream).not.toHaveBeenCalled();
    expect(() => {
      JSON.parse(result.content);
    }).toThrow();
  });
});
