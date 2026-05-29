export type OntologyLocale = 'ko' | 'en' | 'mixed';
export type OntologyPropertyValueType = 'string' | 'number' | 'boolean' | 'date' | 'enum';

export interface OntologySchema {
  id: string;
  name: string;
  version: number;
  locale: OntologyLocale;
  description: string;
  entityTypes: OntologyEntityType[];
  relationTypes: OntologyRelationType[];
  claimTypes: OntologyClaimType[];
  aliasRules: OntologyAliasRule[];
  mergeRules: OntologyMergeRule[];
  extractionGuidelines: string;
}

export interface OntologyEntityType {
  id: string;
  label: string;
  description: string;
  parentTypeId?: string;
  properties: OntologyProperty[];
  examples: string[];
}

export interface OntologyRelationType {
  id: string;
  label: string;
  description: string;
  sourceTypeIds: string[];
  targetTypeIds: string[];
  inverseRelationTypeId?: string;
  symmetric?: boolean;
  transitive?: boolean;
  properties: OntologyProperty[];
  examples: string[];
}

export interface OntologyClaimType {
  id: string;
  label: string;
  description: string;
  examples: string[];
}

export interface OntologyProperty {
  id: string;
  valueType: OntologyPropertyValueType;
  required: boolean;
  enumValues?: string[];
}

export interface OntologyAliasRule {
  id: string;
  description: string;
}

export interface OntologyMergeRule {
  id: string;
  description: string;
  autoMergeThreshold: number;
  pendingMergeThreshold: number;
}

export interface OntologyRelationValidationInput {
  relationTypeId: string;
  sourceTypeId: string;
  targetTypeId: string;
}

export type OntologyRelationValidationReason =
  | 'unknown-relation-type'
  | 'unknown-entity-type'
  | 'relation-domain-range-mismatch';

export type OntologyRelationValidationResult =
  | { valid: true; reason?: undefined }
  | { valid: false; reason: OntologyRelationValidationReason };

const ANY_ENTITY_TYPE = 'any';

const baseEntityTypes: OntologyEntityType[] = [
  entityType('person', 'Person', '사람, 저자, 역사 인물', ['Paul', 'Augustine']),
  entityType('organization', 'Organization', '기관, 단체, 종파, 학교', ['University', 'Council']),
  entityType('place', 'Place', '장소, 지역, 국가', ['Jerusalem', 'Rome']),
  entityType('work', 'Work', '책, 논문, 문서, 작품', ['Romans', 'A research paper']),
  entityType('concept', 'Concept', '개념, 주제, 이론', ['Grace', 'Covenant']),
  entityType('event', 'Event', '사건, 회의, 전쟁, 변화', ['Council meeting']),
  entityType('argument', 'Argument', '주장, 논증, 해석', ['A theological argument']),
  entityType('evidence', 'Evidence', '근거, 인용, 사례', ['A quoted passage']),
];

export const DEFAULT_ONTOLOGY_SCHEMA: OntologySchema = {
  id: 'default',
  name: 'Default',
  version: 1,
  locale: 'mixed',
  description: '기본 온톨로지 스키마입니다.',
  entityTypes: baseEntityTypes,
  relationTypes: [
    relationType('authored', 'Authored', ['person'], ['work'], '저작 관계'),
    relationType('mentions', 'Mentions', [ANY_ENTITY_TYPE], [ANY_ENTITY_TYPE], '언급 관계'),
    relationType('supports', 'Supports', ['evidence', 'argument'], ['argument', 'concept'], '지지'),
    relationType('opposes', 'Opposes', ['argument'], ['argument', 'concept'], '반대'),
    relationType(
      'collaborated_with',
      'Collaborated With',
      [ANY_ENTITY_TYPE],
      [ANY_ENTITY_TYPE],
      '협력',
      { symmetric: true },
    ),
    relationType('causes', 'Causes', ['event', 'concept'], ['event', 'concept'], '원인'),
    relationType('influences', 'Influences', [ANY_ENTITY_TYPE], [ANY_ENTITY_TYPE], '영향'),
    relationType('part_of', 'Part Of', [ANY_ENTITY_TYPE], [ANY_ENTITY_TYPE], '포함 관계'),
    relationType('located_in', 'Located In', ['event', 'organization'], ['place'], '위치'),
    relationType('interprets', 'Interprets', ['argument'], ['work', 'concept'], '해석'),
  ],
  claimTypes: [
    claimType('factual_claim', 'Factual Claim', '사실 관계 주장'),
    claimType('interpretive_claim', 'Interpretive Claim', '해석적 주장'),
    claimType('evaluative_claim', 'Evaluative Claim', '평가적 주장'),
  ],
  aliasRules: [{ id: 'case-fold-trim', description: '공백 정리와 영문 대소문자 정규화' }],
  mergeRules: [
    {
      id: 'default-name-alias-merge',
      description: 'canonical name과 alias exact match 기반 병합',
      autoMergeThreshold: 0.88,
      pendingMergeThreshold: 0.72,
    },
  ],
  extractionGuidelines:
    '허용된 entity/relation/claim type만 사용하고, 근거가 있는 본문 표현을 중심으로 추출한다.',
};

