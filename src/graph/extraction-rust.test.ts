import { describe, expect, it, vi } from 'vitest';
import type { LLMProvider } from '../llm/providers';
import { buildDefaultOntologySchema } from '../ontology/schema';
import { GraphExtractionIndexer } from './extraction';
import { InMemoryKnowledgeGraphStore } from './store';

const planGraphRelationEndpointIndicesRustMock = vi.hoisted(() => vi.fn());

vi.mock('../rag/rust-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../rag/rust-core')>();
  return {
    ...actual,
    planGraphRelationEndpointIndicesRust: planGraphRelationEndpointIndicesRustMock,
  };
});

describe('GraphExtractionIndexer Rust relation endpoint guard', () => {
  it('잘못된 relation endpoint 인덱스는 relation을 저장하지 않고 rejected fact로 남긴다', async () => {
    const store = new InMemoryKnowledgeGraphStore();
    const indexer = new GraphExtractionIndexer({
      provider: createProvider(
        JSON.stringify({
          entities: [
            {
              name: 'Paul',
              typeId: 'person',
              description: 'Apostle',
              aliases: ['Saul'],
              confidence: 0.9,
            },
            {
              name: 'Romans',
              typeId: 'work',
              description: 'Epistle',
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
          claims: [],
        }),
      ),
      store,
    });

    planGraphRelationEndpointIndicesRustMock.mockReturnValue({
      pairs: [{ sourceEntityIndex: 0, targetEntityIndex: 9 }],
    });

    await indexer.extractChunk(createInput('Saul authored Romans.'));

    expect(await store.getRelations()).toEqual([]);
    expect(
      await store.getRejectedFacts().then((facts) => facts.map((fact) => fact.reason)),
    ).toContain('unknown-relation-entity');
  });

  it('plan이 null일 때는 기존 relation 매칭 경로를 따른다', async () => {
    const store = new InMemoryKnowledgeGraphStore();
    const indexer = new GraphExtractionIndexer({
      provider: createProvider(
        JSON.stringify({
          entities: [
            {
              name: 'Paul',
              typeId: 'person',
              description: 'Apostle',
              aliases: ['Saul'],
              confidence: 0.9,
            },
            {
              name: 'Romans',
              typeId: 'work',
              description: 'Epistle',
              aliases: [],
              confidence: 0.86,
            },
          ],
          claims: [],
          relations: [
            {
              source: 'Saul',
              target: 'Romans',
              relationTypeId: 'authored',
              description: 'Saul authored Romans',
              confidence: 0.82,
            },
          ],
        }),
      ),
      store,
    });

    planGraphRelationEndpointIndicesRustMock.mockReturnValue(null);

    await indexer.extractChunk(createInput('Saul authored Romans.'));

    const relations = await store.getRelations();
    expect(relations).toHaveLength(1);
    expect(relations[0]?.relationTypeId).toBe('authored');
  });
});

function createInput(
  chunkText: string,
  filePath = 'note.md',
  entryId = 'note.md::1::0',
): Parameters<GraphExtractionIndexer['extractChunk']>[0] {
  return {
    chunkText,
    filePath,
    entryId,
    startLine: 1,
    endLine: 1,
    contentHash: 'hash-1',
    extractionModelKey: 'openai:gpt-4o-mini',
    ontologySchema: buildDefaultOntologySchema(),
  };
}

function createProvider(response: string): LLMProvider {
  return {
    chat: () => Promise.resolve(response),
    streamChat: () => Promise.resolve(),
  };
}
