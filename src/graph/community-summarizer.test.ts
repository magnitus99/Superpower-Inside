import { describe, expect, it } from 'vitest';
import type { EmbeddingProvider } from '../llm/embedding';
import type { LLMProvider } from '../llm/providers';
import { resolveProviderCapability } from '../llm/provider-capabilities';
import { CommunitySummarizer } from './community-summarizer';
import {
  InMemoryKnowledgeGraphStore,
  type GraphClaimRecord,
  type GraphEntityRecord,
  type GraphRelationRecord,
} from './store';

const TEST_PROVIDER_CAPABILITY = resolveProviderCapability({
  providerKey: 'openai',
  model: 'test-model',
});

describe('CommunitySummarizer', () => {
  it('community별 entity, relation, claim grouping은 Rust index plan을 따른다', async () => {
    const store = new InMemoryKnowledgeGraphStore();
    await store.upsertEntity(createEntity('entity::paul', 'Paul'));
    await store.upsertEntity(createEntity('entity::romans', 'Romans'));
    await store.upsertEntity(createEntity('entity::grace', 'Grace'));
    await store.addRelation(createRelation('relation::paul-romans', 'entity::paul', 'entity::romans'));
    await store.addRelation(createRelation('relation::paul-grace', 'entity::paul', 'entity::grace'));
    await store.addClaim(createClaim('claim::romans', ['entity::romans']));
    await store.addClaim(createClaim('claim::grace-first', ['entity::grace', 'entity::paul']));
    await store.addClaim(createClaim('claim::missing', ['entity::missing']));

    const provider = createProvider();
    const summarizer = new CommunitySummarizer({
      provider,
      embeddingProvider: createEmbeddingProvider(),
      store,
      ontologySchemaId: 'default',
    });

    const communities = await summarizer.summarizeCommunities(
      new Map([
        ['entity::paul', 7],
        ['entity::romans', 7],
        ['entity::grace', 8],
      ]),
      [7, 8, 9],
    );

    expect(provider.calls).toBe(2);
    expect(communities).toEqual([
      expect.objectContaining({
        title: 'Community 7',
        entityIds: ['entity::paul', 'entity::romans'],
        relationIds: ['relation::paul-romans'],
        claimIds: ['claim::romans'],
      }),
      expect.objectContaining({
        title: 'Community 8',
        entityIds: ['entity::grace'],
        relationIds: [],
        claimIds: ['claim::grace-first'],
      }),
    ]);
  });

  it('community id는 graph id 규칙으로 정규화된다', async () => {
    const store = new InMemoryKnowledgeGraphStore();
    await store.upsertEntity(createEntity('entity::paul', 'Paul & the apostle'));
    await store.upsertEntity(createEntity('entity::romans', 'Romans'));
    await store.addRelation(
      createRelation('relation::paul-romans', 'entity::paul', 'entity::romans'),
    );

    const provider = createProvider();
    const summarizer = new CommunitySummarizer({
      provider,
      embeddingProvider: createEmbeddingProvider(),
      store,
      ontologySchemaId: 'default',
    });

    const communities = await summarizer.summarizeCommunities(
      new Map([
        ['entity::paul', 7],
        ['entity::romans', 7],
      ]),
      [7],
    );

    expect(communities).toHaveLength(1);
    expect(communities[0]).toBeDefined();
    const id = communities[0]?.id ?? '';
    expect(id).toMatch(/^community::default::7::/);
    expect(id).not.toContain(' ');
    expect(id).not.toContain('&');
  });

  it('계층 summary는 child report를 상위 prompt에 넣고 parent id를 연결한다', async () => {
    const store = new InMemoryKnowledgeGraphStore();
    for (const id of ['a', 'b', 'c', 'd']) {
      await store.upsertEntity(createEntity(`entity::${id}`, id.toUpperCase()));
    }
    const prompts: string[] = [];
    let calls = 0;
    const provider: LLMProvider = {
      capability: TEST_PROVIDER_CAPABILITY,
      chat: (messages) => {
        prompts.push(messages.map((message) => message.content).join('\n'));
        calls++;
        return Promise.resolve(`summary-${calls}`);
      },
      streamChat: () => Promise.resolve(),
    };
    const summarizer = new CommunitySummarizer({
      provider,
      embeddingProvider: createEmbeddingProvider(),
      store,
      ontologySchemaId: 'default',
    });

    const records = await summarizer.summarizeHierarchy([
      {
        level: 0,
        assignmentsById: [
          { entityId: 'entity::a', communityId: 0 },
          { entityId: 'entity::b', communityId: 0 },
          { entityId: 'entity::c', communityId: 1 },
          { entityId: 'entity::d', communityId: 1 },
        ],
        communityIds: [0, 1],
        modularity: 0.7,
      },
      {
        level: 1,
        assignmentsById: ['a', 'b', 'c', 'd'].map((id) => ({
          entityId: `entity::${id}`,
          communityId: 0,
        })),
        communityIds: [0],
        modularity: 0,
      },
    ]);

    expect(records).toHaveLength(3);
    expect(records[0]?.parentCommunityId).toBe(records[2]?.id);
    expect(records[1]?.parentCommunityId).toBe(records[2]?.id);
    expect(prompts[2]).toContain('summary-1');
    expect(prompts[2]).toContain('summary-2');
  });

  it('embedding 단계가 중단돼도 저장한 summary 응답으로 provider 재호출 없이 재개한다', async () => {
    const store = new InMemoryKnowledgeGraphStore();
    await store.upsertEntity(createEntity('entity::a', 'A'));
    const provider = createProvider();
    const failingEmbedding: EmbeddingProvider = {
      embed: () => Promise.reject(new Error('simulated embedding interruption')),
      embedBatch: () => Promise.reject(new Error('simulated embedding interruption')),
    };
    const assignments = new Map([['entity::a', 0]]);

    await expect(
      new CommunitySummarizer({
        provider,
        embeddingProvider: failingEmbedding,
        store,
        ontologySchemaId: 'default',
      }).summarizeCommunities(assignments, [0]),
    ).rejects.toThrow('simulated embedding interruption');
    await expect(
      new CommunitySummarizer({
        provider,
        embeddingProvider: createEmbeddingProvider(),
        store,
        ontologySchemaId: 'default',
      }).summarizeCommunities(assignments, [0]),
    ).resolves.toHaveLength(1);

    expect(provider.calls).toBe(1);
    expect(await store.getRawResponses()).toHaveLength(1);
  });
});

