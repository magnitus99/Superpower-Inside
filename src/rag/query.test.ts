import type { DataAdapter, TFile } from 'obsidian';
import { describe, expect, it } from 'vitest';
import type { EmbeddingProvider } from '../llm/embedding';
import { DEFAULT_ONTOLOGY_SCHEMA } from '../ontology/schema';
import { GraphRagQueryEngine } from '../graph/query-engine';
import {
  InMemoryKnowledgeGraphStore,
  type GraphEntityRecord,
  type GraphEvidenceRecord,
  type GraphRelationRecord,
} from '../graph/store';
import { JsonFileBM25Index } from './bm25';
import { RAGQueryEngine } from './query';
import { MemoryVectorStore, type VectorEntry } from './store';

describe('RAGQueryEngine', () => {
  it('벡터 상위 후보 밖의 BM25 전용 후보도 최종 후보에 포함한다', async () => {
    const store = new MemoryVectorStore();
    const entries = Array.from({ length: 12 }, (_, index) =>
      createEntry(`semantic-${index}.md`, [1, 0], '일반 문서 내용'),
    );
    entries.push(createEntry('keyword.md', [0.2, 0.98], 'specialterm 정확한 키워드 문서'));
    await store.add(entries);
    const bm25 = await createBm25([
      ['keyword.md', 'specialterm 정확한 키워드 문서'],
      ...entries.slice(0, 12).map((entry) => [entry.metadata.filePath, '일반 문서 내용'] as const),
    ]);
    const engine = new RAGQueryEngine(store, createEmbeddingProvider([1, 0]), bm25, 0.8, 0.2);

    const results = await engine.query('specialterm', 1);

    expect(results[0]?.entry.metadata.filePath).toBe('keyword.md');
    expect(results[0]?.bm25Score).toBeGreaterThan(0);
  });

  it('파일 단위 BM25 보정만 받은 무관 청크는 통과시키지 않는다', async () => {
    const store = new MemoryVectorStore();
    await store.add([
      createEntry('mixed.md', [0.2, 0.98], 'specialterm 관련 청크'),
      createEntry('mixed.md', [0.2, 0.98], '전혀 다른 청크', 20),
    ]);
    const bm25 = await createBm25([['mixed.md', 'specialterm 관련 청크 전혀 다른 청크']]);
    const engine = new RAGQueryEngine(store, createEmbeddingProvider([1, 0]), bm25, 0.8, 0.2);

    const results = await engine.query('specialterm', 5);

    expect(results.map((result) => result.entry.metadata.startLine)).toEqual([0]);
  });

  it('최고점 대비 점수 차이가 큰 낮은 관련도 후보를 제외한다', async () => {
    const store = new MemoryVectorStore();
    await store.add([
      createEntry('best.md', [1, 0], '질문과 가까운 문서'),
      createEntry('weak.md', [0.7, 0.714], '약한 관련 문서'),
    ]);
    const engine = new RAGQueryEngine(store, createEmbeddingProvider([1, 0]), undefined, 0.3, 0.1);

    const results = await engine.query('질문', 2);

    expect(results.map((result) => result.entry.metadata.filePath)).toEqual(['best.md']);
  });

  it('BM25 후보 병합 시 전체 벡터를 읽지 않고 해당 파일 entries만 가져온다', async () => {
    const store = new PathLookupStore();
    await store.add([
      createEntry('semantic.md', [1, 0], '일반 문서 내용'),
      createEntry('keyword.md', [0.2, 0.98], 'specialterm 정확한 키워드 문서'),
    ]);
    const bm25 = await createBm25([
      ['keyword.md', 'specialterm 정확한 키워드 문서'],
      ['semantic.md', '일반 문서 내용'],
    ]);
    const engine = new RAGQueryEngine(store, createEmbeddingProvider([1, 0]), bm25, 0.8, 0.2);

    const results = await engine.query('specialterm', 1);

    expect(results[0]?.entry.metadata.filePath).toBe('keyword.md');
    expect(store.getEntriesCalls).toBe(0);
    expect(store.requestedPaths).toEqual([['keyword.md']]);
  });

  it('ANN이 활성화되면 RAGQueryEngine은 ANN provider diagnostic을 기록한다', async () => {
    const store = new MemoryVectorStore();
    await store.add(
      Array.from({ length: 12 }, (_, index) =>
        createEntry(`entry-${index}.md`, index === 0 ? [1, 0] : [0, 1], '문서'),
      ),
    );
    const engine = new RAGQueryEngine(store, createEmbeddingProvider([1, 0]), undefined, 0.3, 0.1, {
      annEnabled: true,
      annClusterCount: 2,
      annProbeCount: 1,
      annMinEntryCount: 10,
    });

    await engine.query('질문', 1);

    expect(engine.getLastRetrievalDiagnostics()).toEqual([
      expect.objectContaining({
        providerId: 'ivf-vector',
        source: 'ann',
        status: 'ok',
      }),
    ]);
  });

  it('구조 그래프가 활성화되면 RAGQueryEngine은 structural provider diagnostic을 기록한다', async () => {
    const store = new MemoryVectorStore();
    await store.add([
      createEntry('seed.md', [1, 0], 'seed text'),
      createEntry('linked.md', [0, 1], 'linked text'),
    ]);
    const engine = new RAGQueryEngine(store, createEmbeddingProvider([1, 0]), undefined, 0.3, 0.1, {
      structuralGraphEnabled: true,
      structuralMetadataContext: createMetadataContext({
        resolvedLinks: {
          'seed.md': { 'linked.md': 1 },
        },
      }),
    });

    await engine.query('질문', 2);

    expect(engine.getLastRetrievalDiagnostics()).toEqual([
      expect.objectContaining({
        providerId: 'exact-vector',
        source: 'vector',
        status: 'ok',
      }),
      expect.objectContaining({
        providerId: 'structural-graph',
        source: 'structural',
        status: 'ok',
      }),
    ]);
  });

  it('GraphRAG가 활성화되면 graph 후보가 낮은 vector score라도 최종 결과에 참여한다', async () => {
    const store = new MemoryVectorStore();
    await store.add([
      createEntry('semantic.md', [1, 0], '일반 문서 내용'),
      createEntry('graph.md', [0, 1], 'Paul and Barnabas traveled together.'),
    ]);
    const graphStore = new InMemoryKnowledgeGraphStore();
    await graphStore.addEvidence(createEvidence());
    await graphStore.upsertEntity(createGraphEntity('Paul'));
    await graphStore.upsertEntity(createGraphEntity('Barnabas'));
    await graphStore.addRelation(createGraphRelation());
    const graphEngine = new GraphRagQueryEngine(graphStore, store, DEFAULT_ONTOLOGY_SCHEMA);
    const engine = new RAGQueryEngine(store, createEmbeddingProvider([1, 0]), undefined, 0.3, 0.1, {
      graphRagEnabled: true,
      graphRagQueryEngine: graphEngine,
    });

    const results = await engine.query('Paul과 Barnabas 관계', 2);

    expect(results.map((result) => result.entry.metadata.filePath)).toContain('graph.md');
    expect(engine.getLastRetrievalDiagnostics()).toEqual([
      expect.objectContaining({ providerId: 'exact-vector' }),
      expect.objectContaining({ providerId: 'graph-rag', source: 'graph-local' }),
    ]);
  });
});

