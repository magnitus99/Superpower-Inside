import { describe, expect, it } from 'vitest';
import { createSyntheticCorpus } from './search-eval/corpus.mjs';
import { buildEnginePlanInput, createSearchAdapter, isEnginePlannerAvailable } from './search-eval/adapters.mjs';
import { summarizeSearchEvaluation } from './search-eval/metrics.mjs';

// 일반 CI용 소형 결정적 평가: 합성 240문서(질의 28개)로 골드 계약과 어댑터 갱신을 확인한다.
const corpus = createSyntheticCorpus({ scale: 'ci', split: 'dev', queriesPerCategory: 2 });

describe('엔진 어댑터 입력 매핑', () => {
  it('경로별 본문 하나와 후보별 신호·절대 행·미검토 inventory를 전달한다', () => {
    const document = corpus.documents[0];
    const hits = document.chunks.slice(0, 2).map((chunk, index) => ({
      path: document.path, startLine: chunk.startLine, score: 3 - index,
    }));
    const input = buildEnginePlanInput('독립 합성 질의', hits, new Map([[document.path, document], ['other.md', {}]]), 64);
    expect(input.documents).toHaveLength(1);
    expect(input.documents[0].startLine).toBe(1);
    expect(input.documents[0].text.trimEnd()).toBe(document.text.trimEnd());
    expect(input.candidates).toEqual(hits.map((hit, index) => ({ ...hit, source: 'bm25', rank: index + 1 })));
    expect(input.inventory).toEqual({ indexedCount: 2, unreviewedCount: 1, notIndexedCount: 0 });
  });

  it('갱신된 청크로 본문과 revision을 다시 만들어 오래된 text를 넘기지 않는다', () => {
    const document = corpus.documents[0];
    const hit = [{ path: document.path, startLine: 1, score: 1 }];
    const original = buildEnginePlanInput('합성', hit, new Map([[document.path, document]]), 64);
    const changed = { ...document, chunks: document.chunks.map((chunk, index) => index === 1 ? { ...chunk, text: '새 합성 본문' } : chunk) };
    const updated = buildEnginePlanInput('합성', hit, new Map([[document.path, changed]]), 64);
    expect(updated.documents[0].text).toContain('새 합성 본문');
    expect(updated.documents[0].revision).not.toBe(original.documents[0].revision);
  });
});

async function evaluateBaseline(target = corpus) {
  const adapter = await createSearchAdapter('baseline');
  await adapter.build(target.documents);
  const results = new Map();
  for (const query of target.queries) results.set(query.id, await adapter.query(query.text, 8));
  const summary = summarizeSearchEvaluation(target.queries, results, { k: 8 });
  const stats = adapter.stats();
  return { adapter, results, summary, stats };
}

