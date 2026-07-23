export type KnowledgeEntityTypeId =
  | 'person'
  | 'organization'
  | 'place'
  | 'document'
  | 'event'
  | 'concept'
  | 'project'
  | 'task'
  | 'decision'
  | 'question'
  | 'requirement'
  | 'metric'
  | 'product'
  | 'technology'
  | 'other';

export interface KnowledgeEntityTypeHint {
  id: KnowledgeEntityTypeId;
  label: string;
  description: string;
}

export interface KnowledgeClaimTypeHint {
  id:
    | 'factual_claim'
    | 'interpretive_claim'
    | 'evaluative_claim'
    | 'decision_claim'
    | 'hypothesis_claim'
    | 'requirement_claim'
    | 'action_item_claim';
  label: string;
  description: string;
}

export interface KnowledgeRelationTypeHint {
  id: string;
  label: string;
  description: string;
}

export interface KnowledgeGraphContract {
  id: string;
  name: string;
  version: number;
  locale: 'ko' | 'en' | 'mixed';
  description: string;
  entityTypes: KnowledgeEntityTypeHint[];
  claimTypes: KnowledgeClaimTypeHint[];
  relationTypeHints: KnowledgeRelationTypeHint[];
  allowUnknownRelationTypes: true;
  extractionGuidelines: string;
}

export function buildKnowledgeGraphContract(): KnowledgeGraphContract {
  return {
    id: 'knowledge-graph',
    name: 'Knowledge graph contract',
    version: 2,
    locale: 'mixed',
    description: 'Evidence-grounded, domain-neutral graph extraction contract.',
    entityTypes: [
      entityType('person', 'Person', 'A person.'),
      entityType('organization', 'Organization', 'An organization or group.'),
      entityType('place', 'Place', 'A physical or conceptual location.'),
      entityType('document', 'Document', 'A note, document, publication, or artifact.'),
      entityType('event', 'Event', 'An event or occurrence.'),
      entityType('concept', 'Concept', 'An idea, topic, argument, or subject.'),
      entityType('project', 'Project', 'A coordinated body of work with an intended outcome.'),
      entityType('task', 'Task', 'An actionable unit of work.'),
      entityType('decision', 'Decision', 'A recorded choice or commitment.'),
      entityType('question', 'Question', 'An open or answered question.'),
      entityType('requirement', 'Requirement', 'A constraint or expected capability.'),
      entityType('metric', 'Metric', 'A measurable indicator or target.'),
      entityType('product', 'Product', 'A product, service, or deliverable.'),
      entityType('technology', 'Technology', 'A technology, protocol, library, or tool.'),
      entityType('other', 'Other', 'A source-grounded entity that fits no other hint.'),
    ],
    claimTypes: [
      claimType('factual_claim', 'Factual claim', 'A source-grounded factual statement.'),
      claimType(
        'interpretive_claim',
        'Interpretive claim',
        'A source-grounded interpretation.',
      ),
      claimType('evaluative_claim', 'Evaluative claim', 'A source-grounded evaluation.'),
      claimType('decision_claim', 'Decision', 'A source-grounded choice or commitment.'),
      claimType('hypothesis_claim', 'Hypothesis', 'A source-grounded tentative explanation.'),
      claimType('requirement_claim', 'Requirement', 'A source-grounded constraint or need.'),
      claimType('action_item_claim', 'Action item', 'A source-grounded action to perform.'),
    ],
    relationTypeHints: [
      relationType('related_to', 'Related to', 'A general source-stated association.'),
      relationType('part_of', 'Part of', 'A component or membership relation.'),
      relationType('depends_on', 'Depends on', 'A dependency relation.'),
      relationType('supports', 'Supports', 'Evidence or reasoning supports a target.'),
      relationType('contradicts', 'Contradicts', 'Evidence or reasoning conflicts with a target.'),
      relationType('causes', 'Causes', 'A source-stated causal relation.'),
      relationType('precedes', 'Precedes', 'A temporal ordering relation.'),
      relationType('follows', 'Follows', 'A temporal ordering relation.'),
      relationType('authored_by', 'Authored by', 'A document or artifact authorship relation.'),
      relationType('assigned_to', 'Assigned to', 'A work ownership relation.'),
      relationType('decided_by', 'Decided by', 'A decision ownership relation.'),
      relationType('blocks', 'Blocks', 'A blocking work relation.'),
      relationType('references', 'References', 'A direct source reference relation.'),
      relationType('implements', 'Implements', 'A realization of a requirement or design.'),
      relationType('measures', 'Measures', 'A metric measures a target.'),
    ],
    allowUnknownRelationTypes: true,
    extractionGuidelines:
      'Preserve source meaning, explicit negation, uncertainty, and temporal order. Keep unknown relations. Distinguish proposals and hypotheses from settled decisions or facts. Attach only directly supported references.',
  };
}

function entityType(
  id: KnowledgeEntityTypeId,
  label: string,
  description: string,
): KnowledgeEntityTypeHint {
  return { id, label, description };
}

function claimType(
  id: KnowledgeClaimTypeHint['id'],
  label: string,
  description: string,
): KnowledgeClaimTypeHint {
  return { id, label, description };
}

function relationType(
  id: string,
  label: string,
  description: string,
): KnowledgeRelationTypeHint {
  return { id, label, description };
}