function createEntity(id: string, canonicalName: string): GraphEntityRecord {
  return {
    id,
    ontologySchemaId: 'default',
    ontologyVersion: 1,
    typeId: 'concept',
    canonicalName,
    aliases: [],
    description: '',
    properties: {},
    confidence: 0.9,
    evidenceIds: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

function createRelation(
  id: string,
  sourceEntityId: string,
  targetEntityId: string,
): GraphRelationRecord {
  return {
    id,
    ontologySchemaId: 'default',
    ontologyVersion: 1,
    relationTypeId: 'mentions',
    sourceEntityId,
    targetEntityId,
    description: '',
    properties: {},
    confidence: 0.8,
    evidenceIds: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

function createClaim(id: string, entityIds: string[]): GraphClaimRecord {
  return {
    id,
    claimTypeId: 'factual_claim',
    text: id,
    entityIds,
    relationIds: [],
    stance: 'neutral',
    confidence: 0.8,
    evidenceIds: [],
    updatedAt: 1,
  };
}

function createProvider(): LLMProvider & { calls: number } {
  let calls = 0;
  return {
    capability: TEST_PROVIDER_CAPABILITY,
    get calls() {
      return calls;
    },
    chat: () => {
      calls++;
      return Promise.resolve(`summary-${calls}`);
    },
    streamChat: () => Promise.resolve(),
  };
}

function createEmbeddingProvider(): EmbeddingProvider {
  return {
    embed: (text: string) => Promise.resolve([text.length]),
    embedBatch: (texts: string[]) => Promise.resolve(texts.map((text) => [text.length])),
  };
}
