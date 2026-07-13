export type KnowledgeEntityTypeId =
  | 'person'
  | 'organization'
  | 'place'
  | 'document'
  | 'event'
  | 'concept'
  | 'other';

export interface KnowledgeEntityTypeHint {
  id: KnowledgeEntityTypeId;
  label: string;
  description: string;
}

export interface KnowledgeClaimTypeHint {
  id: 'factual_claim' | 'interpretive_claim' | 'evaluative_claim';
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
  extractionGuidelines: string;
}

export function buildKnowledgeGraphContract(): KnowledgeGraphContract {
  return {
    id: 'knowledge-graph',
    name: 'Knowledge graph contract',
    version: 1,
    locale: 'mixed',
    description: 'Evidence-grounded, domain-neutral graph extraction contract.',
    entityTypes: [
      entityType('person', 'Person', 'A person.'),
      entityType('organization', 'Organization', 'An organization or group.'),
      entityType('place', 'Place', 'A physical or conceptual location.'),
      entityType('document', 'Document', 'A note, document, publication, or artifact.'),
      entityType('event', 'Event', 'An event or occurrence.'),
      entityType('concept', 'Concept', 'An idea, topic, argument, or subject.'),
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
    ],
    extractionGuidelines:
      'Preserve source meaning, keep unknown relations, and attach only directly supported references.',
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
