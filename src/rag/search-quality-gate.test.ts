import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { EMBEDDINGGEMMA_ASSETS } from '../../generated/embeddinggemma-assets';
import { searchIndexedVault, type IndexedVaultCorpus } from '../agent/indexed-vault-review';
import { createIndexedSearchPort } from '../search/engine-adapter';
import type { EmbeddingProvider } from '../llm/embedding';
import { IndexedDbBM25Index } from './bm25';
import { RAGQueryEngine } from './query';
import { MemoryVectorStore, type VectorEntry } from './store';

type QueryLanguage = 'ko' | 'en' | 'la';
const GOLD_LANGUAGES = ['ko', 'en', 'la'] as const;
type GoldLanguage = (typeof GOLD_LANGUAGES)[number];

interface VectorText {
  text: string;
  vector: string;
}

interface ConceptFixture {
  id: string;
  terms: Record<GoldLanguage, string>;
  gold: Record<GoldLanguage, VectorText>;
  distractors: Record<GoldLanguage, VectorText>;
  queries: Record<QueryLanguage, VectorText>;
}

interface QualityFixture {
  schemaVersion: number;
  model: {
    id: string;
    sourceRepository: string;
    sourceRevision: string;
    modelOnnxDataSha256: string;
    dimensions: number;
    generation: string;
  };
  neutral: VectorText;
  concepts: readonly ConceptFixture[];
}

interface QualityCase {
  id: string;
  conceptId: string;
  queryLanguage: QueryLanguage;
  query: string;
  queryVector: string;
  terms: readonly string[];
  gold: Record<GoldLanguage, VectorText>;
  distractors: Readonly<Record<GoldLanguage, VectorText>>;
}

interface SyntheticDocument {
  id: string;
  language: GoldLanguage | 'neutral';
  text: string;
  vector: readonly number[];
}

interface CaseDocuments {
  gold: Record<GoldLanguage, SyntheticDocument>;
  distractors: readonly SyntheticDocument[];
  neutral: SyntheticDocument;
}

interface GateCase {
  id: string;
  goldIds: readonly string[];
  engine: readonly string[];
  baseline: readonly string[];
  k: number;
}

interface GateRow extends GateCase {
  engineCoverage: number;
  baselineCoverage: number;
  engineMrr: number;
  baselineMrr: number;
  passed: boolean;
}

interface GateReport {
  passed: boolean;
  rows: readonly GateRow[];
  failures: readonly string[];
  engineMeanMrr: number;
  baselineMeanMrr: number;
}

const fixture = loadFixture();
const qualityCases = buildQualityCases(fixture);
const bm25DbNames = new Set<string>();
const TOP_K = 3;
const MINIMUM_SEMANTIC_MARGIN = 0.005;

afterEach(async () => {
  await Promise.all([...bm25DbNames].map((name) => Dexie.delete(name)));
  bm25DbNames.clear();
});

