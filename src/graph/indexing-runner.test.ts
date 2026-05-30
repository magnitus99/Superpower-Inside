import { describe, expect, it } from 'vitest';
import type { ChatMessage, LLMProvider, StreamChunk, ToolDefinition } from '../llm/providers';
import type { EmbeddingProvider } from '../llm/embedding';
import { DEFAULT_ONTOLOGY_SCHEMA } from '../ontology/schema';
import { MemoryVectorStore, type VectorEntry } from '../rag/store';
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
    ontologySchema: DEFAULT_ONTOLOGY_SCHEMA,
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
      ontologyVersion: 1,
      updatedAt: 1000,
    });
    const provider = new FakeProvider();
    const runner = new GraphRagIndexingRunner(makeRunnerOptions({
      vectorStore,
      graphStore,
      provider,
      maxFilesPerRun: 2,
    }));

    const result = await runner.run();

    expect(result.totalCandidateFiles).toBe(3);
    expect(result.selectedFiles).toBe(2);
    expect(result.skippedFiles).toBe(1);
    expect(result.processedFiles).toBe(1);
    expect(provider.calls).toBe(1);
  });

  it('chunk 실패는 rejected fact로 기록하고 다음 파일을 계속 처리한다', async () => {
    const vectorStore = new MemoryVectorStore();
    await vectorStore.add([
      createEntry('bad.md', 'hash-bad'),
      createEntry('ok.md', 'hash-ok'),
    ]);
    const provider = new FakeProvider([
      throwResponse(),
      textResponse(graphPayload()),
      textResponse(graphPayload()),
    ]);
    const runner = new GraphRagIndexingRunner(makeRunnerOptions({
      vectorStore,
      graphStore: new InMemoryKnowledgeGraphStore(),
      provider,
    }));

    await runner.run();
    const resumed = await runner.resumeFailed();

    expect(resumed.selectedFiles).toBe(1);
    expect(resumed.failedFiles).toBe(0);
    expect(resumed.processedFiles).toBe(1);
    expect(runner.getFailedFileCount()).toBe(0);
  });

  it('AbortSignal이 중단되면 partial 결과를 반환한다', async () => {
    const vectorStore = new MemoryVectorStore();
    await vectorStore.add([
      createEntry('a.md', 'hash-a'),
      createEntry('b.md', 'hash-b'),
    ]);
    const controller = new AbortController();
    const provider = new FakeProvider();
    provider.onCall = () => controller.abort();
    const runner = new GraphRagIndexingRunner(makeRunnerOptions({
      vectorStore,
      graphStore: new InMemoryKnowledgeGraphStore(),
      provider,
    }));

    const result = await runner.run({ signal: controller.signal });

    expect(result.cancelled).toBe(true);
    expect(result.processedFiles).toBe(1);
    expect(result.selectedFiles).toBe(2);
  });
});

class FakeProvider implements LLMProvider {
  calls = 0;
  onCall?: () => void;
  private responses: ProviderResponse[];

  constructor(responses: ProviderResponse[] = [textResponse(graphPayload())]) {
    this.responses = responses;
  }

  chat(_messages: ChatMessage[], _temperature?: number, _tools?: ToolDefinition[]): Promise<string> {
    this.calls += 1;
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

function createEntry(filePath: string, contentHash: string): VectorEntry {
  return {
    id: `${filePath}::0`,
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

function graphPayload(): string {
  return JSON.stringify({
    entities: [
      {
        name: 'Paul',
        typeId: 'person',
        description: 'apostle',
        confidence: 0.9,
      },
    ],
    relations: [],
    claims: [
      {
        text: 'Paul is mentioned.',
        claimTypeId: 'factual_claim',
        entityNames: ['Paul'],
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
    const runner = new GraphRagIndexingRunner(makeRunnerOptions({
      vectorStore,
      graphStore,
      provider,
    }));

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
    const runner = new GraphRagIndexingRunner(makeRunnerOptions({
      vectorStore,
      graphStore,
      provider,
    }));

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
    const runner = new GraphRagIndexingRunner(makeRunnerOptions({
      vectorStore,
      graphStore,
      provider,
    }));

    await expect(
      runner.run({
        onlyFailedFiles: true,
        onlyStaleFiles: true,
        staleFilePaths: ['a.md'],
      }),
    ).rejects.toThrow('onlyFailedFiles and onlyStaleFiles cannot be true at the same time.');
  });
});