function createEmbeddingProvider(vector: number[]): EmbeddingProvider {
  return {
    embed: () => Promise.resolve(vector),
    embedBatch: (texts: string[]) => Promise.resolve(texts.map(() => vector)),
  };
}

function createEntry(path: string, vector: number[], text: string, startLine = 0): VectorEntry {
  return {
    id: `${path}::${startLine}`,
    vector,
    metadata: {
      filePath: path,
      startLine,
      endLine: startLine,
      text,
      sourceMtime: 1000,
      sourceSize: text.length,
      contentHash: 'hash',
      indexedAt: 1000,
      embeddingProvider: 'openai',
      embeddingModel: 'text-embedding-3-small',
    },
  };
}

async function createBm25(
  documents: readonly (readonly [string, string])[],
): Promise<JsonFileBM25Index> {
  const bm25 = new JsonFileBM25Index(createAdapter());
  await bm25.load();
  for (const [path, text] of documents) {
    bm25.addDocument(path, text);
  }
  return bm25;
}

function createAdapter(): DataAdapter {
  return {
    exists: () => Promise.resolve(false),
    read: () => Promise.resolve(''),
    write: () => Promise.resolve(),
    mkdir: () => Promise.resolve(),
  } as unknown as DataAdapter;
}

class PathLookupStore extends MemoryVectorStore {
  getEntriesCalls = 0;
  requestedPaths: string[][] = [];

  override getEntries(): Promise<VectorEntry[]> {
    this.getEntriesCalls++;
    return super.getEntries();
  }

  override async getEntriesByFilePaths(filePaths: readonly string[]): Promise<VectorEntry[]> {
    this.requestedPaths.push([...filePaths].sort());
    const allowed = new Set(filePaths);
    return (await super.getEntries()).filter((entry) => allowed.has(entry.metadata.filePath));
  }
}

function createEvidence(): GraphEvidenceRecord {
  return {
    id: 'evidence::graph',
    filePath: 'graph.md',
    entryId: 'graph.md::0',
    startLine: 0,
    endLine: 0,
    quote: 'Paul and Barnabas traveled together.',
    contentHash: 'hash',
    extractionModelKey: 'openai:gpt-4o-mini',
    updatedAt: 1,
  };
}

function createGraphEntity(name: string): GraphEntityRecord {
  return {
    id: `entity::general::person::${name.toLowerCase()}`,
    ontologySchemaId: 'default',
    ontologyVersion: 1,
    typeId: 'person',
    canonicalName: name,
    aliases: [],
    description: '',
    properties: {},
    confidence: 0.9,
    evidenceIds: ['evidence::graph'],
    createdAt: 1,
    updatedAt: 1,
  };
}

function createGraphRelation(): GraphRelationRecord {
  return {
    id: 'relation::graph',
    ontologySchemaId: 'default',
    ontologyVersion: 1,
    relationTypeId: 'collaborated_with',
    sourceEntityId: 'entity::general::person::paul',
    targetEntityId: 'entity::general::person::barnabas',
    description: 'Paul and Barnabas traveled together.',
    properties: {},
    confidence: 0.9,
    evidenceIds: ['evidence::graph'],
    createdAt: 1,
    updatedAt: 1,
  };
}

function createMetadataContext(input: { resolvedLinks?: Record<string, Record<string, number>> }) {
  const files = new Map<string, TFile>();
  const getFile = (path: string): TFile => {
    const existing = files.get(path);
    if (existing) return existing;
    const file = { path } as TFile;
    files.set(path, file);
    return file;
  };

  return {
    resolvedLinks: input.resolvedLinks ?? {},
    getFileByPath: (path: string) => getFile(path),
    getFileCache: () => null,
    getFirstLinkpathDest: (linkpath: string) => getFile(linkpath),
  };
}