describe('한·영·라틴 병렬 검색 품질 필수 게이트', () => {
  it('golden fixture는 배포 EmbeddingGemma 모델 해시와 결합되어 있다', () => {
    const modelData = EMBEDDINGGEMMA_ASSETS.find(
      (asset) => asset.file === 'onnx/model.onnx_data',
    );
    expect(fixture.model).toEqual(
      expect.objectContaining({
        id: 'embeddinggemma-300m',
        sourceRevision: '5090578d9565bb06545b4552f76e6bc2c93e4a66',
        dimensions: 768,
        modelOnnxDataSha256: modelData?.sha256,
      }),
    );
  });

  it.each(fixture.concepts)(
    '$id fixture는 정답 한국어·영어·라틴어 문서와 한국어·영어·라틴어 질의를 함께 가진다',
    (concept) => {
      expect(Object.keys(concept.gold)).toEqual([...GOLD_LANGUAGES]);
      expect(Object.keys(concept.queries)).toEqual(['ko', 'en', 'la']);
      expect(concept.gold.ko.text).toContain(concept.terms.ko);
      expect(concept.gold.en.text.toLocaleLowerCase()).toContain(
        concept.terms.en.toLocaleLowerCase(),
      );
      expect(concept.gold.la.text.toLocaleLowerCase()).toContain(
        concept.terms.la.toLocaleLowerCase(),
      );
    },
  );

  it('사용자 핵심 fixture는 한국어 지혜 질의와 한·영·라틴 지혜 정답을 포함한다', () => {
    const wisdom = fixture.concepts.find((concept) => concept.id === 'wisdom');
    expect(wisdom?.queries.ko.text).toBe('지혜');
    expect(wisdom?.terms).toEqual({
      ko: '지혜',
      en: 'wisdom',
      la: 'sapientia',
    });
    expect(wisdom?.gold.ko.text).toContain('지혜');
    expect(wisdom?.gold.en.text).toContain('Wisdom');
    expect(wisdom?.gold.la.text).toContain('Sapientia');
  });

  it.each(qualityCases)(
    '[필수] $id는 한국어·영어·라틴어 정답 3개를 모두 top-3에 반환해야 한다',
    async (row) => {
      const documents = createDocuments(row);
      const runtime = await createRuntime(row, documents);
      try {
        const queryVector = decodeVector(row.queryVector);
        const nonGoldDocuments = [...documents.distractors, documents.neutral];
        const bestNonGoldSimilarity = Math.max(
          ...nonGoldDocuments.map((document) =>
            cosineSimilarity(queryVector, document.vector),
          ),
        );
        for (const language of GOLD_LANGUAGES) {
          expect(
            cosineSimilarity(queryVector, documents.gold[language].vector) -
              bestNonGoldSimilarity,
            `${row.id}: ${language} 정답의 의미 유사도가 literal 비정답보다 앞서야 합니다.`,
          ).toBeGreaterThanOrEqual(MINIMUM_SEMANTIC_MARGIN);
        }

        const engineResults = await runtime.engine.query(row.query, TOP_K);
        const engineIds = engineResults.map((result) => result.sourcePath);
        const baselineResults = naiveKeywordRanking(
          documentList(documents),
          row.terms,
          TOP_K,
        );
        const goldIds = goldDocumentIds(documents);
        const report = evaluateMandatoryRetrievalGate([
          {
            id: row.id,
            goldIds,
            engine: engineIds,
            baseline: baselineResults,
            k: TOP_K,
          },
        ]);

        expect(report.passed, formatGateFailure(report)).toBe(true);
        expect(new Set(engineIds.slice(0, TOP_K))).toEqual(new Set(goldIds));

        const finalEvidence = await selectFinalEvidence(row, documents, engineIds);
        const evidencePaths = new Set(finalEvidence.evidence.map((item) => item.path));
        expect(
          goldIds.every((goldId) => evidencePaths.has(goldId)),
          `${row.id}: 최종 원문 근거 선택에서 한·영·라틴 정답이 모두 남아야 합니다. evidence=${[...evidencePaths].join(', ')}`,
        ).toBe(true);
      } finally {
        runtime.close();
      }
    },
  );

  it('제품 SearchPort 경로도 한국어 지혜 질의의 한·영·라틴 정답을 함께 반환한다', async () => {
    const row = qualityCases.find((candidate) => candidate.id === 'wisdom-ko');
    if (!row) throw new Error('한국어 지혜 fixture가 없습니다.');
    const documents = createDocuments(row);
    const runtime = await createRuntime(row, documents);
    let rankedPaths: readonly string[];
    try {
      const ranked = await runtime.engine.query(row.query, TOP_K);
      rankedPaths = ranked.map((result) => result.sourcePath);
    } finally {
      runtime.close();
    }
    const entries = documentList(documents).map((document) =>
      createVectorEntry(document.id, document.vector, document.text),
    );
    const paths = entries.map((entry) => entry.metadata.filePath);
    const textByPath = new Map(entries.map((entry) => [entry.metadata.filePath, entry.metadata.text]));
    const corpus: IndexedVaultCorpus = {
      getEntriesByFilePaths: (requested) =>
        Promise.resolve(entries.filter((entry) => requested.includes(entry.metadata.filePath))),
      getFileIndexRecords: () =>
        Promise.resolve(
          entries.map((entry) => ({
            filePath: entry.metadata.filePath,
            contentHash: entry.metadata.contentHash,
            sourceMtime: entry.metadata.sourceMtime,
            sourceSize: entry.metadata.sourceSize,
            vectorCount: 1,
            updated: 1,
          })),
        ),
    };
    const port = createIndexedSearchPort({
      corpus,
      getIndexedPaths: () => Promise.resolve(paths),
      reviewPaths: paths,
      exhaustiveReview: true,
      candidates: rankedPaths.map((path, index) => ({
        path,
        score: 1 / (index + 1),
        source: 'vector',
        rank: index + 1,
      })),
      scopes: [],
      revisionReader: (path) => {
        const text = textByPath.get(path);
        return Promise.resolve(text === undefined ? null : `1:${text.length}`);
      },
      verifyCurrentSource: false,
    });

    const response = await port({ query: row.query });
    const evidencePaths = new Set(response?.evidence.map((item) => item.path) ?? []);
    expect(
      goldDocumentIds(documents).every((goldId) => evidencePaths.has(goldId)),
      `SearchPort evidence=${[...evidencePaths].join(', ')}`,
    ).toBe(true);
  });

  it('벡터 후보가 사라진 lexical-only 경로는 한·영·라틴 정답을 모두 통과시키지 않는다', async () => {
    const row = qualityCases.find((candidate) => candidate.id === 'wisdom-ko');
    if (!row) throw new Error('한국어 지혜 fixture가 없습니다.');
    const documents = createDocuments(row);
    const bm25 = new IndexedDbBM25Index(createBm25DbName());
    await bm25.load();
    for (const document of documentList(documents))
      bm25.addDocument(document.id, document.text);
    try {
      const lexicalOnly = new RAGQueryEngine(null, null, bm25);
      const engineResults = await lexicalOnly.query(row.query, TOP_K);
      const baselineResults = naiveKeywordRanking(
        documentList(documents),
        row.terms,
        TOP_K,
      );
      const report = evaluateMandatoryRetrievalGate([
        {
          id: row.id,
          goldIds: goldDocumentIds(documents),
          engine: engineResults.map((result) => result.sourcePath),
          baseline: baselineResults,
          k: TOP_K,
        },
      ]);

      expect(report.passed).toBe(false);
      expect(report.failures.join('\n')).toContain(row.id);
    } finally {
      bm25.close();
    }
  });

  it('한국어 지혜 질의가 라틴 정답만 누락하면 3개 정답 동시 회수 테스트는 실패한다', () => {
    const goldIds = ['gold-ko.md', 'gold-en.md', 'gold-la.md'];
    const report = evaluateMandatoryRetrievalGate([
      {
        id: 'wisdom-ko',
        goldIds,
        engine: ['gold-ko.md', 'gold-en.md', 'literal-la.md'],
        baseline: ['literal-en.md', 'literal-la.md', 'gold-ko.md'],
        k: TOP_K,
      },
    ]);

    expect(report.passed).toBe(false);
    expect(report.failures.join('\n')).toContain('missing 1/3');
  });

  it('다른 case의 높은 평균이 한 언어 정답 누락을 숨길 수 없다', () => {
    const report = evaluateMandatoryRetrievalGate([
      {
        id: 'large-win',
        goldIds: ['ko.md', 'en.md', 'la.md'],
        engine: ['ko.md', 'en.md', 'la.md'],
        baseline: ['literal-1.md', 'literal-2.md', 'literal-3.md'],
        k: TOP_K,
      },
      {
        id: 'hidden-language-regression',
        goldIds: ['ko.md', 'en.md', 'la.md'],
        engine: ['ko.md', 'en.md', 'literal-la.md'],
        baseline: ['ko.md', 'literal-en.md', 'literal-la.md'],
        k: TOP_K,
      },
    ]);

    expect(report.passed).toBe(false);
    expect(report.failures.join('\n')).toContain('hidden-language-regression');
  });

  it('npm test·빌드·릴리스 경로가 같은 필수 게이트를 실행한다', () => {
    const packageJson = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { scripts: Record<string, string> };

    expect(packageJson.scripts.test).toContain('vitest run');
    expect(packageJson.scripts['search:quality-gate']).toBe(
      'vitest run src/rag/search-quality-gate.test.ts',
    );
    expect(packageJson.scripts.build).toContain(
      'npm run wasm:build && npm run search:quality-gate',
    );
    expect(packageJson.scripts['security:full']).toContain('npm run test');
  });
});

