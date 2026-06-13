import { describe, expect, it } from 'vitest';
import {
  buildDefaultOntologySchema,
  validateOntologySchema,
  validateOntologyRelation,
} from './schema';

describe('Ontology schema', () => {
  it('단일 기본 schema만 제공하고 도메인 schema 옵션을 노출하지 않는다', () => {
    expect(buildDefaultOntologySchema().id).toBe('default');
    expect(buildDefaultOntologySchema().name).toBe('Default');
    expect(
      buildDefaultOntologySchema().entityTypes.map((entityType) => entityType.id),
    ).not.toContain('biblical_person');
    expect(
      buildDefaultOntologySchema().relationTypes.map((relationType) => relationType.id),
    ).not.toContain('quotes_passage');
  });

  it('기본 schema는 검증을 통과한다', () => {
    expect(validateOntologySchema(buildDefaultOntologySchema())).toEqual([]);
  });

  it('relation source/target type이 domain/range 제약을 만족하면 통과한다', () => {
    const result = validateOntologyRelation(buildDefaultOntologySchema(), {
      relationTypeId: 'authored',
      sourceTypeId: 'person',
      targetTypeId: 'work',
    });

    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('relation source/target type이 domain/range와 맞지 않으면 reject한다', () => {
    const result = validateOntologyRelation(buildDefaultOntologySchema(), {
      relationTypeId: 'authored',
      sourceTypeId: 'place',
      targetTypeId: 'person',
    });

    expect(result).toEqual({
      valid: false,
      reason: 'relation-domain-range-mismatch',
    });
  });

  it('unknown relation/type은 reject한다', () => {
    expect(
      validateOntologyRelation(buildDefaultOntologySchema(), {
        relationTypeId: 'missing',
        sourceTypeId: 'person',
        targetTypeId: 'work',
      }),
    ).toEqual({ valid: false, reason: 'unknown-relation-type' });

    expect(
      validateOntologyRelation(buildDefaultOntologySchema(), {
        relationTypeId: 'authored',
        sourceTypeId: 'person',
        targetTypeId: 'missing',
      }),
    ).toEqual({ valid: false, reason: 'unknown-entity-type' });
  });

  it('스키마 유효성 검증은 누락/참조 불일치를 반환한다', () => {
    expect(
      validateOntologySchema({
        id: '',
        name: 'Invalid',
        version: 0,
        locale: 'mixed',
        description: '',
        entityTypes: [
          { id: 'person', label: 'Person', description: '', examples: [], properties: [] },
        ],
        relationTypes: [
          {
            id: '',
            label: 'Invalid',
            description: '',
            sourceTypeIds: ['person'],
            targetTypeIds: ['missing'],
            properties: [],
            examples: [],
          },
        ],
        claimTypes: [],
        aliasRules: [],
        mergeRules: [],
        extractionGuidelines: '',
      }),
    ).toEqual([
      'schema.id is required',
      'schema.version must be a positive integer',
      'relationType.id is required',
      'unknown relation target type: missing',
    ]);
  });
});