describe('BM25 WASM 기준선 어댑터(Node 단위 평가, 제품 DB/IO 아님)', () => {
  it('문서·구절·상충쌍·no-answer 골드를 결정적으로 채점한다', async () => {
    const first = await evaluateBaseline();
    const second = await evaluateBaseline();
    try {
      expect(first.stats.chunkCount).toBe(corpus.stats.chunkCount);
      expect(first.stats.bodyBytes).toBe(corpus.stats.bodyBytes);
      // 하한은 측정값보다 낮게 고정해 회귀를 잡는다(정확한 순위 스냅샷을 만들지 않는다).
      expect(first.summary.overall.documentRecall).toBeGreaterThanOrEqual(0.85);
      expect(first.summary.overall.mrr).toBeGreaterThanOrEqual(0.8);
      expect(first.summary.overall.ndcg10).toBeGreaterThanOrEqual(0.7);
      expect(first.summary.overall.passageHitRatio).toBeGreaterThanOrEqual(0.5);
      expect(first.summary.overall.conflictPairCoverage).toBe(1);
      expect(first.summary.overall.noAnswerAccuracy).toBe(1);
      // 같은 입력·같은 인덱스는 두 번 실행해도 같은 지표를 낸다.
      const digest = (summary) => JSON.stringify(summary.overall);
      expect(digest(first.summary)).toBe(digest(second.summary));
    } finally {
      first.adapter.free();
      second.adapter.free();
    }
  }, 30_000);

  it('수정·추가·삭제가 실제 검색 결과에 반영된다', async () => {
    const { adapter } = await evaluateBaseline();
    try {
      const target = corpus.queries.find((query) => query.category === 'numbers');
      const removal = corpus.queries.find((query) => query.category === 'dates');
      const path = target.goldPaths[0];
      const removedPath = removal.goldPaths[0];
      const document = corpus.documents.find((item) => item.path === path);
      const marker = 'marker-test-refresh';
      const addition = 'marker-test-addition';
      const changed = {
        ...document,
        chunks: document.chunks.map((chunk, index) =>
          index === document.goldChunkIndexes[0] ? { ...chunk, text: `${marker} 갱신 본문` } : chunk,
        ),
      };
      const added = {
        path: 'update-test/added.md',
        title: 'update test added',
        text: `${addition}\n`,
        chunks: [{ index: 0, startLine: 1, endLine: 1, text: `${addition} 추가 본문` }],
        goldChunkIndexes: [0],
        bytes: 24,
      };
      const counts = await adapter.update({ changedDocuments: [changed, added], removedPaths: [removedPath] });
      expect(counts).toEqual({ changedSources: 2, removedSources: 1 });
      expect((await adapter.query(marker, 5)).some((hit) => hit.path === path)).toBe(true);
      expect((await adapter.query(addition, 5)).some((hit) => hit.path === added.path)).toBe(true);
      expect((await adapter.query(removal.text, 5)).every((hit) => hit.path !== removedPath)).toBe(true);
    } finally {
      adapter.free();
    }
  }, 30_000);
});

const enginePlannerAvailable = await isEnginePlannerAvailable();

describe.skipIf(!enginePlannerAvailable)('engine plan/verify 계약(generated WASM에 export가 있을 때만)', () => {
  it('plan은 절대 line range evidence를 돌려주고 no-answer는 빈 근거를 낸다', async () => {
    const adapter = await createSearchAdapter('engine');
    try {
      await adapter.build(corpus.documents);
      const target = corpus.queries.find((query) => query.category === 'conflict-pair');
      const evidence = await adapter.query(target.text, 5);
      expect(Array.isArray(evidence)).toBe(true);
      for (const item of evidence) {
        expect(typeof item.path).toBe('string');
        expect(Number.isInteger(item.startLine)).toBe(true);
        expect(Number.isInteger(item.endLine)).toBe(true);
        expect(item.startLine).toBeLessThanOrEqual(item.endLine);
      }
      const noAnswer = corpus.queries.find((query) => query.expectNoAnswer);
      expect(await adapter.query(noAnswer.text, 5)).toEqual([]);
    } finally {
      adapter.free();
    }
  }, 30_000);

  it('verify는 조작된 인용을 verified로 인정하지 않는다', async () => {
    const adapter = await createSearchAdapter('engine');
    try {
      await adapter.build(corpus.documents);
      const document = corpus.documents[0];
      const chunk = document.chunks[0];
      const statuses = adapter.verifyEvidence({
        evidence: [
          {
            sourceId: 'eval-0',
            path: document.path,
            revision: `r-${chunk.startLine}-${chunk.endLine}`,
            startLine: chunk.startLine,
            endLine: chunk.endLine,
            quote: `${chunk.text} 조작된 꼬리`,
          },
        ],
        documents: [
          {
            path: document.path,
            revision: `r-${chunk.startLine}-${chunk.endLine}`,
            indexed: true,
            reviewState: 'reviewed',
            text: chunk.text,
            startLine: chunk.startLine,
          },
        ],
        scopes: [],
      });
      expect(Array.isArray(statuses)).toBe(true);
      expect(statuses.length).toBeGreaterThan(0);
      for (const status of statuses) expect(status.status).not.toBe('verified');
    } finally {
      adapter.free();
    }
  }, 30_000);
});

