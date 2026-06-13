import { t } from '../i18n';
import { validateOntologyRelationRust, validateOntologySchemaRust } from '../rag/rust-core';

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

function buildBaseEntityTypes(): OntologyEntityType[] {
  return [
    entityType('person', 'Person', t('ontologyEntityPersonDesc'), ['Paul', 'Augustine']),
    entityType('organization', 'Organization', t('ontologyEntityOrganizationDesc'), [
      'University',
      'Council',
    ]),
    entityType('place', 'Place', t('ontologyEntityPlaceDesc'), ['Jerusalem', 'Rome']),
    entityType('work', 'Work', t('ontologyEntityWorkDesc'), ['Romans', 'A research paper']),
    entityType('concept', 'Concept', t('ontologyEntityConceptDesc'), ['Grace', 'Covenant']),
    entityType('event', 'Event', t('ontologyEntityEventDesc'), ['Council meeting']),
    entityType('argument', 'Argument', t('ontologyEntityArgumentDesc'), ['A theological argument']),
    entityType('evidence', 'Evidence', t('ontologyEntityEvidenceDesc'), ['A quoted passage']),
  ];
}

export function buildDefaultOntologySchema(): OntologySchema {
  return {
    id: 'default',
    name: 'Default',
    version: 1,
    locale: 'mixed',
    description: t('ontologyDefaultDescription'),
    entityTypes: buildBaseEntityTypes(),
    relationTypes: [
      relationType('authored', 'Authored', ['person'], ['work'], t('ontologyRelationAuthoredDesc')),
      relationType(
        'mentions',
        'Mentions',
        [ANY_ENTITY_TYPE],
        [ANY_ENTITY_TYPE],
        t('ontologyRelationMentionsDesc'),
      ),
      relationType(
        'supports',
        'Supports',
        ['evidence', 'argument'],
        ['argument', 'concept'],
        t('ontologyRelationSupportsDesc'),
      ),
      relationType(
        'opposes',
        'Opposes',
        ['argument'],
        ['argument', 'concept'],
        t('ontologyRelationOpposesDesc'),
      ),
      relationType(
        'collaborated_with',
        'Collaborated With',
        [ANY_ENTITY_TYPE],
        [ANY_ENTITY_TYPE],
        t('ontologyRelationCollaboratedDesc'),
        { symmetric: true },
      ),
      relationType(
        'causes',
        'Causes',
        ['event', 'concept'],
        ['event', 'concept'],
        t('ontologyRelationCausesDesc'),
      ),
      relationType(
        'influences',
        'Influences',
        [ANY_ENTITY_TYPE],
        [ANY_ENTITY_TYPE],
        t('ontologyRelationInfluencesDesc'),
      ),
      relationType(
        'part_of',
        'Part Of',
        [ANY_ENTITY_TYPE],
        [ANY_ENTITY_TYPE],
        t('ontologyRelationPartOfDesc'),
      ),
      relationType(
        'located_in',
        'Located In',
        ['event', 'organization'],
        ['place'],
        t('ontologyRelationLocatedInDesc'),
      ),
      relationType(
        'interprets',
        'Interprets',
        ['argument'],
        ['work', 'concept'],
        t('ontologyRelationInterpretsDesc'),
      ),
    ],
    claimTypes: [
      claimType('factual_claim', 'Factual Claim', t('ontologyClaimFactualDesc')),
      claimType('interpretive_claim', 'Interpretive Claim', t('ontologyClaimInterpretiveDesc')),
      claimType('evaluative_claim', 'Evaluative Claim', t('ontologyClaimEvaluativeDesc')),
    ],
    aliasRules: [{ id: 'case-fold-trim', description: t('ontologyAliasRuleDesc') }],
    mergeRules: [
      {
        id: 'default-name-alias-merge',
        description: t('ontologyMergeRuleDesc'),
        autoMergeThreshold: 0.88,
        pendingMergeThreshold: 0.72,
      },
    ],
    extractionGuidelines: t('ontologyExtractionGuidelines'),
  };
}

export function validateOntologySchema(schema: OntologySchema): string[] {
  const plan = validateOntologySchemaRust(schema);
  if (plan !== null) {
    return plan;
  }

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
  return (
    validateOntologyRelationRust({
      entityTypeIds: schema.entityTypes.map((entityType) => entityType.id),
      relationTypeIds: schema.relationTypes.map((relationType) => relationType.id),
      relationSourceTypeIds: schema.relationTypes.map((relationType) => relationType.sourceTypeIds),
      relationTargetTypeIds: schema.relationTypes.map((relationType) => relationType.targetTypeIds),
      relationTypeId: input.relationTypeId,
      sourceTypeId: input.sourceTypeId,
      targetTypeId: input.targetTypeId,
    }) ?? { valid: false, reason: 'unknown-relation-type' }
  );
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
