import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { searchIndexedVault, type IndexedVaultCorpus } from '../agent/indexed-vault-review';
import { createIndexedSearchPort } from '../search/engine-adapter';
import type { EmbeddingProvider } from '../llm/embedding';
import { IndexedDbBM25Index } from './bm25';
import { RAGQueryEngine } from './query';
import { MemoryVectorStore, type VectorEntry } from './store';

const LANGUAGES = ['ko', 'en', 'la'] as const;
type Language = (typeof LANGUAGES)[number];
const TOP_K = 3;
const DIMENSIONS = 12;

interface Concept {
  id: string;
  terms: Record<Language, string>;
}

interface SyntheticDocument {
  id: string;
  language: Language | 'neutral';
  text: string;
  vector: readonly number[];
}

interface CaseDocuments {
  gold: Record<Language, SyntheticDocument>;
  distractors: readonly SyntheticDocument[];
  neutral: SyntheticDocument;
}

interface QualityCase {
  id: string;
  conceptIndex: number;
  queryLanguage: Language;
  query: string;
  queryVector: readonly number[];
  terms: readonly string[];
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

// 세 언어의 정답 문서가 같은 개념 축을 공유하고, 키워드만 반복한 방해 문서는
// 다른 축에 놓이도록 만든 결정적 합성 벡터입니다. 외부 모델·볼트 자료를 쓰지 않습니다.
const CONCEPTS: readonly Concept[] = [
  {
    id: 'maintenance',
    terms: { ko: '유지보수', en: 'maintenance', la: 'sustentatio' },
  },
  { id: 'balance', terms: { ko: '균형', en: 'balance', la: 'aequilibrium' } },
  { id: 'memory', terms: { ko: '기억', en: 'memory', la: 'memoria' } },
];

const qualityCases: readonly QualityCase[] = CONCEPTS.flatMap((concept, conceptIndex) =>
  LANGUAGES.map((queryLanguage) => ({
    id: `${concept.id}-${queryLanguage}`,
    conceptIndex,
    queryLanguage,
    query: concept.terms[queryLanguage],
    queryVector: conceptVector(conceptIndex),
    terms: LANGUAGES.map((language) => concept.terms[language]),
  })),
);

const bm25DbNames = new Set<string>();

afterEach(async () => {
  await Promise.all([...bm25DbNames].map((name) => Dexie.delete(name)));
  bm25DbNames.clear();
});

describe('한·영·라틴 합성 검색 품질 필수 게이트', () => {
  it('합성 fixture는 개념마다 세 언어 정답과 질의를 가진다', () => {
    for (const concept of CONCEPTS) {
      expect(Object.keys(concept.terms)).toEqual([...LANGUAGES]);
      expect(concept.terms.ko.length).toBeGreaterThan(0);
      expect(concept.terms.en.length).toBeGreaterThan(0);
      expect(concept.terms.la.length).toBeGreaterThan(0);
    }
    expect(qualityCases).toHaveLength(CONCEPTS.length * LANGUAGES.length);
  });

  it.each(qualityCases)(
    '[필수] $id는 한국어·영어·라틴어 정답 3개를 모두 top-3에 반환해야 한다',
    async (row) => {
      const documents = createDocuments(row);
      const runtime = await createRuntime(row, documents);
      try {
        const nonGoldDocuments = [...documents.distractors, documents.neutral];
        const bestNonGoldSimilarity = Math.max(
          ...nonGoldDocuments.map((document) =>
            cosineSimilarity(row.queryVector, document.vector),
          ),
        );
        for (const language of LANGUAGES) {
          expect(
            cosineSimilarity(row.queryVector, documents.gold[language].vector) -
              bestNonGoldSimilarity,
            `${row.id}: ${language} 정답의 의미 유사도가 키워드 방해 문서보다 앞서야 합니다.`,
          ).toBeGreaterThan(0.2);
        }

        const results = await runtime.engine.query(row.query, TOP_K);
        const goldIds = goldDocumentIds(documents);
        expect(new Set(results.map((result) => result.sourcePath))).toEqual(new Set(goldIds));

        const finalEvidence = await selectFinalEvidence(
          row,
          documents,
          results.map((result) => result.sourcePath),
        );
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

  it('제품 SearchPort 경로도 세 언어 정답을 함께 반환한다', async () => {
    const row = qualityCases[0];
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
    const textByPath = new Map(
      entries.map((entry) => [entry.metadata.filePath, entry.metadata.text]),
    );
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

  it('벡터 후보가 사라진 lexical-only 경로는 세 언어 정답을 모두 통과시키지 않는다', async () => {
    const row = qualityCases[0];
    const documents = createDocuments(row);
    const bm25 = new IndexedDbBM25Index(createBm25DbName());
    await bm25.load();
    for (const document of documentList(documents))
      bm25.addDocument(document.id, document.text);
    try {
      const lexicalOnly = new RAGQueryEngine(null, null, bm25);
      const engineResults = await lexicalOnly.query(row.query, TOP_K);
      const report = evaluateMandatoryRetrievalGate([
        {
          id: row.id,
          goldIds: goldDocumentIds(documents),
          engine: engineResults.map((result) => result.sourcePath),
          baseline: [],
          k: TOP_K,
        },
      ]);

      expect(report.passed).toBe(false);
      expect(report.failures.join('\n')).toContain(row.id);
    } finally {
      bm25.close();
    }
  });

  it('한 언어 정답만 누락해도 3개 정답 동시 회수 테스트는 실패한다', () => {
    const goldIds = ['gold-ko.md', 'gold-en.md', 'gold-la.md'];
    const report = evaluateMandatoryRetrievalGate([
      {
        id: 'synthetic-case',
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

    expect(packageJson.scripts['test:unit']).toContain('vitest run');
    expect(packageJson.scripts.test).toContain('test:unit');
    expect(packageJson.scripts['search:quality-gate']).toBe(
      'vitest run src/rag/search-quality-gate.test.ts',
    );
    expect(packageJson.scripts.build).toContain(
      'npm run wasm:build && npm run search:quality-gate',
    );
    expect(packageJson.scripts['security:full']).toContain('npm run test');
  });
});

function conceptVector(conceptIndex: number): readonly number[] {
  const vector = new Array<number>(DIMENSIONS).fill(0);
  vector[conceptIndex] = 1;
  return vector;
}

function goldVector(conceptIndex: number, languageIndex: number): readonly number[] {
  const vector = new Array<number>(DIMENSIONS).fill(0);
  vector[conceptIndex] = 0.9;
  vector[CONCEPTS.length + languageIndex] = 0.1;
  vector[DIMENSIONS - 1] = 0.05;
  return vector;
}

function distractorVector(conceptIndex: number, languageIndex: number): readonly number[] {
  const vector = new Array<number>(DIMENSIONS).fill(0);
  vector[(conceptIndex + 1) % CONCEPTS.length] = 0.4;
  vector[CONCEPTS.length + LANGUAGES.length + languageIndex] = 0.6;
  return vector;
}

function neutralVector(): readonly number[] {
  const vector = new Array<number>(DIMENSIONS).fill(0);
  vector[DIMENSIONS - 2] = 1;
  return vector;
}

function createDocuments(row: QualityCase): CaseDocuments {
  const concept = CONCEPTS[row.conceptIndex];
  const root = `Synthetic/Parallel/${row.id}`;
  const gold = Object.fromEntries(
    LANGUAGES.map((language) => {
      const languageIndex = LANGUAGES.indexOf(language);
      return [
        language,
        makeDocument(
          root,
          `gold-${language}`,
          language,
          `${concept.terms[language]}: synthetic ${language} reference note.`,
          goldVector(row.conceptIndex, languageIndex),
        ),
      ];
    }),
  ) as Record<Language, SyntheticDocument>;
  const distractors = LANGUAGES.filter(
    (language) => language !== row.queryLanguage,
  ).map((language) => {
    const term = concept.terms[language];
    return makeDocument(
      root,
      `literal-${language}`,
      language,
      `${term} ${term} ${term} ${term} ${term}: unrelated table of font names and box numbers.`,
      distractorVector(row.conceptIndex, LANGUAGES.indexOf(language)),
    );
  });
  return {
    gold,
    distractors,
    neutral: {
      id: `${root}/neutral.md`,
      language: 'neutral',
      text: 'The annual maintenance calendar uses blue labels for archived folders.',
      vector: neutralVector(),
    },
  };
}

function makeDocument(
  root: string,
  suffix: string,
  language: Language,
  text: string,
  vector: readonly number[],
): SyntheticDocument {
  return { id: `${root}/${suffix}.md`, language, text, vector };
}

function goldDocumentIds(documents: CaseDocuments): readonly string[] {
  return LANGUAGES.map((language) => documents.gold[language].id);
}

function documentList(documents: CaseDocuments): readonly SyntheticDocument[] {
  return [...LANGUAGES.map((language) => documents.gold[language]), ...documents.distractors, documents.neutral];
}

function createVectorEntry(
  id: string,
  vector: readonly number[],
  text: string,
): VectorEntry {
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
  const embeddingProvider: EmbeddingProvider = {
    embed: () => Promise.resolve([...row.queryVector]),
    embedBatch: (texts) => Promise.resolve(texts.map(() => [...row.queryVector])),
  };
  const engine = new RAGQueryEngine(store, embeddingProvider, bm25);
  return { engine, close: () => bm25.close() };
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

function createBm25DbName(): string {
  const name = `SuperpowerInsideSyntheticQualityGate-${crypto.randomUUID()}`;
  bm25DbNames.add(name);
  return name;
}