export function validateOntologySchema(schema: OntologySchema): string[] {
  const errors: string[] = [];
  const entityTypeIds = new Set(schema.entityTypes.map((entityType) => entityType.id));
  const relationTypeIds = new Set(schema.relationTypes.map((relationType) => relationType.id));

  if (!schema.id) errors.push('schema.id is required');
  if (!schema.name) errors.push('schema.name is required');
  if (!Number.isInteger(schema.version) || schema.version < 1) {
    errors.push('schema.version must be a positive integer');
  }

  for (const entityType of schema.entityTypes) {
    if (!entityType.id) errors.push('entityType.id is required');
    if (entityType.parentTypeId && !entityTypeIds.has(entityType.parentTypeId)) {
      errors.push(`unknown parent entity type: ${entityType.parentTypeId}`);
    }
  }

  for (const relationType of schema.relationTypes) {
    if (!relationType.id) errors.push('relationType.id is required');
    if (relationTypeIds.has(relationType.inverseRelationTypeId ?? '')) continue;
    if (relationType.inverseRelationTypeId) {
      errors.push(`unknown inverse relation type: ${relationType.inverseRelationTypeId}`);
    }
    for (const sourceTypeId of relationType.sourceTypeIds) {
      if (!isKnownEntityType(entityTypeIds, sourceTypeId)) {
        errors.push(`unknown relation source type: ${sourceTypeId}`);
      }
    }
    for (const targetTypeId of relationType.targetTypeIds) {
      if (!isKnownEntityType(entityTypeIds, targetTypeId)) {
        errors.push(`unknown relation target type: ${targetTypeId}`);
      }
    }
  }

  return errors;
}

export function validateOntologyRelation(
  schema: OntologySchema,
  input: OntologyRelationValidationInput,
): OntologyRelationValidationResult {
  const entityTypeIds = new Set(schema.entityTypes.map((entityType) => entityType.id));
  const relationType = schema.relationTypes.find(
    (candidate) => candidate.id === input.relationTypeId,
  );
  if (!relationType) return { valid: false, reason: 'unknown-relation-type' };
  if (!entityTypeIds.has(input.sourceTypeId) || !entityTypeIds.has(input.targetTypeId)) {
    return { valid: false, reason: 'unknown-entity-type' };
  }
  if (
    !typeListContains(relationType.sourceTypeIds, input.sourceTypeId) ||
    !typeListContains(relationType.targetTypeIds, input.targetTypeId)
  ) {
    return { valid: false, reason: 'relation-domain-range-mismatch' };
  }
  return { valid: true };
}

function entityType(
  id: string,
  label: string,
  description: string,
  examples: string[],
  parentTypeId?: string,
): OntologyEntityType {
  return {
    id,
    label,
    description,
    parentTypeId,
    properties: [],
    examples,
  };
}

function relationType(
  id: string,
  label: string,
  sourceTypeIds: string[],
  targetTypeIds: string[],
  description: string,
  options: Pick<OntologyRelationType, 'symmetric' | 'transitive' | 'inverseRelationTypeId'> = {},
): OntologyRelationType {
  return {
    id,
    label,
    description,
    sourceTypeIds,
    targetTypeIds,
    properties: [],
    examples: [],
    ...options,
  };
}

function claimType(id: string, label: string, description: string): OntologyClaimType {
  return {
    id,
    label,
    description,
    examples: [],
  };
}

function isKnownEntityType(entityTypeIds: Set<string>, typeId: string): boolean {
  return typeId === ANY_ENTITY_TYPE || entityTypeIds.has(typeId);
}

function typeListContains(typeIds: readonly string[], typeId: string): boolean {
  return typeIds.includes(ANY_ENTITY_TYPE) || typeIds.includes(typeId);
}
