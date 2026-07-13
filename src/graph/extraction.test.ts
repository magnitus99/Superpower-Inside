import { describe, expect, it } from 'vitest';
import type { LLMProvider } from '../llm/providers';
import { resolveProviderCapability } from '../llm/provider-capabilities';
import type { EmbeddingProvider } from '../llm/embedding';
import { buildKnowledgeGraphContract } from './knowledge-contract';
import { GraphExtractionDeferredError, GraphExtractionIndexer } from './extraction';
import { InMemoryKnowledgeGraphStore } from './store';

const TEST_PROVIDER_CAPABILITY = resolveProviderCapability({
  providerKey: 'openai',
  model: 'test-model',
});

describe('GraphExtractionIndexer', () => {
  it('저장 중단 뒤에도 영구 보관한 raw response로 재개하고 provider를 다시 호출하지 않는다', async () => {
    const store = new FailOnceEntityStore();
    const provider = createProvider(
      JSON.stringify({
        entities: [{ name: 'Alpha', typeId: 'concept', confidence: 0.9 }],
        relations: [],
        claims: [],
      }),
    );
    const indexer = new GraphExtractionIndexer({ provider, store });
    const input = createInput('Alpha is a concept.');

    await expect(indexer.extractChunk(input)).rejects.toThrow('simulated entity write failure');
    expect(await store.getRawResponses()).toHaveLength(1);

    await expect(indexer.extractChunk(input)).resolves.toBeUndefined();
    expect(provider.calls).toBe(1);
    expect(await store.getEntities()).toEqual([
      expect.objectContaining({ canonicalName: 'Alpha' }),
    ]);
    expect(await store.getExtractionJobs()).toEqual([
      expect.objectContaining({ state: 'committed', attemptCount: 1 }),
    ]);
  });

  it('claim은 response에서 명시한 relation reference만 연결한다', async () => {
    const store = new InMemoryKnowledgeGraphStore();
    const indexer = new GraphExtractionIndexer({
      provider: createProvider(
        JSON.stringify({
          entities: [
            { id: 'e1', name: 'Alpha', typeId: 'concept' },
            { id: 'e2', name: 'Beta', typeId: 'concept' },
            { id: 'e3', name: 'Gamma', typeId: 'concept' },
          ],
          relations: [
            { id: 'r1', sourceRef: 'e1', targetRef: 'e2', relationTypeId: 'depends_on' },
            { id: 'r2', sourceRef: 'e2', targetRef: 'e3', relationTypeId: 'supports' },
          ],
          claims: [
            {
              id: 'c1',
              text: 'Beta supports Gamma.',
              claimTypeId: 'factual_claim',
              entityRefs: ['e2', 'e3'],
              relationRefs: ['r2'],
            },
          ],
        }),
      ),
      store,
    });

    await indexer.extractChunk(createInput('Alpha depends on Beta. Beta supports Gamma.'));

    const relations = await store.getRelations();
    const claims = await store.getClaims();
    expect(relations).toHaveLength(2);
    expect(claims[0]?.relationIds).toEqual([relations[1]?.id]);
  });

  it('provider 실패는 lease를 해제하고 bounded retry 대기 상태로 보존한다', async () => {
    const store = new InMemoryKnowledgeGraphStore();
    const indexer = new GraphExtractionIndexer({
      provider: createRejectingProvider(new Error('LLM chat failed: 429 rate limited')),
      store,
    });

    await expect(indexer.extractChunk(createInput('Alpha'))).rejects.toThrow('429');

    const jobs = await store.getExtractionJobs();
    expect(jobs).toEqual([
      expect.objectContaining({
        state: 'retry-wait',
        attemptCount: 1,
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        lastErrorCode: 'http-429',
      }),
    ]);
    expect(typeof jobs[0]?.nextAttemptAt).toBe('number');
  });

  it('인증 실패는 자동 재시도하지 않도록 격리한다', async () => {
    const store = new InMemoryKnowledgeGraphStore();
    const error = Object.assign(new Error('LLM chat failed: 401 unauthorized'), { status: 401 });
    const indexer = new GraphExtractionIndexer({ provider: createRejectingProvider(error), store });

    await expect(indexer.extractChunk(createInput('Alpha'))).rejects.toThrow('401');
    await expect(indexer.extractChunk(createInput('Alpha'))).rejects.toBeInstanceOf(
      GraphExtractionDeferredError,
    );

    expect(await store.getExtractionJobs()).toEqual([
      expect.objectContaining({ state: 'quarantined', lastErrorCode: 'http-401' }),
    ]);
  });

  it('연속 provider 실패 세 번 뒤에는 다른 chunk 호출도 회로 차단한다', async () => {
    const store = new InMemoryKnowledgeGraphStore();
    const provider = createCountingRejectingProvider(new Error('temporary provider failure'));
    const indexer = new GraphExtractionIndexer({ provider, store });
    const input = createInput('Alpha');

    for (let attempt = 0; attempt < 3; attempt++) {
      await expect(indexer.extractChunk({ ...input, ignoreRetryWait: true })).rejects.toThrow(
        'temporary',
      );
    }
    await expect(
      indexer.extractChunk({ ...createInput('Beta', 'note.md::2'), contentHash: 'hash-2' }),
    ).rejects.toBeInstanceOf(GraphExtractionDeferredError);

    expect(provider.calls).toBe(3);
  });

  it('취소된 provider 요청은 실패로 고정하지 않고 prepared 상태로 되돌린다', async () => {
    const store = new InMemoryKnowledgeGraphStore();
    const indexer = new GraphExtractionIndexer({
      provider: createRejectingProvider(new DOMException('cancelled', 'AbortError')),
      store,
    });

    await expect(indexer.extractChunk(createInput('Alpha'))).rejects.toMatchObject({
      name: 'AbortError',
    });

    expect(await store.getExtractionJobs()).toEqual([
      expect.objectContaining({
        state: 'prepared',
        attemptCount: 1,
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
      }),
    ]);
  });

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
      knowledgeContract: buildKnowledgeGraphContract(),
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

  it('고정 ontology domain/range에 없는 relation도 원문 관계로 보존한다', async () => {
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

    expect(await store.getRelations()).toEqual([
      expect.objectContaining({ relationTypeId: 'authored' }),
    ]);
    expect(await store.getRejectedFacts()).toEqual([]);
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

  it('문헌과 개념이 작품을 해석하는 interprets relation은 저장하고 reject하지 않는다', async () => {
    const store = new InMemoryKnowledgeGraphStore();
    const indexer = new GraphExtractionIndexer({
      provider: createProvider(
        JSON.stringify({
          entities: [
            {
              name: '분석 보고서',
              typeId: 'work',
              description: '원본 문서를 해석하는 분석 문헌',
              confidence: 0.9,
            },
            {
              name: '원본 문서',
              typeId: 'work',
              description: '해석 대상 문헌',
              confidence: 0.9,
            },
            {
              name: '데이터 모델',
              typeId: 'concept',
              description: '원본 문서 해석에 사용하는 개념',
              confidence: 0.85,
            },
          ],
          relations: [
            {
              source: '분석 보고서',
              target: '원본 문서',
              relationTypeId: 'interprets',
              description: '분석 보고서는 원본 문서를 해석한다.',
              confidence: 0.9,
            },
            {
              source: '데이터 모델',
              target: '원본 문서',
              relationTypeId: 'interprets',
              description: '데이터 모델은 원본 문서 해석과 연결된다.',
              confidence: 0.85,
            },
          ],
          claims: [],
        }),
      ),
      store,
    });

    await indexer.extractChunk(createInput('분석 보고서는 데이터 모델을 사용해 원본 문서를 해석한다.'));

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
            { name: '분석 보고서', typeId: 'work', description: '분석 문헌', confidence: 0.9 },
            { name: '원본 문서', typeId: 'work', description: '해석 대상 문헌', confidence: 0.9 },
          ],
          relations: [
            {
              source: '본문',
              target: '원본 문서',
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

    await indexer.extractChunk(createInput('분석 보고서는 원본 문서를 해석한다.'));

    expect(await store.getRelations()).toEqual([]);
    expect(await store.getRejectedFacts()).toEqual([
      expect.objectContaining({ reason: 'unknown-relation-entity' }),
    ]);
  });

  it('추출 프롬프트는 local reference와 열린 relation 계약을 포함한다', async () => {
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
    expect(systemPrompt).toContain('Unknown relations are allowed.');
    expect(systemPrompt).toContain('Relations must use sourceRef and targetRef.');
    expect(systemPrompt).toContain('Claims must reference only directly relevant entity and relation ids.');
    expect(systemPrompt).toContain(
      'Every sourceRef, targetRef, entityRef, and relationRef must match a response-local id.',
    );
    expect(systemPrompt).toContain(
      'Do not use generic role words as entities unless the source explicitly names them.',
    );
    expect(systemPrompt).toContain(
      'Put explicit same-entity names from other languages into aliases only when the source text supports them.',
    );
    expect(systemPrompt).toContain('Do not invent translated aliases just to make the graph multilingual.');
  });

  it('JSON 파싱 실패는 rejected fact로 저장하고 다음 chunk 처리를 막지 않는다', async () => {
    const store = new InMemoryKnowledgeGraphStore();
    const indexer = new GraphExtractionIndexer({
      provider: createProviderSequence([
        'not-json',
        'still-not-json',
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

  it('사용 불가능한 응답은 provider 종류와 무관하게 한 번만 형식 복구를 요청한다', async () => {
    const store = new InMemoryKnowledgeGraphStore();
    const provider = createCapturingProviderSequence([
      'not-json',
      JSON.stringify({
        entities: [{ id: 'E1', label: 'Paul', typeId: 'person' }],
        relations: [],
        claims: [],
      }),
    ]);
    const indexer = new GraphExtractionIndexer({ provider, store });

    await indexer.extractChunk(createInput('Paul appears.'));

    expect(provider.messages).toHaveLength(2);
    expect(provider.messages[1]?.[0]?.content).toContain('Repair the previous graph extraction response');
    expect(provider.messages[1]?.[1]?.content).toBe('not-json');
    expect((await store.getEntities()).map((entity) => entity.canonicalName)).toEqual(['Paul']);
    expect(await store.getRejectedFacts()).toEqual([]);
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
      'still-not-json',
      JSON.stringify({
        entities: [{ name: 'Paul', typeId: 'person', description: 'Apostle', confidence: 0.8 }],
        relations: [],
        claims: [],
      }),
    ]);
    const indexer = new GraphExtractionIndexer({ provider, store });

    await indexer.extractChunk(createInput('Paul appears.'));
    await indexer.extractChunk(createInput('Paul appears.'));

    expect(provider.calls).toBe(3);
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

  it('무료 LLM의 ID relation endpoint와 claim reference를 entity label로 연결한다', async () => {
    const store = new InMemoryKnowledgeGraphStore();
    const indexer = new GraphExtractionIndexer({
      provider: createProvider(
        JSON.stringify({
          entities: [
            { id: 'E1', typeId: 'person', label: '바오로' },
            { id: 'E2', typeId: 'work', label: '로마서' },
          ],
          relations: [{ source: 'E1', target: 'E2', relationTypeId: 'authored' }],
          claims: [
            {
              text: '바오로는 로마서를 저술했다.',
              claimTypeId: 'factual_claim',
              entityNames: ['E1', 'E2'],
            },
          ],
        }),
      ),
      store,
    });

    await indexer.extractChunk(createInput('바오로는 로마서를 저술했다.'));

    const entities = await store.getEntities();
    expect(entities.map((entity) => entity.canonicalName)).toEqual(['바오로', '로마서']);
    expect(await store.getRelations()).toEqual([
      expect.objectContaining({
        sourceEntityId: entities[0]?.id,
        targetEntityId: entities[1]?.id,
        relationTypeId: 'authored',
      }),
    ]);
    expect(await store.getClaims()).toEqual([
      expect.objectContaining({ entityIds: entities.map((entity) => entity.id) }),
    ]);
    expect(await store.getRejectedFacts()).toEqual([]);
  });

  it('고정 목록에 없는 entity type도 원문 분류로 보존한다', async () => {
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

    expect((await store.getEntities()).map((entity) => entity.canonicalName)).toEqual([
      'Paul',
      'Mystery',
    ]);
    expect(await store.getRejectedFacts()).toEqual([]);
  });

  it('고정 목록에 없는 claim type도 원문 분류로 보존한다', async () => {
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
    expect(await store.getClaims()).toEqual([
      expect.objectContaining({ claimTypeId: 'unknown_claim' }),
    ]);
    expect(await store.getRejectedFacts()).toEqual([]);
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
        existingEntityId: 'entity::knowledge-graph::concept::grace',
        candidateEntityId: 'entity::knowledge-graph::concept::divine-mercy',
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
    knowledgeContract: buildKnowledgeGraphContract(),
  };
}

function createProvider(response: string): LLMProvider & { calls: number } {
  return createProviderSequence([response]);
}

class FailOnceEntityStore extends InMemoryKnowledgeGraphStore {
  private shouldFail = true;

  override upsertEntity(
    record: Parameters<InMemoryKnowledgeGraphStore['upsertEntity']>[0],
  ): Promise<void> {
    if (this.shouldFail) {
      this.shouldFail = false;
      return Promise.reject(new Error('simulated entity write failure'));
    }
    return super.upsertEntity(record);
  }
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

function createRejectingProvider(error: Error): LLMProvider {
  return {
    capability: TEST_PROVIDER_CAPABILITY,
    chat: () => Promise.reject(error),
    streamChat: () => Promise.reject(error),
  };
}

function createCountingRejectingProvider(error: Error): LLMProvider & { calls: number } {
  let calls = 0;
  return {
    capability: TEST_PROVIDER_CAPABILITY,
    get calls() {
      return calls;
    },
    chat: () => {
      calls++;
      return Promise.reject(error);
    },
    streamChat: () => Promise.reject(error),
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

function createCapturingProviderSequence(responses: string[]): LLMProvider & {
  messages: Parameters<LLMProvider['chat']>[0][];
} {
  const messages: Parameters<LLMProvider['chat']>[0][] = [];
  let calls = 0;
  return {
    capability: TEST_PROVIDER_CAPABILITY,
    messages,
    chat: (inputMessages) => {
      messages.push(inputMessages);
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

function sumProgress(events: ReadonlyArray<Record<string, number>>, key: string): number {
  return events.reduce((total, event) => total + (event[key] ?? 0), 0);
}