function buildQualityCases(source: QualityFixture): readonly QualityCase[] {
  return source.concepts.flatMap((concept) =>
    (['ko', 'en', 'la'] as const).map((queryLanguage) => ({
      id: `${concept.id}-${queryLanguage}`,
      conceptId: concept.id,
      queryLanguage,
      query: concept.queries[queryLanguage].text,
      queryVector: concept.queries[queryLanguage].vector,
      terms: GOLD_LANGUAGES.map((language) => concept.terms[language]),
      gold: concept.gold,
      distractors: concept.distractors,
    })),
  );
}

async function selectFinalEvidence(
  row: QualityCase,
  documents: CaseDocuments,
  rankedPaths: readonly string[],
) {
  const entries = documentList(documents).map((document) =>
    createVectorEntry(document.id, document.vector, document.text),
  );
  const corpus: IndexedVaultCorpus = {
    getEntriesByFilePaths: (paths) =>
      Promise.resolve(entries.filter((entry) => paths.includes(entry.metadata.filePath))),
    getFileIndexRecords: () =>
      Promise.resolve(
        entries.map((entry) => ({
          filePath: entry.metadata.filePath,
          contentHash: entry.metadata.contentHash,
          sourceMtime: entry.metadata.sourceMtime,
          sourceSize: entry.metadata.sourceSize,
          vectorCount: 1,
          updated: 1,
        })),
      ),
  };
  const result = await searchIndexedVault({
    question: row.query,
    indexedPaths: entries.map((entry) => entry.metadata.filePath),
    scopes: [],
    corpus,
    candidates: rankedPaths.map((path, index) => ({
      path,
      score: 1 / (index + 1),
      source: 'vector',
      rank: index + 1,
    })),
    exhaustiveReview: true,
  });
  if (!result) throw new Error(`${row.id}: 최종 원문 근거 검색이 null을 반환했습니다.`);
  return result;
}

