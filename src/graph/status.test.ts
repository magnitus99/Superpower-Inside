import { describe, expect, it } from 'vitest';
import type { RAGConfig } from '../settings';
import { MemoryVectorStore } from '../rag/store';
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
      ontologyVersion: 1,
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
      ontologyVersion: 1,
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
      ontologyVersion: 1,
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
    await graphStore.markExtractionCached({ entryId: 'e1', contentHash: 'new', extractionModelKey: 'openai:gpt-4.1-mini', ontologySchemaId: 'default', ontologyVersion: 1, updatedAt: Date.now() });

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
    await graphStore.markExtractionCached({ entryId: 'e1', contentHash: 'same', extractionModelKey: 'old-model', ontologySchemaId: 'default', ontologyVersion: 1, updatedAt: Date.now() });

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
});