import { describe, expect, it } from 'vitest';
import type { LLMProvider } from '../llm/providers';
import { resolveProviderCapability } from '../llm/provider-capabilities';
import type { EmbeddingProvider } from '../llm/embedding';
import { buildDefaultOntologySchema } from '../ontology/schema';
import { GraphExtractionIndexer } from './extraction';
import { InMemoryKnowledgeGraphStore } from './store';

const TEST_PROVIDER_CAPABILITY = resolveProviderCapability({
  providerKey: 'openai',
  model: 'test-model',
});

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
    expect(entities[0]?.labels).toEqual([
      {
        value: 'Paul',
        language: 'en',
        kind: 'preferred',
        source: 'llm-extraction',
        confidence: 0.9,
        evidenceIds: [expect.stringContaining('evidence::')],
      },
      {
        value: 'Saul',
        language: 'en',
        kind: 'alias',
        source: 'llm-extraction',
        confidence: 0.9,
        evidenceIds: [expect.stringContaining('evidence::')],
      },
    ]);
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

  it('저장 진행 이벤트는 성공적으로 저장된 항목 수를 알린다', async () => {
    const store = new InMemoryKnowledgeGraphStore();
    const progressEvents: Array<Record<string, number>> = [];
    const indexer = new GraphExtractionIndexer({
      provider: createProvider(
        JSON.stringify({
          entities: [
            {
              name: 'Paul',
              typeId: 'person',
              description: 'Apostle and author',
              aliases: [],
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

    const input = {
      ...createInput('Paul authored Romans.', 'Romans.md::1::0'),
      filePath: 'Romans.md',
      onProgress: (patch: Record<string, number>) => progressEvents.push(patch),
    };
    await indexer.extractChunk(input);

    expect(sumProgress(progressEvents, 'storedEvidence')).toBe(1);
    expect(sumProgress(progressEvents, 'storedEntities')).toBe(2);
    expect(sumProgress(progressEvents, 'storedRelations')).toBe(1);
    expect(sumProgress(progressEvents, 'storedClaims')).toBe(1);
    expect(sumProgress(progressEvents, 'cachedChunks')).toBe(1);
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

  it('schema reject 저장 진행 이벤트는 거부 항목 수를 알린다', async () => {
    const store = new InMemoryKnowledgeGraphStore();
    const progressEvents: Array<Record<string, number>> = [];
    const indexer = new GraphExtractionIndexer({
      provider: createProvider('{bad json'),
      store,
    });

    const input = {
      ...createInput('Malformed response.'),
      onProgress: (patch: Record<string, number>) => progressEvents.push(patch),
    };
    await indexer.extractChunk(input);

    expect(sumProgress(progressEvents, 'storedEvidence')).toBe(1);
    expect(sumProgress(progressEvents, 'storedRejectedFacts')).toBe(1);
    expect(sumProgress(progressEvents, 'cachedChunks')).toBe(0);
  });

  it('문헌/개념이 작품을 해석하는 interprets relation은 저장하고 reject하지 않는다', async () => {
    const store = new InMemoryKnowledgeGraphStore();
    const indexer = new GraphExtractionIndexer({
      provider: createProvider(
        JSON.stringify({
          entities: [
            {
              name: '주석 성경',
              typeId: 'work',
              description: '본문을 해석하는 주석 문헌',
              confidence: 0.9,
            },
            {
              name: '성경',
              typeId: 'work',
              description: '해석 대상 문헌',
              confidence: 0.9,
            },
            {
              name: '모세오경',
              typeId: 'concept',
              description: '성경 본문 해석 주제',
              confidence: 0.85,
            },
          ],
          relations: [
            {
              source: '주석 성경',
              target: '성경',
              relationTypeId: 'interprets',
              description: '주석 성경은 성경 본문을 해석한다.',
              confidence: 0.9,
            },
            {
              source: '모세오경',
              target: '성경',
              relationTypeId: 'interprets',
              description: '모세오경 주제는 성경 본문 해석과 연결된다.',
              confidence: 0.85,
            },
          ],
          claims: [],
        }),
      ),
      store,
    });

    await indexer.extractChunk(createInput('주석 성경은 성경 본문과 모세오경을 해석한다.'));

    expect(
      (await store.getRelations()).map((relation) => relation.relationTypeId),
    ).toEqual(['interprets', 'interprets']);
    expect(await store.getRejectedFacts()).toEqual([]);
  });

  it('relation endpoint가 같은 응답의 entity name 또는 alias와 맞지 않으면 reject한다', async () => {
    const store = new InMemoryKnowledgeGraphStore();
    const indexer = new GraphExtractionIndexer({
      provider: createProvider(
        JSON.stringify({
          entities: [
            { name: '주석 성경', typeId: 'work', description: '주석 문헌', confidence: 0.9 },
            { name: '성경', typeId: 'work', description: '해석 대상 문헌', confidence: 0.9 },
          ],
          relations: [
            {
              source: '본문',
              target: '성경',
              relationTypeId: 'interprets',
              description: '일반 역할명을 endpoint로 사용했다.',
              confidence: 0.9,
            },
          ],
          claims: [],
        }),
      ),
      store,
    });

    await indexer.extractChunk(createInput('주석 성경은 성경 본문을 해석한다.'));

    expect(await store.getRelations()).toEqual([]);
    expect(await store.getRejectedFacts()).toEqual([
      expect.objectContaining({ reason: 'unknown-relation-entity' }),
    ]);
  });

  it('추출 프롬프트는 relation domain/range와 endpoint exact-match 규칙을 포함한다', async () => {
    const store = new InMemoryKnowledgeGraphStore();
    const provider = createCapturingProvider(
      JSON.stringify({
        entities: [],
        relations: [],
        claims: [],
      }),
    );
    const indexer = new GraphExtractionIndexer({ provider, store });

    await indexer.extractChunk(createInput('No graph facts.'));

    const systemPrompt = provider.messages[0]?.[0]?.content ?? '';
    expect(systemPrompt).toContain('Relation domain/range constraints:');
    expect(systemPrompt).toContain('interprets: sourceTypeIds=argument|work|concept|person|organization; targetTypeIds=work|concept');
    expect(systemPrompt).toContain('Relation source and target must exactly match an entities[].name or one of that entity aliases.');
    expect(systemPrompt).toContain('Do not use generic role words such as author, text, body, source, target, subject, object, 저자, 본문, 대상 as relation endpoints unless they are explicit entity names in entities.');
    expect(systemPrompt).toContain('Put explicit same-entity names from other languages into aliases only when the source text or existing ontology context supports them.');
    expect(systemPrompt).toContain('Do not invent translated aliases just to make the graph multilingual.');
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

  it('다른 언어 alias는 structured label metadata와 legacy aliases에 함께 저장한다', async () => {
    const store = new InMemoryKnowledgeGraphStore();
    const indexer = new GraphExtractionIndexer({
      provider: createProvider(
        JSON.stringify({
          entities: [
            {
              name: 'Paul',
              typeId: 'person',
              aliases: ['바울', 'Saul'],
              description: 'Apostle known in Korean notes as 바울',
              confidence: 0.91,
            },
          ],
          relations: [],
          claims: [],
        }),
      ),
      store,
    });

    await indexer.extractChunk(createInput('Paul, 바울, and Saul refer to the same apostle.'));

    const [entity] = await store.getEntities();
    expect(entity).toEqual(
      expect.objectContaining({
        aliases: ['바울', 'Saul'],
        labels: [
          expect.objectContaining({
            value: 'Paul',
            language: 'en',
            kind: 'preferred',
            source: 'llm-extraction',
            confidence: 0.91,
          }),
          expect.objectContaining({
            value: '바울',
            language: 'ko',
            kind: 'alias',
            source: 'llm-extraction',
            confidence: 0.91,
          }),
          expect.objectContaining({
            value: 'Saul',
            language: 'en',
            kind: 'alias',
            source: 'llm-extraction',
            confidence: 0.91,
          }),
        ],
      }),
    );
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
    capability: TEST_PROVIDER_CAPABILITY,
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

function createCapturingProvider(response: string): LLMProvider & {
  messages: Parameters<LLMProvider['chat']>[0][];
} {
  const messages: Parameters<LLMProvider['chat']>[0][] = [];
  return {
    capability: TEST_PROVIDER_CAPABILITY,
    messages,
    chat: (inputMessages) => {
      messages.push(inputMessages);
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

function sumProgress(events: ReadonlyArray<Record<string, number>>, key: string): number {
  return events.reduce((total, event) => total + (event[key] ?? 0), 0);
}