async function createRuntime(row: QualityCase, documents: CaseDocuments) {
  const store = new MemoryVectorStore();
  await store.add(
    documentList(documents).map((document) =>
      createVectorEntry(document.id, document.vector, document.text),
    ),
  );
  const bm25 = new IndexedDbBM25Index(createBm25DbName());
  await bm25.load();
  for (const document of documentList(documents))
    bm25.addDocument(document.id, document.text);
  const queryVector = decodeVector(row.queryVector);
  const embeddingProvider: EmbeddingProvider = {
    embed: () => Promise.resolve(queryVector),
    embedBatch: (texts) => Promise.resolve(texts.map(() => queryVector)),
  };
  const engine = new RAGQueryEngine(store, embeddingProvider, bm25);
  return { engine, close: () => bm25.close() };
}

function createDocuments(row: QualityCase): CaseDocuments {
  const root = `Synthetic/Parallel/${row.id}`;
  const gold = {
    ko: makeDocument(root, 'gold-ko', 'ko', row.gold.ko),
    en: makeDocument(root, 'gold-en', 'en', row.gold.en),
    la: makeDocument(root, 'gold-la', 'la', row.gold.la),
  } satisfies Record<GoldLanguage, SyntheticDocument>;
  const distractors = GOLD_LANGUAGES.filter(
    (language) => language !== row.queryLanguage,
  ).map((language) =>
    makeDocument(root, `literal-${language}`, language, row.distractors[language]),
  );
  return {
    gold,
    distractors,
    neutral: {
      id: `${root}/neutral.md`,
      language: 'neutral',
      text: fixture.neutral.text,
      vector: decodeVector(fixture.neutral.vector),
    },
  };
}

function makeDocument(
  root: string,
  suffix: string,
  language: GoldLanguage,
  source: VectorText,
): SyntheticDocument {
  return {
    id: `${root}/${suffix}.md`,
    language,
    text: source.text,
    vector: decodeVector(source.vector),
  };
}

function goldDocuments(documents: CaseDocuments): readonly SyntheticDocument[] {
  return [documents.gold.ko, documents.gold.en, documents.gold.la];
}

function documentList(documents: CaseDocuments): readonly SyntheticDocument[] {
  return [...goldDocuments(documents), ...documents.distractors, documents.neutral];
}

function goldDocumentIds(documents: CaseDocuments): readonly string[] {
  return goldDocuments(documents).map((document) => document.id);
}

function createVectorEntry(id: string, vector: readonly number[], text: string): VectorEntry {
  return {
    id,
    vector: [...vector],
    metadata: {
      filePath: id,
      startLine: 0,
      endLine: 0,
      text,
      sourceMtime: 1,
      sourceSize: text.length,
      contentHash: `hash:${id}`,
      indexedAt: 1,
    },
  };
}

