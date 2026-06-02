import type { GraphRejectedFactRecord } from './store';

export interface RejectedFactPresentation {
  errorCode: string;
  title: string;
  description: string;
  rawPreview: string;
  rawText: string;
}

interface ReasonPresentation {
  errorCode: string;
  title: string;
  description: string;
}

const REASON_PRESENTATIONS: Record<string, ReasonPresentation> = {
  'invalid-json': {
    errorCode: 'SPI-GRAPH-JSON-001',
    title: 'LLM 응답을 JSON으로 파싱할 수 없음',
    description:
      '모델이 GraphRAG 추출 스키마와 맞는 JSON 객체를 반환하지 않았습니다. OpenRouter/free 모델에서는 빈 응답, 설명문, 제한 문구, 잘린 응답이 섞이면 자주 발생합니다.',
  },
  'unknown-entity-type': {
    errorCode: 'SPI-GRAPH-SCHEMA-ENTITY-001',
    title: '알 수 없는 엔티티 타입',
    description: '모델이 현재 ontology schema에 없는 entity typeId를 반환했습니다.',
  },
  'schema-shape-mismatch': {
    errorCode: 'SPI-GRAPH-SCHEMA-SHAPE-001',
    title: 'JSON 구조가 GraphRAG 추출 스키마와 다름',
    description:
      '응답은 JSON으로 파싱됐지만 entities.name/typeId, relations.relationTypeId, claims.text/claimTypeId 같은 필수 필드 구조를 따르지 않았습니다.',
  },
  'unknown-relation-entity': {
    errorCode: 'SPI-GRAPH-SCHEMA-RELATION-001',
    title: '관계의 엔티티를 찾을 수 없음',
    description: '모델이 relation source/target에 쓴 이름이 같은 응답의 entities 목록과 매칭되지 않았습니다.',
  },
  'relation-domain-range-mismatch': {
    errorCode: 'SPI-GRAPH-SCHEMA-RELATION-002',
    title: '관계 타입의 source/target 타입 불일치',
    description: '모델이 ontology schema에서 허용하지 않는 entity type 조합으로 relation을 반환했습니다.',
  },
  'unknown-claim-type': {
    errorCode: 'SPI-GRAPH-SCHEMA-CLAIM-001',
    title: '알 수 없는 claim 타입',
    description: '모델이 현재 ontology schema에 없는 claimTypeId를 반환했습니다.',
  },
  'extraction-error': {
    errorCode: 'SPI-GRAPH-EXTRACT-001',
    title: '추출 호출 중 오류',
    description: 'LLM 호출, 네트워크, provider 응답 처리 중 예외가 발생했습니다.',
  },
};

const DEFAULT_PRESENTATION: ReasonPresentation = {
  errorCode: 'SPI-GRAPH-SCHEMA-001',
  title: 'GraphRAG 추출 결과가 schema 검증을 통과하지 못함',
  description: '모델 응답의 일부 fact가 현재 ontology schema 또는 저장소 검증 규칙과 맞지 않습니다.',
};

export function getRejectedFactPresentation(
  fact: GraphRejectedFactRecord,
): RejectedFactPresentation {
  const presentation = REASON_PRESENTATIONS[fact.reason] ?? DEFAULT_PRESENTATION;
  const rawText = stringifyRawFact(fact.rawFact);
  return {
    ...presentation,
    rawText,
    rawPreview: createRawPreview(rawText),
  };
}

export function buildRejectedFactCopyText(fact: GraphRejectedFactRecord): string {
  const presentation = getRejectedFactPresentation(fact);
  return [
    'Superpower Inside GraphRAG rejected fact',
    `errorCode: ${presentation.errorCode}`,
    `title: ${presentation.title}`,
    `reason: ${fact.reason}`,
    `filePath: ${fact.filePath}`,
    `entryId: ${fact.entryId}`,
    `updatedAt: ${new Date(fact.updatedAt).toISOString()}`,
    '',
    'description:',
    presentation.description,
    '',
    'rawFact:',
    presentation.rawText,
  ].join('\n');
}

function stringifyRawFact(rawFact: unknown): string {
  if (typeof rawFact === 'string') return rawFact;
  try {
    return JSON.stringify(rawFact, null, 2);
  } catch {
    return String(rawFact);
  }
}

function createRawPreview(rawText: string): string {
  const normalized = rawText.replace(/\s+/gu, ' ').trim();
  if (!normalized) return '(빈 응답)';
  return normalized.length <= 240 ? normalized : `${normalized.slice(0, 240)}...`;
}
