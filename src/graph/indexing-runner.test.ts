import { describe, expect, it } from 'vitest';
import type {
  ChatMessage,
  LLMProvider,
  StreamChatOptions,
  StreamChunk,
  ToolDefinition,
} from '../llm/providers';
import { resolveProviderCapability } from '../llm/provider-capabilities';
import type { EmbeddingProvider } from '../llm/embedding';
import { buildDefaultOntologySchema } from '../ontology/schema';
import { MemoryVectorStore, type VectorEntry } from '../rag/store';
import type { GraphRagIndexingProgress } from './indexing-runner';

const TEST_PROVIDER_CAPABILITY = resolveProviderCapability({
  providerKey: 'openai',
  model: 'test-model',
});
const CURRENT_ONTOLOGY_VERSION = buildDefaultOntologySchema().version;
import { GraphRagIndexingRunner } from './indexing-runner';
import { InMemoryKnowledgeGraphStore } from './store';

class FakeEmbeddingProvider implements EmbeddingProvider {
  embed(): Promise<number[]> {
    return Promise.resolve([0.1, 0.2, 0.3]);
  }

  embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.resolve(texts.map(() => [0.1, 0.2, 0.3]));
  }
}

function makeRunnerOptions(overrides: {
  vectorStore: MemoryVectorStore;
  graphStore: InMemoryKnowledgeGraphStore;
  provider: FakeProvider;
  maxFilesPerRun?: number;
}): ConstructorParameters<typeof GraphRagIndexingRunner>[0] {
  return {
    vectorStore: overrides.vectorStore,
    graphStore: overrides.graphStore,
    provider: overrides.provider,
    embeddingProvider: new FakeEmbeddingProvider(),
    ontologySchema: buildDefaultOntologySchema(),
    extractionModelKey: 'openai:gpt-4.1-mini',
    maxFilesPerRun: overrides.maxFilesPerRun ?? 10,
  };
}

