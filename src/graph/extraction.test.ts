import { describe, expect, it } from 'vitest';
import type { LLMProvider } from '../llm/providers';
import type { EmbeddingProvider } from '../llm/embedding';
import { buildDefaultOntologySchema } from '../ontology/schema';
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
              source: 'Saul',
              target: 'Romans',
              relationTypeId: 'authored',
              description: 'Saul authored Romans',
              confidence: 0.82,
            },
          ],
          claims: [
            {
              text: 'Saul authored Romans.',
              claimTypeId: 'factual_claim',
              entityNames: ['Saul', 'Romans'],
              stance: 'neutral',
              confidence: 0.8,
            },
          ],
        }),
      ),
      store,
    });

    await indexer.extractChunk({
      chunkText: 'Saul authored Romans.',
      filePath: 'Romans.md',
      entryId: 'Romans.md::1::0',
      startLine: 1,
      endLine: 1,
      contentHash: 'hash-1',
      extractionModelKey: 'openai:gpt-4o-mini',
      ontologySchema: buildDefaultOntologySchema(),
    });

    expect(await store.getEvidence()).toEqual([
      expect.objectContaining({
        filePath: 'Romans.md',
        entryId: 'Romans.md::1::0',
        quote: 'Saul authored Romans.',
      }),
    ]);
    const entities = await store.getEntities();
    expect(entities.map((entity) => entity.canonicalName)).toEqual(['Paul', 'Romans']);
    expect(await store.getRelations()).toEqual([
      expect.objectContaining({
        relationTypeId: 'authored',
        sourceEntityId: entities[0]?.id,
        targetEntityId: entities[1]?.id,
        description: 'Saul authored Romans',
      }),
    ]);
    const claims = await store.getClaims();
    expect(claims).toEqual([
      expect.objectContaining({
        text: 'Saul authored Romans.',
        stance: 'neutral',
      }),
    ]);
    expect(claims[0]?.entityIds).toEqual(entities.map((entity) => entity.id));
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

  it('raw 후보가 있지만 유효 fact가 없으면 schema mismatch로 rejected fact를 저장한다', async () => {
    const store = new InMemoryKnowledgeGraphStore();
    const indexer = new GraphExtractionIndexer({
      provider: createProvider(
        JSON.stringify({
          entities: [{ name: 'Missing type' }],
          relations: [],
          claims: [],
        }),
      ),
      store,
    });

    await indexer.extractChunk(createInput('Invalid entity shape.'));

    expect(await store.getEntities()).toEqual([]);
    expect(await store.getRejectedFacts()).toEqual([
      expect.objectContaining({
        reason: 'schema-shape-mismatch',
        rawFact: {
          entities: [{ name: 'Missing type' }],
          relations: [],
          claims: [],
        },
      }),
    ]);
  });

  it('JSON 파싱 실패 chunk는 캐시하지 않아 같은 chunk를 다시 추출할 수 있다', async () => {
    const store = new InMemoryKnowledgeGraphStore();
    const provider = createProviderSequence([
      'not-json',
      JSON.stringify({
        entities: [{ name: 'Paul', typeId: 'person', description: 'Apostle', confidence: 0.8 }],
        relations: [],
        claims: [],
      }),
    ]);
    const indexer = new GraphExtractionIndexer({ provider, store });

    await indexer.extractChunk(createInput('Paul appears.'));
    await indexer.extractChunk(createInput('Paul appears.'));

    expect(provider.calls).toBe(2);
    expect((await store.getEntities()).map((entity) => entity.canonicalName)).toEqual(['Paul']);
  });

  it('LLM이 흔히 반환하는 대체 필드명은 GraphRAG schema로 정규화해 저장한다', async () => {
    const store = new InMemoryKnowledgeGraphStore();
    const indexer = new GraphExtractionIndexer({
      provider: createProvider(
        [
          '```json',
          JSON.stringify(
            {
              entities: [
                { id: 'Base', type: 'work', name: 'Base' },
                { id: '표', type: 'concept', name: '표' },
              ],
              relations: [{ source: '표', target: 'Base', type: 'part_of' }],
              claims: [
                {
                  subject: 'Base',
                  object: '표',
                  claim: "The work titled 'Base' contains a table view named '표'.",
                  type: 'factual_claim',
                },
              ],
            },
            null,
            2,
          ),
          '```',
        ].join('\n'),
      ),
      store,
    });

    await indexer.extractChunk({
      ...createInput('Base.base content', 'Base.base::0::0'),
      filePath: 'Base.base',
    });

    expect((await store.getEntities()).map((entity) => entity.canonicalName)).toEqual([
      'Base',
      '표',
    ]);
    expect(await store.getRelations()).toEqual([
      expect.objectContaining({
        relationTypeId: 'part_of',
      }),
    ]);
    expect(await store.getClaims()).toEqual([
      expect.objectContaining({
        claimTypeId: 'factual_claim',
        text: "The work titled 'Base' contains a table view named '표'.",
      }),
    ]);
    expect(await store.getRejectedFacts()).toEqual([]);
  });

  it('fenced JSON과 앞뒤 설명이 섞여도 유효 fact는 저장하고 invalid fact만 reject한다', async () => {
    const store = new InMemoryKnowledgeGraphStore();
    const indexer = new GraphExtractionIndexer({
      provider: createProvider(
        [
          '아래 결과입니다.',
          '```json',
          JSON.stringify({
            entities: [
              { name: 'Paul', typeId: 'person', description: 'Apostle', confidence: 0.9 },
              { name: 'Mystery', typeId: 'unknown-type', description: 'Invalid', confidence: 0.9 },
            ],
            relations: [],
            claims: [],
          }),
          '```',
        ].join('\n'),
      ),
      store,
    });

    await indexer.extractChunk(createInput('Paul appears.'));

    expect((await store.getEntities()).map((entity) => entity.canonicalName)).toEqual(['Paul']);
    expect(await store.getRejectedFacts()).toEqual([
      expect.objectContaining({
        reason: 'unknown-entity-type',
      }),
    ]);
  });

  it('알 수 없는 claim type은 rejected fact로 저장하고 claim으로 저장하지 않는다', async () => {
    const store = new InMemoryKnowledgeGraphStore();
    const indexer = new GraphExtractionIndexer({
      provider: createProvider(
        JSON.stringify({
          entities: [{ name: 'Paul', typeId: 'person', description: 'Apostle', confidence: 0.8 }],
          relations: [],
          claims: [
            {
              text: 'Paul made an unsupported classification.',
              claimTypeId: 'unknown_claim',
              entityNames: ['Paul'],
              stance: 'neutral',
              confidence: 0.8,
            },
          ],
        }),
      ),
      store,
    });

    await indexer.extractChunk(createInput('Paul made an unsupported classification.'));

    expect((await store.getEntities()).map((entity) => entity.canonicalName)).toEqual(['Paul']);
    expect(await store.getClaims()).toEqual([]);
    expect(await store.getRejectedFacts()).toEqual([
      expect.objectContaining({
        reason: 'unknown-claim-type',
      }),
    ]);
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
            {
              name: 'Paul',
              typeId: 'person',
              aliases: ['Saul'],
              description: 'Apostle',
              confidence: 0.9,
            },
          ],
          relations: [],
          claims: [],
        }),
        JSON.stringify({
          entities: [
            {
              name: 'Saul',
              typeId: 'person',
              aliases: [],
              description: 'Apostle',
              confidence: 0.8,
            },
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
    ontologySchema: buildDefaultOntologySchema(),
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