function naiveKeywordRanking(
  documents: readonly SyntheticDocument[],
  terms: readonly string[],
  limit: number,
): string[] {
  const normalizedTerms = terms.map(normalizeText);
  return documents
    .map((document, index) => ({
      id: document.id,
      index,
      score: normalizedTerms.reduce(
        (total, term) => total + occurrenceCount(normalizeText(document.text), term),
        0,
      ),
    }))
    .filter((row) => row.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit)
    .map((row) => row.id);
}

function occurrenceCount(text: string, term: string): number {
  if (term.length === 0) return 0;
  return text.split(term).length - 1;
}

function normalizeText(text: string): string {
  return text.normalize('NFKC').toLocaleLowerCase();
}

function evaluateMandatoryRetrievalGate(cases: readonly GateCase[]): GateReport {
  const rows = cases.map((row): GateRow => {
    const engineRanks = row.goldIds.map((goldId) => rankOf(row.engine.slice(0, row.k), goldId));
    const baselineRanks = row.goldIds.map((goldId) =>
      rankOf(row.baseline.slice(0, row.k), goldId),
    );
    const engineCoverage = coverageAtK(row.engine, row.goldIds, row.k);
    const baselineCoverage = coverageAtK(row.baseline, row.goldIds, row.k);
    const engineMrr = mean(engineRanks.map((rank) => (rank > 0 ? 1 / rank : 0)));
    const baselineMrr = mean(baselineRanks.map((rank) => (rank > 0 ? 1 / rank : 0)));
    return {
      ...row,
      engineCoverage,
      baselineCoverage,
      engineMrr,
      baselineMrr,
      passed: engineCoverage === 1 && engineMrr > baselineMrr,
    };
  });
  const failures = rows
    .filter((row) => !row.passed)
    .map(
      (row) =>
        `${row.id}: missing ${row.goldIds.length - Math.round(row.engineCoverage * row.goldIds.length)}/${row.goldIds.length} gold in top-${row.k}; engine coverage=${row.engineCoverage.toFixed(2)}, baseline coverage=${row.baselineCoverage.toFixed(2)}`,
    );
  return {
    passed: failures.length === 0,
    rows,
    failures,
    engineMeanMrr: mean(rows.map((row) => row.engineMrr)),
    baselineMeanMrr: mean(rows.map((row) => row.baselineMrr)),
  };
}

function coverageAtK(
  ids: readonly string[],
  goldIds: readonly string[],
  k: number,
): number {
  if (goldIds.length === 0) return 0;
  const top = new Set(ids.slice(0, Math.max(0, k)));
  return goldIds.filter((id) => top.has(id)).length / goldIds.length;
}

function formatGateFailure(report: GateReport): string {
  return [
    `병렬 검색 필수 게이트 실패: engine MRR=${report.engineMeanMrr.toFixed(3)}, baseline MRR=${report.baselineMeanMrr.toFixed(3)}`,
    ...report.failures,
  ].join('\n');
}

function rankOf(ids: readonly string[], goldId: string): number {
  const index = ids.indexOf(goldId);
  return index < 0 ? 0 : index + 1;
}

function mean(values: readonly number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((total, value) => total + value, 0) / values.length;
}

function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  if (left.length !== right.length || left.length === 0) return Number.NaN;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function decodeVector(encoded: string): number[] {
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0)
    throw new Error('병렬 검색 fixture 벡터 길이가 잘못되었습니다.');
  const copy = Uint8Array.from(bytes);
  return Array.from(new Float32Array(copy.buffer));
}

function createBm25DbName(): string {
  const name = `SuperpowerInsideParallelQualityGate-${crypto.randomUUID()}`;
  bm25DbNames.add(name);
  return name;
}

function loadFixture(): QualityFixture {
  const parsed = JSON.parse(
    readFileSync(new URL('./fixtures/embeddinggemma-cross-lingual.json', import.meta.url), 'utf8'),
  ) as QualityFixture;
  if (parsed.schemaVersion !== 2 || parsed.concepts.length === 0)
    throw new Error('병렬 검색 품질 fixture가 비어 있거나 지원되지 않는 형식입니다.');
  return parsed;
}