// 필드 계약 전용 최소 합성 문서. 평가 코퍼스의 문자열·경로·정답을 복제하지 않는다.
function syntheticFieldDocument(overrides = {}) {
  const paragraphs = [
    '# omega heading\n본문 첫 문장입니다.',
    '```\n# 펜스 안 주석 줄\n```',
    '## 두 번째 절\n마지막 문장입니다.',
  ];
  const lines = [];
  const chunks = [];
  for (const paragraph of paragraphs) {
    const startLine = lines.length + 1;
    for (const line of paragraph.split('\n')) lines.push(line);
    chunks.push({ index: chunks.length, startLine, endLine: lines.length, text: paragraph });
    lines.push('');
  }
  const text = lines.join('\n');
  return {
    path: 'synthetic/omega.md',
    text,
    chunks,
    bytes: Buffer.byteLength(text, 'utf8'),
    ...overrides,
  };
}

function planInputOf(document, question = '합성 필드 질의') {
  return buildEnginePlanInput(
    question,
    [{ path: document.path, startLine: 1, score: 1 }],
    new Map([[document.path, document]]),
    64,
  );
}

describe('plan 입력 문서 필드 계약', () => {
  it('title·headings·tags를 기존 입력 키와 함께 전달한다', () => {
    const document = syntheticFieldDocument({ title: 'alpha omega note', tags: ['tagomeganote'] });
    const [input] = planInputOf(document).documents;
    expect(input.title).toBe('alpha omega note');
    // 펜스 코드 블록 안의 '#' 줄은 헤딩이 아니다.
    expect(input.headings).toEqual(['omega heading', '두 번째 절']);
    expect(input.tags).toEqual(['tagomeganote']);
    // 기존 키는 그대로 유지하고 필드 키만 추가한다.
    expect(Object.keys(input).sort()).toEqual(
      ['headings', 'indexed', 'path', 'revision', 'reviewState', 'startLine', 'tags', 'text', 'title'].sort(),
    );
    expect(input.path).toBe(document.path);
    expect(input.indexed).toBe(true);
    expect(input.reviewState).toBe('reviewed');
    expect(input.startLine).toBe(1);
    expect(input.text.trimEnd()).toBe(document.text.trimEnd());
    expect(input.revision).toMatch(/^[0-9a-f]{64}$/);
  });

  it('title·headings가 없으면 파일명과 ATX 헤딩 줄에서 유도하고 tags 키는 생략한다', () => {
    const [input] = planInputOf(syntheticFieldDocument()).documents;
    expect(input.title).toBe('omega');
    expect(input.headings).toEqual(['omega heading', '두 번째 절']);
    expect('tags' in input).toBe(false);
  });

  it('문서 headings가 있으면 유도하지 않고 그대로 쓴다', () => {
    const [input] = planInputOf(syntheticFieldDocument({ headings: ['명시한 절'] })).documents;
    expect(input.headings).toEqual(['명시한 절']);
  });
});

describe('BM25 기준선 문서 필드 계약', () => {
  it('title·path·tag·heading 필드가 후보 인덱스에 실제로 실린다', async () => {
    const document = syntheticFieldDocument({ title: 'alpha omega note', tags: ['tagomeganote'] });
    const adapter = await createSearchAdapter('baseline');
    try {
      await adapter.build([document]);
      const paths = async (query) => new Set((await adapter.query(query, 5)).map((hit) => hit.path));
      // 본문에 없는 토큰이라 필드가 색인되지 않으면 매칭되지 않는다.
      expect(await paths('title:alpha')).toEqual(new Set([document.path]));
      expect(await paths('path:synthetic')).toEqual(new Set([document.path]));
      expect(await paths('tag:tagomeganote')).toEqual(new Set([document.path]));
      expect(await paths('heading:omega')).toEqual(new Set([document.path]));
      expect([...(await paths('title:zeta'))]).toEqual([]);
      expect([...(await paths('tag:zeta'))]).toEqual([]);
      expect([...(await paths('heading:펜스'))]).toEqual([]);
    } finally {
      adapter.free();
    }
  }, 30_000);
});
