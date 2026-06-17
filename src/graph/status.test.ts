import { describe, expect, it } from 'vitest';
import type { RAGConfig } from '../settings';
import { MemoryVectorStore } from '../rag/store';
import { buildDefaultOntologySchema } from '../ontology/schema';
import { calculateGraphRagStatus } from './status';
import { InMemoryKnowledgeGraphStore } from './store';

const baseRagConfig: Pick<
  RAGConfig,
  'graphRagEnabled' | 'graphRagModel' | 'graphRagMaxFilesPerRun'
> = {
  graphRagEnabled: true,
  graphRagModel: 'openai:gpt-4.1-mini',
  graphRagMaxFilesPerRun: 50,
};
const CURRENT_ONTOLOGY_VERSION = buildDefaultOntologySchema().version;

function createEntry(filePath: string, contentHash: string) {
  return {
    id: `${filePath}::0`,
    vector: [1, 0] as number[],
    metadata: {
      filePath,
      contentHash,
      text: 'hello',
      startLine: 1,
      endLine: 1,
    },
  };
}

describe('calculateGraphRagStatus', () => {
  it('GraphRAG가 꺼져 있으면 disabled를 반환한다', async () => {
    const status = await calculateGraphRagStatus({
      ragConfig: { ...baseRagConfig, graphRagEnabled: false },
      graphStore: new InMemoryKnowledgeGraphStore(),
      vectorStore: new MemoryVectorStore(),
      isRunning: false,
      schemaErrors: [],
    });

    expect(status.state).toBe('disabled');
  });

  it('graph evidence가 없으면 not-built를 반환한다', async () => {
    const vectorStore = new MemoryVectorStore();
    await vectorStore.add([createEntry('note.md', 'hash-a')]);

    const status = await calculateGraphRagStatus({
      ragConfig: baseRagConfig,
      graphStore: new InMemoryKnowledgeGraphStore(),
      vectorStore,
      isRunning: false,
      schemaErrors: [],
    });

    expect(status.state).toBe('not-built');
    expect(status.totalCandidateFiles).toBe(1);
  });

  it('실행 중이면 building을 반환한다', async () => {
    const status = await calculateGraphRagStatus({
      ragConfig: baseRagConfig,
      graphStore: new InMemoryKnowledgeGraphStore(),
      vectorStore: new MemoryVectorStore(),
      isRunning: true,
      schemaErrors: [],
    });

    expect(status.state).toBe('building');
  });

  it('cache가 현재 파일/model/schema/version과 모두 맞으면 ready를 반환한다', async () => {
    const vectorStore = new MemoryVectorStore();
    await vectorStore.add([createEntry('note.md', 'hash-a')]);
    const graphStore = new InMemoryKnowledgeGraphStore();
    await graphStore.addEvidence({
      id: 'ev-1',
      filePath: 'note.md',
      entryId: 'note.md::0',
      startLine: 1,
      quote: 'text',
      contentHash: 'hash-a',
      extractionModelKey: 'openai:gpt-4.1-mini',
      updatedAt: 1000,
    });
    await graphStore.markExtractionCached({
      entryId: 'note.md::0',
      contentHash: 'hash-a',
      extractionModelKey: 'openai:gpt-4.1-mini',
      ontologySchemaId: 'default',
      ontologyVersion: CURRENT_ONTOLOGY_VERSION,
      updatedAt: 1000,
    });

    const status = await calculateGraphRagStatus({
      ragConfig: baseRagConfig,
      graphStore,
      vectorStore,
      isRunning: false,
      schemaErrors: [],
    });

    expect(status.state).toBe('ready');
    expect(status.staleFileCount).toBe(0);
  });

  it('현재 vault에 없는 vector file은 후보와 stale 계산에서 제외한다', async () => {
    const vectorStore = new MemoryVectorStore();
    await vectorStore.add([
      createEntry('current.md', 'hash-current'),
      createEntry('foreign.md', 'hash-foreign'),
    ]);
    const graphStore = new InMemoryKnowledgeGraphStore();
    await graphStore.addEvidence({
      id: 'ev-current',
      filePath: 'current.md',
      entryId: 'current.md::0',
      startLine: 1,
      quote: 'current text',
      contentHash: 'hash-current',
      extractionModelKey: 'openai:gpt-4.1-mini',
      updatedAt: 1000,
    });
    await graphStore.markExtractionCached({
      entryId: 'current.md::0',
      contentHash: 'hash-current',
      extractionModelKey: 'openai:gpt-4.1-mini',
      ontologySchemaId: 'default',
      ontologyVersion: CURRENT_ONTOLOGY_VERSION,
      updatedAt: 1000,
    });
    const input = {
      ragConfig: baseRagConfig,
      graphStore,
      vectorStore,
      isRunning: false,
      schemaErrors: [],
      isProcessableFilePath: (filePath: string) => filePath === 'current.md',
    };

    const status = await calculateGraphRagStatus(input);

    expect(status.state).toBe('ready');
    expect(status.totalCandidateFiles).toBe(1);
    expect(status.staleFilePaths).toEqual([]);
  });

  it('graph evidence의 파일이 vector store에 없으면 stale로 반환한다', async () => {
    const graphStore = new InMemoryKnowledgeGraphStore();
    await graphStore.addEvidence({
      id: 'ev-orphan',
      filePath: 'deleted.md',
      entryId: 'deleted.md::0',
      startLine: 1,
      quote: 'deleted text',
      contentHash: 'hash-old',
      extractionModelKey: 'openai:gpt-4.1-mini',
      updatedAt: 1000,
    });
    await graphStore.markExtractionCached({
      entryId: 'deleted.md::0',
      contentHash: 'hash-old',
      extractionModelKey: 'openai:gpt-4.1-mini',
      ontologySchemaId: 'default',
      ontologyVersion: CURRENT_ONTOLOGY_VERSION,
      updatedAt: 1000,
    });

    const status = await calculateGraphRagStatus({
      ragConfig: baseRagConfig,
      graphStore,
      vectorStore: new MemoryVectorStore(),
      isRunning: false,
      schemaErrors: [],
    });

    expect(status.state).toBe('stale');
    expect(status.staleFilePaths).toEqual(['deleted.md']);
  });

  it('모델이나 contentHash가 바뀌면 stale을 반환한다', async () => {
    const vectorStore = new MemoryVectorStore();
    await vectorStore.add([createEntry('note.md', 'hash-new')]);
    const graphStore = new InMemoryKnowledgeGraphStore();
    await graphStore.addEvidence({
      id: 'ev-1',
      filePath: 'note.md',
      entryId: 'note.md::0',
      startLine: 1,
      quote: 'text',
      contentHash: 'hash-old',
      extractionModelKey: 'openai:gpt-4.1-mini',
      updatedAt: 1000,
    });
    await graphStore.markExtractionCached({
      entryId: 'note.md::0',
      contentHash: 'hash-old',
      extractionModelKey: 'openai:gpt-4.1-mini',
      ontologySchemaId: 'default',
      ontologyVersion: CURRENT_ONTOLOGY_VERSION,
      updatedAt: 1000,
    });

    const status = await calculateGraphRagStatus({
      ragConfig: { ...baseRagConfig, graphRagModel: 'openai:gpt-4.1' },
      graphStore,
      vectorStore,
      isRunning: false,
      schemaErrors: [],
    });

    expect(status.state).toBe('stale');
    expect(status.staleFileCount).toBe(1);
  });

  it('rejected fact가 있으면 partial을 반환하고 pending merge 수를 포함한다', async () => {
    const vectorStore = new MemoryVectorStore();
    await vectorStore.add([createEntry('note.md', 'hash-a')]);
    const graphStore = new InMemoryKnowledgeGraphStore();
    await graphStore.addEvidence({
      id: 'ev-1',
      filePath: 'note.md',
      entryId: 'note.md::0',
      startLine: 1,
      quote: 'text',
      contentHash: 'hash-a',
      extractionModelKey: 'openai:gpt-4.1-mini',
      updatedAt: 1000,
    });
    await graphStore.markExtractionCached({
      entryId: 'note.md::0',
      contentHash: 'hash-a',
      extractionModelKey: 'openai:gpt-4.1-mini',
      ontologySchemaId: 'default',
      ontologyVersion: CURRENT_ONTOLOGY_VERSION,
      updatedAt: 1000,
    });
    await graphStore.addRejectedFact({
      id: 'reject-1',
      filePath: 'note.md',
      entryId: 'note.md::0',
      reason: 'schema',
      rawFact: {},
      updatedAt: 1000,
    });
    await graphStore.addPendingEntityMerge({
      id: 'merge-1',
      ontologySchemaId: 'default',
      existingEntityId: 'a',
      candidateEntityId: 'b',
      mergeScore: 0.8,
      reason: 'similar',
      updatedAt: 1000,
    });

    const status = await calculateGraphRagStatus({
      ragConfig: baseRagConfig,
      graphStore,
      vectorStore,
      isRunning: false,
      schemaErrors: [],
    });

    expect(status.state).toBe('partial');
    expect(status.failedFileCount).toBe(1);
    expect(status.pendingMergeCount).toBe(1);
  });

  it('schema 오류가 있으면 schema-error를 우선 반환한다', async () => {
    const status = await calculateGraphRagStatus({
      ragConfig: baseRagConfig,
      graphStore: new InMemoryKnowledgeGraphStore(),
      vectorStore: new MemoryVectorStore(),
      isRunning: false,
      schemaErrors: ['unknown relation'],
    });

    expect(status.state).toBe('schema-error');
  });
  it('stale 파일 목록을 staleFilePaths로 반환한다', async () => {
    const vectorStore = new MemoryVectorStore();
    await vectorStore.add([createEntry('note.md', 'hash-a')]);

    const graphStore = new InMemoryKnowledgeGraphStore();
    await graphStore.addEvidence({
      id: 'ev-1',
      filePath: 'note.md',
      entryId: 'chunk-1',
      startLine: 1,
      quote: 'Alice knows Bob',
      contentHash: 'hash-a',
      extractionModelKey: 'openai:gpt-4.1-mini',
      updatedAt: Date.now(),
    });
    // 캐시 기록은 없으므로 note.md가 stale로 판정되어야 함
    const status = await calculateGraphRagStatus({
      ragConfig: baseRagConfig,
      graphStore,
      vectorStore,
      isRunning: false,
      schemaErrors: [],
    });

    expect(status.state).toBe('stale');
    expect(status.staleFileCount).toBe(1);
    expect(status.staleFilePaths).toContain('note.md');
    expect(status.staleFilePaths.length).toBe(1);
  });

  it('stale 조건: contentHash 불일치', async () => {
    const vectorStore = new MemoryVectorStore();
    await vectorStore.add([{ id: 'e1', vector: [1, 0], metadata: { filePath: 'a.md', text: 'hi', contentHash: 'old', startLine: 1, endLine: 1 } }]);

    const graphStore = new InMemoryKnowledgeGraphStore();
    await graphStore.addEvidence({ id: 'ev-2', filePath: 'a.md', entryId: 'e1', startLine: 1, quote: 'X is Y', contentHash: 'hash-a', extractionModelKey: 'openai:gpt-4.1-mini', updatedAt: Date.now() });
    await graphStore.markExtractionCached({ entryId: 'e1', contentHash: 'new', extractionModelKey: 'openai:gpt-4.1-mini', ontologySchemaId: 'default', ontologyVersion: CURRENT_ONTOLOGY_VERSION, updatedAt: Date.now() });

    const status = await calculateGraphRagStatus({
      ragConfig: baseRagConfig,
      graphStore,
      vectorStore,
      isRunning: false,
      schemaErrors: [],
    });

    expect(status.state).toBe('stale');
    expect(status.staleFilePaths).toContain('a.md');
  });

  it('stale 조건: 추출 모델 불일치', async () => {
    const vectorStore = new MemoryVectorStore();
    await vectorStore.add([{ id: 'e1', vector: [1, 0], metadata: { filePath: 'a.md', text: 'hi', contentHash: 'same', startLine: 1, endLine: 1 } }]);

    const graphStore = new InMemoryKnowledgeGraphStore();
    await graphStore.addEvidence({ id: 'ev-2', filePath: 'a.md', entryId: 'e1', startLine: 1, quote: 'X is Y', contentHash: 'hash-a', extractionModelKey: 'openai:gpt-4.1-mini', updatedAt: Date.now() });
    await graphStore.markExtractionCached({ entryId: 'e1', contentHash: 'same', extractionModelKey: 'old-model', ontologySchemaId: 'default', ontologyVersion: CURRENT_ONTOLOGY_VERSION, updatedAt: Date.now() });

    const status = await calculateGraphRagStatus({
      ragConfig: baseRagConfig,
      graphStore,
      vectorStore,
      isRunning: false,
      schemaErrors: [],
    });

    expect(status.state).toBe('stale');
    expect(status.staleFilePaths).toContain('a.md');
  });

  it('cache/evidence 기반 상태 계산은 전체 vector entries를 읽지 않는다', async () => {
    const vectorStore = new StatusLookupVectorStore();
    await vectorStore.add([createEntry('note.md', 'hash-a')]);
    const graphStore = new InMemoryKnowledgeGraphStore();
    await graphStore.addEvidence({
      id: 'ev-1',
      filePath: 'note.md',
      entryId: 'note.md::0',
      startLine: 1,
      quote: 'text',
      contentHash: 'hash-a',
      extractionModelKey: 'openai:gpt-4.1-mini',
      updatedAt: 1000,
    });
    await graphStore.markExtractionCached({
      entryId: 'note.md::0',
      contentHash: 'hash-a',
      extractionModelKey: 'openai:gpt-4.1-mini',
      ontologySchemaId: 'default',
      ontologyVersion: CURRENT_ONTOLOGY_VERSION,
      updatedAt: 1000,
    });

    const status = await calculateGraphRagStatus({
      ragConfig: baseRagConfig,
      graphStore,
      vectorStore,
      isRunning: false,
      schemaErrors: [],
    });

    expect(status.state).toBe('ready');
    expect(vectorStore.getEntriesCalls).toBe(0);
    expect(vectorStore.requestedIds).toEqual([['note.md::0']]);
  });

  it('같은 파일의 일부 vector entry만 cache/evidence에 있으면 stale을 반환한다', async () => {
    const vectorStore = new MemoryVectorStore();
    await vectorStore.add([
      createEntry('note.md', 'hash-a'),
      {
        ...createEntry('note.md', 'hash-b'),
        id: 'note.md::1',
        metadata: {
          ...createEntry('note.md', 'hash-b').metadata,
          text: 'second chunk',
        },
      },
    ]);
    const graphStore = new InMemoryKnowledgeGraphStore();
    await graphStore.addEvidence({
      id: 'ev-1',
      filePath: 'note.md',
      entryId: 'note.md::0',
      startLine: 1,
      quote: 'text',
      contentHash: 'hash-a',
      extractionModelKey: 'openai:gpt-4.1-mini',
      updatedAt: 1000,
    });
    await graphStore.markExtractionCached({
      entryId: 'note.md::0',
      contentHash: 'hash-a',
      extractionModelKey: 'openai:gpt-4.1-mini',
      ontologySchemaId: 'default',
      ontologyVersion: CURRENT_ONTOLOGY_VERSION,
      updatedAt: 1000,
    });

    const status = await calculateGraphRagStatus({
      ragConfig: baseRagConfig,
      graphStore,
      vectorStore,
      isRunning: false,
      schemaErrors: [],
    });

    expect(status.state).toBe('stale');
    expect(status.staleFilePaths).toEqual(['note.md']);
  });
});

class StatusLookupVectorStore extends MemoryVectorStore {
  getEntriesCalls = 0;
  requestedIds: string[][] = [];

  override getEntries(): Promise<never> {
    this.getEntriesCalls++;
    return Promise.reject(new Error('전체 벡터 조회는 사용하지 않아야 합니다.'));
  }

  override async getEntriesByIds(ids: readonly string[]) {
    this.requestedIds.push([...ids].sort());
    return super.getEntriesByIds(ids);
  }
}