describe('GraphRagIndexingRunner', () => {
  it('maxFilesPerRun까지만 처리하고 cached 파일은 skip한다', async () => {
    const vectorStore = new MemoryVectorStore();
    await vectorStore.add([
      createEntry('a.md', 'hash-a'),
      createEntry('b.md', 'hash-b'),
      createEntry('c.md', 'hash-c'),
    ]);
    const graphStore = new InMemoryKnowledgeGraphStore();
    await graphStore.markExtractionCached({
      entryId: 'a.md::0',
      contentHash: 'hash-a',
      extractionModelKey: 'openai:gpt-4.1-mini',
      ontologySchemaId: 'default',
      ontologyVersion: CURRENT_ONTOLOGY_VERSION,
      updatedAt: 1000,
    });
    const provider = new FakeProvider();
    const runner = new GraphRagIndexingRunner(
      makeRunnerOptions({
        vectorStore,
        graphStore,
        provider,
        maxFilesPerRun: 2,
      }),
    );

    const result = await runner.run();

    expect(result.totalCandidateFiles).toBe(3);
    expect(result.selectedFiles).toBe(2);
    expect(result.skippedFiles).toBe(1);
    expect(result.processedFiles).toBe(1);
    expect(provider.calls).toBe(1);
  });

  it('GraphRAG 추출 후보에서 Markdown이 아닌 vector entry는 제외한다', async () => {
    const vectorStore = new MemoryVectorStore();
    await vectorStore.add([
      createEntry('Base.base', 'hash-base'),
      createEntry('note.md', 'hash-note'),
    ]);
    const graphStore = new InMemoryKnowledgeGraphStore();
    const provider = new FakeProvider();
    const runner = new GraphRagIndexingRunner(
      makeRunnerOptions({
        vectorStore,
        graphStore,
        provider,
      }),
    );

    const result = await runner.run();

    expect(result.totalCandidateFiles).toBe(1);
    expect(result.processedFiles).toBe(1);
    expect(provider.calls).toBe(1);
    expect((await graphStore.getEvidence()).map((evidence) => evidence.filePath)).toEqual([
      'note.md',
    ]);
  });

  it('현재 vault에 없는 Markdown vector entry는 GraphRAG 추출에서 제외한다', async () => {
    const vectorStore = new MemoryVectorStore();
    await vectorStore.add([
      createEntry('current.md', 'hash-current'),
      createEntry('foreign.md', 'hash-foreign'),
    ]);
    const graphStore = new InMemoryKnowledgeGraphStore();
    const provider = new FakeProvider();
    const options = {
      ...makeRunnerOptions({
        vectorStore,
        graphStore,
        provider,
      }),
      isProcessableFilePath: (filePath: string) => filePath === 'current.md',
    };
    const runner = new GraphRagIndexingRunner(options);

    const result = await runner.run();

    expect(result.totalCandidateFiles).toBe(1);
    expect(result.processedFiles).toBe(1);
    expect(provider.calls).toBe(1);
    expect((await graphStore.getEvidence()).map((evidence) => evidence.filePath)).toEqual([
      'current.md',
    ]);
  });

  it('기존 non-Markdown GraphRAG rejected fact는 다음 실행에서 정리한다', async () => {
    const vectorStore = new MemoryVectorStore();
    await vectorStore.add([createEntry('note.md', 'hash-note')]);
    const graphStore = new InMemoryKnowledgeGraphStore();
    await graphStore.addRejectedFact({
      id: 'reject-base',
      filePath: 'Base.base',
      entryId: 'Base.base::0::0',
      reason: 'invalid-json',
      rawFact: 'old',
      updatedAt: 1000,
    });
    const provider = new FakeProvider();
    const runner = new GraphRagIndexingRunner(
      makeRunnerOptions({
        vectorStore,
        graphStore,
        provider,
      }),
    );

    await runner.run();

    expect(await graphStore.getRejectedFacts()).toEqual([]);
  });

  it('chunk 실패는 rejected fact로 기록하고 다음 파일을 계속 처리한다', async () => {
    const vectorStore = new MemoryVectorStore();
    await vectorStore.add([createEntry('bad.md', 'hash-bad'), createEntry('ok.md', 'hash-ok')]);
    const provider = new FakeProvider([
      throwResponse(),
      textResponse(graphPayload()),
      textResponse(graphPayload()),
    ]);
    const runner = new GraphRagIndexingRunner(
      makeRunnerOptions({
        vectorStore,
        graphStore: new InMemoryKnowledgeGraphStore(),
        provider,
      }),
    );

    await runner.run();
    const resumed = await runner.resumeFailed();

    expect(resumed.selectedFiles).toBe(1);
    expect(resumed.failedFiles).toBe(0);
    expect(resumed.processedFiles).toBe(1);
    expect(runner.getFailedFileCount()).toBe(0);
  });

  it('persisted rejected fact만 있어도 실패 파일 재시도 대상으로 선택한다', async () => {
    const vectorStore = new MemoryVectorStore();
    await vectorStore.add([createEntry('rejected.md', 'hash-rejected')]);
    const graphStore = new InMemoryKnowledgeGraphStore();
    await graphStore.addRejectedFact({
      id: 'reject-persisted',
      filePath: 'rejected.md',
      entryId: 'rejected.md::0',
      reason: 'relation-domain-range-mismatch',
      rawFact: { relationTypeId: 'interprets' },
      updatedAt: 1000,
    });
    const provider = new FakeProvider([textResponse(graphPayload('Recovered Paul'))]);
    const runner = new GraphRagIndexingRunner(
      makeRunnerOptions({
        vectorStore,
        graphStore,
        provider,
      }),
    );

    const result = await runner.resumeFailed();

    expect(result.totalCandidateFiles).toBe(1);
    expect(result.selectedFiles).toBe(1);
    expect(result.processedFiles).toBe(1);
    expect(provider.calls).toBe(1);
    expect(await graphStore.getRejectedFacts()).toEqual([]);
    expect((await graphStore.getEntities()).map((entity) => entity.canonicalName)).toEqual([
      'Recovered Paul',
    ]);
  });

  it('실패 파일 재시도는 cache hit이어도 기존 rejected fact를 지우고 다시 추출한다', async () => {
    const vectorStore = new MemoryVectorStore();
    await vectorStore.add([createEntry('cached-rejected.md', 'hash-same')]);
    const graphStore = new InMemoryKnowledgeGraphStore();
    await graphStore.addEvidence({
      id: 'ev-cached-rejected',
      filePath: 'cached-rejected.md',
      entryId: 'cached-rejected.md::0',
      startLine: 1,
      endLine: 2,
      quote: 'cached text',
      contentHash: 'hash-same',
      extractionModelKey: 'openai:gpt-4.1-mini',
      updatedAt: 1000,
    });
    await graphStore.markExtractionCached({
      entryId: 'cached-rejected.md::0',
      contentHash: 'hash-same',
      extractionModelKey: 'openai:gpt-4.1-mini',
      ontologySchemaId: 'default',
      ontologyVersion: CURRENT_ONTOLOGY_VERSION,
      updatedAt: 1000,
    });
    await graphStore.addRejectedFact({
      id: 'reject-cached',
      filePath: 'cached-rejected.md',
      entryId: 'cached-rejected.md::0',
      reason: 'relation-domain-range-mismatch',
      rawFact: { relationTypeId: 'opposes' },
      updatedAt: 1000,
    });
    const provider = new FakeProvider([textResponse(graphPayload('Fresh Recovered Paul'))]);
    const runner = new GraphRagIndexingRunner(
      makeRunnerOptions({
        vectorStore,
        graphStore,
        provider,
      }),
    );

    const result = await runner.run({
      onlyFailedFiles: true,
      failedFilePaths: ['cached-rejected.md'],
    });

    expect(result.skippedFiles).toBe(0);
    expect(result.processedChunks).toBe(1);
    expect(provider.calls).toBe(1);
    expect(await graphStore.getRejectedFacts()).toEqual([]);
    expect((await graphStore.getEntities()).map((entity) => entity.canonicalName)).toEqual([
      'Fresh Recovered Paul',
    ]);
  });

  it('명시한 실패 파일 경로가 있으면 다른 persisted rejected fact는 같은 실행에 섞지 않는다', async () => {
    const vectorStore = new MemoryVectorStore();
    await vectorStore.add([
      createEntry('clicked.md', 'hash-clicked'),
      createEntry('other.md', 'hash-other'),
    ]);
    const graphStore = new InMemoryKnowledgeGraphStore();
    await graphStore.addRejectedFact({
      id: 'reject-clicked',
      filePath: 'clicked.md',
      entryId: 'clicked.md::0',
      reason: 'relation-domain-range-mismatch',
      rawFact: {},
      updatedAt: 1000,
    });
    await graphStore.addRejectedFact({
      id: 'reject-other',
      filePath: 'other.md',
      entryId: 'other.md::0',
      reason: 'relation-domain-range-mismatch',
      rawFact: {},
      updatedAt: 1000,
    });
    const provider = new FakeProvider([textResponse(graphPayload('Clicked Paul'))]);
    const runner = new GraphRagIndexingRunner(
      makeRunnerOptions({
        vectorStore,
        graphStore,
        provider,
      }),
    );

    const result = await runner.run({
      onlyFailedFiles: true,
      failedFilePaths: ['clicked.md'],
    });

    expect(result.totalCandidateFiles).toBe(1);
    expect(result.selectedFiles).toBe(1);
    expect(provider.calls).toBe(1);
    expect((await graphStore.getRejectedFacts()).map((fact) => fact.filePath)).toEqual([
      'other.md',
    ]);
  });

  it('AbortSignal이 중단되면 partial 결과를 반환한다', async () => {
    const vectorStore = new MemoryVectorStore();
    await vectorStore.add([createEntry('a.md', 'hash-a'), createEntry('b.md', 'hash-b')]);
    const controller = new AbortController();
    const provider = new FakeProvider();
    provider.onCall = () => controller.abort();
    const runner = new GraphRagIndexingRunner(
      makeRunnerOptions({
        vectorStore,
        graphStore: new InMemoryKnowledgeGraphStore(),
        provider,
      }),
    );

    const result = await runner.run({ signal: controller.signal });

    expect(result.cancelled).toBe(true);
    expect(result.processedFiles).toBe(0);
    expect(result.selectedFiles).toBe(2);
  });

  it('GraphRAG 추출 요청에 runner AbortSignal을 전달한다', async () => {
    const vectorStore = new MemoryVectorStore();
    await vectorStore.add([createEntry('a.md', 'hash-a')]);
    const controller = new AbortController();
    const provider = new FakeProvider();
    const runner = new GraphRagIndexingRunner(
      makeRunnerOptions({
        vectorStore,
        graphStore: new InMemoryKnowledgeGraphStore(),
        provider,
      }),
    );

    await runner.run({ signal: controller.signal });

    expect(provider.chatSignals).toEqual([controller.signal]);
  });

  it('resetState는 run 식별자와 진행 상태를 초기화한다', async () => {
    const vectorStore = new MemoryVectorStore();
    await vectorStore.add([createEntry('a.md', 'hash-a'), createEntry('b.md', 'hash-b')]);
    const provider = new FakeProvider();
    const graphStore = new InMemoryKnowledgeGraphStore();
    const runner = new GraphRagIndexingRunner(
      makeRunnerOptions({
        vectorStore,
        graphStore,
        provider,
        maxFilesPerRun: 1,
      }),
    );

    const result = await runner.run();
    const progressBefore = runner.getProgress();

    expect(result.runId).toBe(1);
    expect(runner.getLastResult()).toEqual(result);
    expect(result.processedChunks).toBe(1);
    expect(result.startedAt).toBeLessThanOrEqual(result.finishedAt);
    expect(progressBefore.runId).toBe(1);
    expect(runner.getLastRunId()).toBe(1);

    runner.resetState();

    expect(runner.getLastResult()).toBeNull();
    expect(runner.getLastCommunityResult()).toBeNull();
    expect(runner.getFailedFileCount()).toBe(0);
    expect(runner.getLastRunId()).toBe(0);
    expect(runner.getProgress()).toEqual({
      currentFile: null,
      processedFiles: 0,
      skippedFiles: 0,
      failedFiles: 0,
      selectedFiles: 0,
      runId: 0,
      phase: 'idle',
      processedChunks: 0,
      skippedChunks: 0,
      failedChunks: 0,
      storedEvidence: 0,
      storedEntities: 0,
      storedRelations: 0,
      storedClaims: 0,
      storedRejectedFacts: 0,
      cachedChunks: 0,
    });
  });

  it('각 GraphRAG 실행은 고유 runId를 부여한다', async () => {
    const vectorStore = new MemoryVectorStore();
    await vectorStore.add([createEntry('a.md', 'hash-a'), createEntry('b.md', 'hash-b')]);
    const graphStore = new InMemoryKnowledgeGraphStore();
    const seenRunIds: number[] = [];
    const provider = new FakeProvider();
    const runner = new GraphRagIndexingRunner({
      ...makeRunnerOptions({ vectorStore, graphStore, provider }),
      onProgress: (progress: GraphRagIndexingProgress) => {
        seenRunIds.push(progress.runId);
      },
    });

    const firstResult = await runner.run();
    const secondResult = await runner.run();

    expect(firstResult.runId).toBe(1);
    expect(runner.getLastRunId()).toBe(secondResult.runId);
    expect(secondResult.runId).toBe(2);
    expect(new Set(seenRunIds)).toEqual(new Set([firstResult.runId, secondResult.runId]));
  });

  it('GraphRAG progress는 API 호출과 응답 정리 단계를 phase로 알린다', async () => {
    const vectorStore = new MemoryVectorStore();
    await vectorStore.add([createEntry('a.md', 'hash-a')]);
    const graphStore = new InMemoryKnowledgeGraphStore();
    const phases: string[] = [];
    const provider = new FakeProvider();
    const runner = new GraphRagIndexingRunner({
      ...makeRunnerOptions({ vectorStore, graphStore, provider }),
      onProgress: (progress: GraphRagIndexingProgress) => {
        phases.push(progress.phase);
      },
    });

    await runner.run();

    expect(phases).toEqual(
      expect.arrayContaining([
        'selecting-files',
        'checking-cache',
        'api-waiting',
        'api-response-received',
        'api-response-normalizing',
        'storing-results',
        'file-completed',
        'building-communities',
        'completed',
      ]),
    );
    expect(phases.indexOf('api-waiting')).toBeLessThan(phases.indexOf('api-response-received'));
    expect(phases.indexOf('api-response-received')).toBeLessThan(
      phases.indexOf('api-response-normalizing'),
    );
    expect(runner.getProgress().phase).toBe('completed');
  });

  it('GraphRAG progress는 파일 완료 전에도 청크와 저장 카운터를 알린다', async () => {
    const vectorStore = new MemoryVectorStore();
    await vectorStore.add([
      createEntry('note.md', 'hash-a', 0),
      createEntry('note.md', 'hash-b', 1),
    ]);
    const graphStore = new InMemoryKnowledgeGraphStore();
    const progressEvents: GraphRagIndexingProgress[] = [];
    const provider = new FakeProvider([textResponse(graphPayload('Paul')), throwResponse()]);
    const runner = new GraphRagIndexingRunner({
      ...makeRunnerOptions({ vectorStore, graphStore, provider }),
      onProgress: (progress: GraphRagIndexingProgress) => {
        progressEvents.push(progress);
      },
    });

    await runner.run();

    expect(runner.getProgress()).toEqual(
      expect.objectContaining({
        processedChunks: 1,
        failedChunks: 1,
        storedEvidence: 2,
        storedEntities: 1,
        storedClaims: 1,
        storedRejectedFacts: 1,
        cachedChunks: 1,
      }),
    );
    expect(
      progressEvents.some(
        (progress) =>
          progress.currentFile === 'note.md' &&
          progress.processedFiles === 0 &&
          progress.processedChunks + progress.failedChunks === 2,
      ),
    ).toBe(true);
  });

  it('취소된 indexing은 community rebuild를 실행하지 않는다', async () => {
    const vectorStore = new MemoryVectorStore();
    await vectorStore.add([createEntry('a.md', 'hash-a'), createEntry('b.md', 'hash-b')]);
    const graphStore = new InMemoryKnowledgeGraphStore();
    await graphStore.addCommunity({
      id: 'community::default::old',
      ontologySchemaId: 'default',
      title: 'Old',
      entityIds: ['entity-old'],
      relationIds: [],
      claimIds: [],
      summary: 'old summary',
      summaryVector: [1, 0],
      level: 0,
      updatedAt: 1000,
    });
    const controller = new AbortController();
    const provider = new FakeProvider();
    provider.onCall = () => controller.abort();
    const runner = new GraphRagIndexingRunner(
      makeRunnerOptions({
        vectorStore,
        graphStore,
        provider,
      }),
    );

    const result = await runner.run({ signal: controller.signal });

    expect(result.cancelled).toBe(true);
    expect(await graphStore.getCommunities()).toEqual([
      expect.objectContaining({ id: 'community::default::old' }),
    ]);
  });

  it('stale 파일 재추출 전에 기존 graph fact를 pruning한다', async () => {
    const vectorStore = new MemoryVectorStore();
    await vectorStore.add([createEntry('note.md', 'hash-new')]);
    const graphStore = new InMemoryKnowledgeGraphStore();
    await graphStore.addEvidence({
      id: 'ev-old',
      filePath: 'note.md',
      entryId: 'note.md::0',
      startLine: 1,
      endLine: 2,
      quote: 'old text',
      contentHash: 'hash-old',
      extractionModelKey: 'openai:gpt-4.1-mini',
      updatedAt: 1000,
    });
    await graphStore.upsertEntity({
      id: 'entity::default::person::old-paul',
      ontologySchemaId: 'default',
      ontologyVersion: 1,
      typeId: 'person',
      canonicalName: 'Old Paul',
      aliases: [],
      description: 'old',
      properties: {},
      confidence: 0.9,
      evidenceIds: ['ev-old'],
      createdAt: 1000,
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
    const provider = new FakeProvider([textResponse(graphPayload('Fresh Paul'))]);
    const runner = new GraphRagIndexingRunner(
      makeRunnerOptions({
        vectorStore,
        graphStore,
        provider,
      }),
    );

    const result = await runner.run({ onlyStaleFiles: true, staleFilePaths: ['note.md'] });

    expect(result.processedFiles).toBe(1);
    expect((await graphStore.getEntities()).map((entity) => entity.canonicalName)).toEqual([
      'Fresh Paul',
    ]);
    expect((await graphStore.getEvidence()).map((evidence) => evidence.contentHash)).toEqual([
      'hash-new',
    ]);
  });

  it('모든 chunk가 cache hit이면 기존 graph fact를 pruning하지 않는다', async () => {
    const vectorStore = new MemoryVectorStore();
    await vectorStore.add([createEntry('note.md', 'hash-same')]);
    const graphStore = new InMemoryKnowledgeGraphStore();
    await graphStore.addEvidence({
      id: 'ev-existing',
      filePath: 'note.md',
      entryId: 'note.md::0',
      startLine: 1,
      endLine: 2,
      quote: 'cached text',
      contentHash: 'hash-same',
      extractionModelKey: 'openai:gpt-4.1-mini',
      updatedAt: 1000,
    });
    await graphStore.upsertEntity({
      id: 'entity::default::person::cached-paul',
      ontologySchemaId: 'default',
      ontologyVersion: 1,
      typeId: 'person',
      canonicalName: 'Cached Paul',
      aliases: [],
      description: 'cached',
      properties: {},
      confidence: 0.9,
      evidenceIds: ['ev-existing'],
      createdAt: 1000,
      updatedAt: 1000,
    });
    await graphStore.markExtractionCached({
      entryId: 'note.md::0',
      contentHash: 'hash-same',
      extractionModelKey: 'openai:gpt-4.1-mini',
      ontologySchemaId: 'default',
      ontologyVersion: CURRENT_ONTOLOGY_VERSION,
      updatedAt: 1000,
    });
    const provider = new FakeProvider();
    const runner = new GraphRagIndexingRunner(
      makeRunnerOptions({
        vectorStore,
        graphStore,
        provider,
      }),
    );

    const result = await runner.run({ onlyStaleFiles: true, staleFilePaths: ['note.md'] });

    expect(result.skippedFiles).toBe(1);
    expect(provider.calls).toBe(0);
    expect((await graphStore.getEntities()).map((entity) => entity.canonicalName)).toEqual([
      'Cached Paul',
    ]);
  });

  it('일부 chunk만 cache miss여도 파일의 현재 chunk 전체를 재추출한다', async () => {
    const vectorStore = new MemoryVectorStore();
    await vectorStore.add([
      createEntry('note.md', 'hash-a', 0),
      createEntry('note.md', 'hash-b', 1),
    ]);
    const graphStore = new InMemoryKnowledgeGraphStore();
    await graphStore.addEvidence({
      id: 'ev-cached',
      filePath: 'note.md',
      entryId: 'note.md::0',
      startLine: 1,
      endLine: 2,
      quote: 'cached text',
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
    const provider = new FakeProvider([
      textResponse(graphPayload('Fresh Cached Chunk')),
      textResponse(graphPayload('Fresh Miss Chunk')),
    ]);
    const runner = new GraphRagIndexingRunner(
      makeRunnerOptions({
        vectorStore,
        graphStore,
        provider,
      }),
    );

    const result = await runner.run({ onlyStaleFiles: true, staleFilePaths: ['note.md'] });

    expect(result.processedChunks).toBe(2);
    expect(result.skippedChunks).toBe(0);
    expect(provider.calls).toBe(2);
    expect((await graphStore.getEntities()).map((entity) => entity.canonicalName)).toEqual([
      'Fresh Cached Chunk',
      'Fresh Miss Chunk',
    ]);
  });

  it('stale path에 vector entry가 없으면 추출 없이 orphan graph fact만 pruning한다', async () => {
    const graphStore = new InMemoryKnowledgeGraphStore();
    await graphStore.addEvidence({
      id: 'ev-deleted',
      filePath: 'deleted.md',
      entryId: 'deleted.md::0',
      startLine: 1,
      endLine: 2,
      quote: 'deleted text',
      contentHash: 'hash-deleted',
      extractionModelKey: 'openai:gpt-4.1-mini',
      updatedAt: 1000,
    });
    await graphStore.upsertEntity({
      id: 'entity::default::person::deleted-paul',
      ontologySchemaId: 'default',
      ontologyVersion: 1,
      typeId: 'person',
      canonicalName: 'Deleted Paul',
      aliases: [],
      description: 'deleted',
      properties: {},
      confidence: 0.9,
      evidenceIds: ['ev-deleted'],
      createdAt: 1000,
      updatedAt: 1000,
    });
    await graphStore.markExtractionCached({
      entryId: 'deleted.md::0',
      contentHash: 'hash-deleted',
      extractionModelKey: 'openai:gpt-4.1-mini',
      ontologySchemaId: 'default',
      ontologyVersion: CURRENT_ONTOLOGY_VERSION,
      updatedAt: 1000,
    });
    const provider = new FakeProvider();
    const runner = new GraphRagIndexingRunner(
      makeRunnerOptions({
        vectorStore: new MemoryVectorStore(),
        graphStore,
        provider,
      }),
    );

    const result = await runner.run({ onlyStaleFiles: true, staleFilePaths: ['deleted.md'] });

    expect(result.skippedFiles).toBe(1);
    expect(provider.calls).toBe(0);
    expect(await graphStore.getEvidence()).toEqual([]);
    expect(await graphStore.getEntities()).toEqual([]);
    await expect(
      graphStore.isExtractionCached({
        entryId: 'deleted.md::0',
        contentHash: 'hash-deleted',
        extractionModelKey: 'openai:gpt-4.1-mini',
        ontologySchemaId: 'default',
        ontologyVersion: CURRENT_ONTOLOGY_VERSION,
      }),
    ).resolves.toBe(false);
  });

  it('community rebuild 결과가 0개이면 기존 community를 비운다', async () => {
    const graphStore = new InMemoryKnowledgeGraphStore();
    await graphStore.addCommunity({
      id: 'community::default::old',
      ontologySchemaId: 'default',
      title: 'Old',
      entityIds: ['entity-old'],
      relationIds: [],
      claimIds: [],
      summary: 'old summary',
      summaryVector: [1, 0],
      level: 0,
      updatedAt: 1000,
    });
    const runner = new GraphRagIndexingRunner(
      makeRunnerOptions({
        vectorStore: new MemoryVectorStore(),
        graphStore,
        provider: new FakeProvider(),
      }),
    );

    const result = await runner.buildCommunities();

    expect(result.communityCount).toBe(0);
    expect(await graphStore.getCommunities()).toEqual([]);
  });
});

class FakeProvider implements LLMProvider {
  readonly capability = TEST_PROVIDER_CAPABILITY;
  calls = 0;
  chatSignals: Array<AbortSignal | undefined> = [];
  onCall?: () => void;
  private responses: ProviderResponse[];

  constructor(responses: ProviderResponse[] = [textResponse(graphPayload())]) {
    this.responses = responses;
  }

  chat(
    _messages: ChatMessage[],
    _temperature?: number,
    _tools?: ToolDefinition[],
    options?: StreamChatOptions,
  ): Promise<string> {
    this.calls += 1;
    this.chatSignals.push(options?.signal);
    this.onCall?.();
    const response = this.responses.shift() ?? textResponse(graphPayload());
    if (response.kind === 'throw') {
      return Promise.reject(new Error('provider failed'));
    }
    return Promise.resolve(response.text);
  }

  streamChat(
    _messages: ChatMessage[],
    onChunk: (chunk: StreamChunk) => void,
    _temperature?: number,
    _tools?: ToolDefinition[],
  ): Promise<void> {
    onChunk({ content: '', done: true });
    return Promise.resolve();
  }
}

type ProviderResponse = { kind: 'text'; text: string } | { kind: 'throw' };

function textResponse(text: string): ProviderResponse {
  return { kind: 'text', text };
}

function throwResponse(): ProviderResponse {
  return { kind: 'throw' };
}

function createEntry(filePath: string, contentHash: string, index = 0): VectorEntry {
  return {
    id: `${filePath}::${index}`,
    vector: [1, 0],
    metadata: {
      filePath,
      startLine: 1,
      endLine: 2,
      text: `${filePath} text`,
      contentHash,
      sourceMtime: 1000,
      sourceSize: 10,
      indexedAt: 1000,
      embeddingProvider: 'openai',
      embeddingModel: 'text-embedding-3-small',
    },
  };
}

function graphPayload(entityName = 'Paul'): string {
  return JSON.stringify({
    entities: [
      {
        name: entityName,
        typeId: 'person',
        description: 'apostle',
        confidence: 0.9,
      },
    ],
    relations: [],
    claims: [
      {
        text: `${entityName} is mentioned.`,
        claimTypeId: 'factual_claim',
        entityNames: [entityName],
        confidence: 0.8,
      },
    ],
  });
}

describe('GraphRagIndexingRunner stale-only', () => {
  it('onlyStaleFiles=true이면 staleFilePaths만 candidate로 선택한다', async () => {
    const vectorStore = new MemoryVectorStore();
    await vectorStore.add([
      createEntry('a.md', 'hash-a'),
      createEntry('b.md', 'hash-b'),
      createEntry('c.md', 'hash-c'),
    ]);
    const graphStore = new InMemoryKnowledgeGraphStore();
    const provider = new FakeProvider();
    const runner = new GraphRagIndexingRunner(
      makeRunnerOptions({
        vectorStore,
        graphStore,
        provider,
      }),
    );

    const result = await runner.run({
      onlyStaleFiles: true,
      staleFilePaths: ['a.md', 'c.md'],
    });

    expect(result.totalCandidateFiles).toBe(2);
    expect(result.selectedFiles).toBe(2);
    expect(result.processedFiles).toBe(2);
  });

  it('onlyStaleFiles=true이고 staleFilePaths가 비어있으면 아무것도 처리하지 않는다', async () => {
    const vectorStore = new MemoryVectorStore();
    await vectorStore.add([createEntry('a.md', 'hash-a')]);
    const graphStore = new InMemoryKnowledgeGraphStore();
    const provider = new FakeProvider();
    const runner = new GraphRagIndexingRunner(
      makeRunnerOptions({
        vectorStore,
        graphStore,
        provider,
      }),
    );

    const result = await runner.run({
      onlyStaleFiles: true,
      staleFilePaths: [],
    });

    expect(result.totalCandidateFiles).toBe(0);
    expect(result.selectedFiles).toBe(0);
    expect(result.processedFiles).toBe(0);
  });

  it('onlyFailedFiles와 onlyStaleFiles를 동시에 true로 하면 Error를 throw한다', async () => {
    const vectorStore = new MemoryVectorStore();
    await vectorStore.add([createEntry('a.md', 'hash-a')]);
    const graphStore = new InMemoryKnowledgeGraphStore();
    const provider = new FakeProvider();
    const runner = new GraphRagIndexingRunner(
      makeRunnerOptions({
        vectorStore,
        graphStore,
        provider,
      }),
    );

    await expect(
      runner.run({
        onlyFailedFiles: true,
        onlyStaleFiles: true,
        staleFilePaths: ['a.md'],
      }),
    ).rejects.toThrow('onlyFailedFiles and onlyStaleFiles cannot be true at the same time.');
  });
});
