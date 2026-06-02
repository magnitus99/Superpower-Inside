import { t } from '../i18n';
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

export function getRejectedFactPresentation(
  fact: GraphRejectedFactRecord,
): RejectedFactPresentation {
  const presentation = getReasonPresentation(fact.reason);
  const rawText = stringifyRawFact(fact.rawFact);
  return {
    ...presentation,
    rawText,
    rawPreview: createRawPreview(rawText),
  };
}

function getReasonPresentation(reason: string): ReasonPresentation {
  switch (reason) {
    case 'invalid-json':
      return {
        errorCode: 'SPI-GRAPH-JSON-001',
        title: t('rejectedFactInvalidJsonTitle'),
        description: t('rejectedFactInvalidJsonDesc'),
      };
    case 'unknown-entity-type':
      return {
        errorCode: 'SPI-GRAPH-SCHEMA-ENTITY-001',
        title: t('rejectedFactUnknownEntityTitle'),
        description: t('rejectedFactUnknownEntityDesc'),
      };
    case 'schema-shape-mismatch':
      return {
        errorCode: 'SPI-GRAPH-SCHEMA-SHAPE-001',
        title: t('rejectedFactSchemaShapeTitle'),
        description: t('rejectedFactSchemaShapeDesc'),
      };
    case 'unknown-relation-entity':
      return {
        errorCode: 'SPI-GRAPH-SCHEMA-RELATION-001',
        title: t('rejectedFactUnknownRelationEntityTitle'),
        description: t('rejectedFactUnknownRelationEntityDesc'),
      };
    case 'relation-domain-range-mismatch':
      return {
        errorCode: 'SPI-GRAPH-SCHEMA-RELATION-002',
        title: t('rejectedFactRelationMismatchTitle'),
        description: t('rejectedFactRelationMismatchDesc'),
      };
    case 'unknown-claim-type':
      return {
        errorCode: 'SPI-GRAPH-SCHEMA-CLAIM-001',
        title: t('rejectedFactUnknownClaimTitle'),
        description: t('rejectedFactUnknownClaimDesc'),
      };
    case 'extraction-error':
      return {
        errorCode: 'SPI-GRAPH-EXTRACT-001',
        title: t('rejectedFactExtractionErrorTitle'),
        description: t('rejectedFactExtractionErrorDesc'),
      };
    default:
      return {
        errorCode: 'SPI-GRAPH-SCHEMA-001',
        title: t('rejectedFactDefaultTitle'),
        description: t('rejectedFactDefaultDesc'),
      };
  }
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
  if (!normalized) return t('rejectedFactEmptyResponse');
  return normalized.length <= 240 ? normalized : `${normalized.slice(0, 240)}...`;
}
