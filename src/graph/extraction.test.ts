import { describe, expect, it } from 'vitest';
import type { LLMProvider } from '../llm/providers';
import type { EmbeddingProvider } from '../llm/embedding';
import { DEFAULT_ONTOLOGY_SCHEMA } from '../ontology/schema';
import { GraphExtractionIndexer } from './extraction';
import { InMemoryKnowledgeGraphStore } from './store';

describe('GraphExtractionIndexer', () => {
  it('ontology에 맞는 LLM 추출 결과를 entity, relation, claim, evidence로 저장한다', async () => {
    const store = new InMemoryKnowledgeGraphStore();
    const indexer = new GraphExtractionIndexer({
      provider: createProvider(
        JSON.stringify({
          entities: [
            {
              name: 'Paul',
              typeId: 'person',
              description: 'Apostle and author',
              aliases: ['Saul'],
              confidence: 0.9,
            },
            {
              name: 'Romans',
              typeId: 'work',
              description: 'A New Testament letter',
              aliases: [],
              confidence: 0.86,
            },
          ],
          relations: [
            {
              source: 'Paul',
              target: 'Romans',
              relationTypeId: 'authored',
              description: 'Paul authored Romans',
              confidence: 0.82,
            },
          ],
          claims: [
            {
              text: 'Paul authored Romans.',
              claimTypeId: 'factual_claim',
              entityNames: ['Paul', 'Romans'],
              stance: 'neutral',
              confidence: 0.8,
            },
          ],
        }),
      ),
      store,
    });

    await indexer.extractChunk({
      chunkText: 'Paul authored Romans.',
      filePath: 'Romans.md',
      entryId: 'Romans.md::1::0',
      startLine: 1,
      endLine: 1,
      contentHash: 'hash-1',
      extractionModelKey: 'openai:gpt-4o-mini',
      ontologySchema: DEFAULT_ONTOLOGY_SCHEMA,
    });

    expect(await store.getEvidence()).toEqual([
      expect.objectContaining({
        filePath: 'Romans.md',
        entryId: 'Romans.md::1::0',
        quote: 'Paul authored Romans.',
      }),
    ]);
    expect((await store.getEntities()).map((entity) => entity.canonicalName)).toEqual([
      'Paul',
      'Romans',
    ]);
    expect(await store.getRelations()).toEqual([
      expect.objectContaining({
        relationTypeId: 'authored',
        description: 'Paul authored Romans',
      }),
    ]);
    expect(await store.getClaims()).toEqual([
      expect.objectContaining({
        text: 'Paul authored Romans.',
        stance: 'neutral',
      }),
    ]);
    expect(await store.getRejectedFacts()).toEqual([]);
  });

  it('ontology domain/range에 맞지 않는 relation은 rejected fact로 저장하고 relation으로 저장하지 않는다', async () => {
    const store = new InMemoryKnowledgeGraphStore();
    const indexer = new GraphExtractionIndexer({
      provider: createProvider(
        JSON.stringify({
          entities: [
            { name: 'Jerusalem', typeId: 'place', description: 'City', confidence: 0.8 },
            { name: 'Paul', typeId: 'person', description: 'Apostle', confidence: 0.8 },
          ],
          relations: [
            {
              source: 'Jerusalem',
              target: 'Paul',
              relationTypeId: 'authored',
              description: 'Invalid authored relation',
              confidence: 0.8,
            },
          ],
          claims: [],
        }),
      ),
      store,
    });

    await indexer.extractChunk(createInput('Jerusalem authored Paul.'));

    expect(await store.getRelations()).toEqual([]);
    expect(await store.getRejectedFacts()).toEqual([
      expect.objectContaining({
        reason: 'relation-domain-range-mismatch',
        filePath: 'note.md',
      }),
    ]);
  });

  it('JSON 파싱 실패는 rejected fact로 저장하고 다음 chunk 처리를 막지 않는다', async () => {
    const store = new InMemoryKnowledgeGraphStore();
    const indexer = new GraphExtractionIndexer({
      provider: createProviderSequence([
        'not-json',
        JSON.stringify({
          entities: [{ name: 'Paul', typeId: 'person', description: 'Apostle', confidence: 0.8 }],
          relations: [],
          claims: [],
        }),
      ]),
      store,
    });

    await indexer.extractChunk(createInput('broken chunk', 'note.md::1::0'));
    await indexer.extractChunk(createInput('Paul appears.', 'note.md::2::0'));

    expect(await store.getRejectedFacts()).toEqual([
      expect.objectContaining({ reason: 'invalid-json' }),
    ]);
    expect((await store.getEntities()).map((entity) => entity.canonicalName)).toEqual(['Paul']);
  });

  it('content hash, model, ontology version이 같으면 같은 chunk를 재추출하지 않는다', async () => {
    const provider = createProvider(
      JSON.stringify({
        entities: [{ name: 'Paul', typeId: 'person', description: 'Apostle', confidence: 0.8 }],
        relations: [],
        claims: [],
      }),
    );
    const store = new InMemoryKnowledgeGraphStore();
    const indexer = new GraphExtractionIndexer({ provider, store });

    await indexer.extractChunk(createInput('Paul appears.'));
    await indexer.extractChunk(createInput('Paul appears.'));

    expect(provider.calls).toBe(1);
    expect((await store.getEntities()).map((entity) => entity.canonicalName)).toEqual(['Paul']);
  });

  it('alias로 재등장한 entity는 resolver를 통해 기존 entity에 merge한다', async () => {
    const store = new InMemoryKnowledgeGraphStore();
    const indexer = new GraphExtractionIndexer({
      provider: createProviderSequence([
        JSON.stringify({
          entities: [
            { name: 'Paul', typeId: 'person', aliases: ['Saul'], description: 'Apostle', confidence: 0.9 },
          ],
          relations: [],
          claims: [],
        }),
        JSON.stringify({
          entities: [
            { name: 'Saul', typeId: 'person', aliases: [], description: 'Apostle', confidence: 0.8 },
          ],
          relations: [],
          claims: [],
        }),
      ]),
      store,
    });

    await indexer.extractChunk(createInput('Paul appears.', 'note.md::1::0'));
    await indexer.extractChunk({
      ...createInput('Saul appears.', 'note.md::2::0'),
      contentHash: 'hash-2',
    });

    const entities = await store.getEntities();
    expect(entities.map((entity) => entity.canonicalName)).toEqual(['Paul']);
    expect(entities[0]?.evidenceIds).toHaveLength(2);
  });

  it('추출 경로에서도 임베딩 유사도를 entity resolver에 전달한다', async () => {
    const store = new InMemoryKnowledgeGraphStore();
    const indexer = new GraphExtractionIndexer({
      provider: createProviderSequence([
        JSON.stringify({
          entities: [
            {
              name: 'Grace',
              typeId: 'concept',
              description: 'divine favor and mercy',
              confidence: 0.9,
            },
          ],
          relations: [],
          claims: [],
        }),
        JSON.stringify({
          entities: [
            {
              name: 'Divine Mercy',
              typeId: 'concept',
              description: 'divine favor and mercy',
              confidence: 0.8,
            },
          ],
          relations: [],
          claims: [],
        }),
      ]),
      store,
      entityResolverOptions: {
        autoMergeThreshold: 0.92,
        pendingMergeThreshold: 0.72,
        embeddingProvider: createEmbeddingProvider(),
      },
    });

    await indexer.extractChunk(createInput('Grace appears.', 'note.md::1::0'));
    await indexer.extractChunk({
      ...createInput('Divine Mercy appears.', 'note.md::2::0'),
      contentHash: 'hash-2',
    });

    expect(await store.getPendingEntityMerges()).toEqual([
      expect.objectContaining({
        existingEntityId: 'entity::default::concept::grace',
        candidateEntityId: 'entity::default::concept::divine-mercy',
      }),
    ]);
  });
});

function createInput(
  chunkText: string,
  entryId = 'note.md::1::0',
): Parameters<GraphExtractionIndexer['extractChunk']>[0] {
  return {
    chunkText,
    filePath: 'note.md',
    entryId,
    startLine: 1,
    endLine: 1,
    contentHash: 'hash-1',
    extractionModelKey: 'openai:gpt-4o-mini',
    ontologySchema: DEFAULT_ONTOLOGY_SCHEMA,
  };
}

function createProvider(response: string): LLMProvider & { calls: number } {
  return createProviderSequence([response]);
}

function createProviderSequence(responses: string[]): LLMProvider & { calls: number } {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    chat: () => {
      const response = responses[Math.min(calls, responses.length - 1)] ?? '';
      calls++;
      return Promise.resolve(response);
    },
    streamChat: () => Promise.resolve(),
  };
}

function createEmbeddingProvider(): EmbeddingProvider {
  return {
    embed: (text: string) => Promise.resolve(createEmbeddingVector(text)),
    embedBatch: (texts: string[]) => Promise.resolve(texts.map(createEmbeddingVector)),
  };
}

function createEmbeddingVector(text: string): number[] {
  return text.includes('Grace') || text.includes('Mercy') ? [1, 0] : [0, 1];
}
