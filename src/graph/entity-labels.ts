import { normalizeEntityNameRust } from '../rag/rust-core';

export type GraphEntityLabelLanguage = string;
export type GraphEntityLabelKind = 'preferred' | 'alias' | 'hidden';
export type GraphEntityLabelSource = 'canonical' | 'llm-extraction' | 'legacy-alias' | 'manual' | 'imported';

export interface GraphEntityLabelRecord {
  value: string;
  language: GraphEntityLabelLanguage;
  kind: GraphEntityLabelKind;
  source: GraphEntityLabelSource;
  confidence: number;
  evidenceIds: string[];
}

export interface GraphEntityLabelCarrier {
  canonicalName: string;
  aliases: readonly string[];
  labels?: readonly GraphEntityLabelRecord[];
}

export interface GraphEntityLabelInput {
  canonicalName: string;
  aliases: readonly string[];
  confidence: number;
  evidenceId?: string;
  source: GraphEntityLabelSource;
}

const CONFIDENCE_FALLBACK = 0.5;

export function createGraphEntityLabels(input: GraphEntityLabelInput): GraphEntityLabelRecord[] {
  return mergeGraphEntityLabels(
    [
      createLabelRecord({
        value: input.canonicalName,
        kind: 'preferred',
        source: input.source,
        confidence: input.confidence,
        evidenceIds: evidenceIdsForLabel(input.evidenceId),
      }),
    ],
    input.aliases.map((alias) =>
      createLabelRecord({
        value: alias,
        kind: 'alias',
        source: input.source,
        confidence: input.confidence,
        evidenceIds: evidenceIdsForLabel(input.evidenceId),
      }),
    ),
  ) ?? [];
}

export function mergeGraphEntityLabels(
  left: readonly GraphEntityLabelRecord[] | undefined,
  right: readonly GraphEntityLabelRecord[] | undefined,
): GraphEntityLabelRecord[] | undefined {
  const merged: GraphEntityLabelRecord[] = [];
  const indexByKey = new Map<string, number>();
  for (const label of [...(left ?? []), ...(right ?? [])]) {
    const normalized = normalizeLabelRecord(label);
    if (!normalized) continue;
    const key = graphEntityLabelKey(normalized);
    const existingIndex = indexByKey.get(key);
    if (existingIndex === undefined) {
      indexByKey.set(key, merged.length);
      merged.push(normalized);
      continue;
    }
    const existing = merged[existingIndex];
    if (!existing) continue;
    merged[existingIndex] = {
      ...existing,
      source: preferLabelSource(existing.source, normalized.source),
      confidence: Math.max(existing.confidence, normalized.confidence),
      evidenceIds: mergeOrderedStrings(existing.evidenceIds, normalized.evidenceIds),
    };
  }
  return merged.length > 0 ? merged : undefined;
}

export function copyGraphEntityLabels(
  labels: readonly GraphEntityLabelRecord[] | undefined,
): GraphEntityLabelRecord[] | undefined {
  const normalized = mergeGraphEntityLabels(labels, []);
  return normalized?.map((label) => ({
    ...label,
    evidenceIds: [...label.evidenceIds],
  }));
}

export function getEntityLabelValues(entity: GraphEntityLabelCarrier): string[] {
  return mergeOrderedStrings(
    [entity.canonicalName, ...entity.aliases],
    (entity.labels ?? []).map((label) => label.value),
  ).filter((value) => value.trim().length > 0);
}

export function getEntitySearchAliases(entity: GraphEntityLabelCarrier): string[] {
  const canonical = normalizeGraphEntityLabelValue(entity.canonicalName);
  return getEntityLabelValues(entity).filter(
    (value) => normalizeGraphEntityLabelValue(value) !== canonical,
  );
}

export function getEntityDisplayAliases(entity: GraphEntityLabelCarrier): string[] {
  const canonical = normalizeGraphEntityLabelValue(entity.canonicalName);
  return getEntityLabelValues(entity).filter(
    (value) => normalizeGraphEntityLabelValue(value) !== canonical,
  );
}

export function hasExactGraphEntityLabelMatch(
  leftValues: readonly string[],
  rightValues: readonly string[],
): boolean {
  const right = new Set(rightValues.map(normalizeGraphEntityLabelValue).filter(Boolean));
  return leftValues.map(normalizeGraphEntityLabelValue).some((value) => right.has(value));
}

export function hasCrossLanguageGraphEntityLabelPair(
  leftValues: readonly string[],
  rightValues: readonly string[],
): boolean {
  const leftLanguages = collectComparableLanguages(leftValues);
  const rightLanguages = collectComparableLanguages(rightValues);
  if (leftLanguages.size === 0 || rightLanguages.size === 0) return false;
  for (const language of leftLanguages) {
    if (rightLanguages.has(language)) return false;
  }
  return true;
}

export function inferGraphEntityLabelLanguage(value: string): GraphEntityLabelLanguage {
  let hasHangul = false;
  let hasKana = false;
  let hasCjk = false;
  let hasCyrillic = false;
  let hasArabic = false;
  let hasHebrew = false;
  let hasGreek = false;
  let hasDevanagari = false;
  let hasThai = false;
  let hasAsciiLetter = false;
  for (const character of value) {
    if (isHangul(character)) hasHangul = true;
    if (isKana(character)) hasKana = true;
    if (isCjkIdeograph(character)) hasCjk = true;
    if (isCyrillic(character)) hasCyrillic = true;
    if (isArabic(character)) hasArabic = true;
    if (isHebrew(character)) hasHebrew = true;
    if (isGreek(character)) hasGreek = true;
    if (isDevanagari(character)) hasDevanagari = true;
    if (isThai(character)) hasThai = true;
    if (/[a-z]/i.test(character)) hasAsciiLetter = true;
  }
  const inferredLanguages = [
    hasHangul ? 'ko' : '',
    hasKana ? 'ja' : '',
    hasCjk && !hasKana ? 'zh' : '',
    hasCyrillic ? 'cyrillic' : '',
    hasArabic ? 'ar' : '',
    hasHebrew ? 'he' : '',
    hasGreek ? 'el' : '',
    hasDevanagari ? 'hi' : '',
    hasThai ? 'th' : '',
    hasAsciiLetter ? 'en' : '',
  ].filter(Boolean);
  if (inferredLanguages.length > 1) return 'mixed';
  if (inferredLanguages.length === 1) return inferredLanguages[0] ?? 'unknown';
  if (hasHangul) return 'ko';
  return 'unknown';
}

export function normalizeGraphEntityLabelValue(value: string): string {
  return normalizeEntityNameRust(value) ?? normalizeGraphEntityLabelValueFallback(value);
}

function createLabelRecord(input: {
  value: string;
  kind: GraphEntityLabelKind;
  source: GraphEntityLabelSource;
  confidence: number;
  evidenceIds: readonly string[];
}): GraphEntityLabelRecord {
  return {
    value: input.value,
    language: inferGraphEntityLabelLanguage(input.value),
    kind: input.kind,
    source: input.source,
    confidence: normalizeConfidence(input.confidence),
    evidenceIds: [...input.evidenceIds],
  };
}

function normalizeLabelRecord(label: GraphEntityLabelRecord): GraphEntityLabelRecord | null {
  const value = label.value.trim();
  if (value.length === 0) return null;
  return {
    value,
    language: label.language,
    kind: label.kind,
    source: label.source,
    confidence: normalizeConfidence(label.confidence),
    evidenceIds: mergeOrderedStrings(label.evidenceIds, []),
  };
}

function graphEntityLabelKey(label: GraphEntityLabelRecord): string {
  return [
    normalizeGraphEntityLabelValue(label.value),
    label.language,
    label.kind,
  ].join('\0');
}

function collectComparableLanguages(values: readonly string[]): Set<GraphEntityLabelLanguage> {
  const languages = new Set<GraphEntityLabelLanguage>();
  for (const value of values) {
    const language = inferGraphEntityLabelLanguage(value);
    if (language !== 'unknown' && language !== 'mixed') {
      languages.add(language);
    }
  }
  return languages;
}

function evidenceIdsForLabel(evidenceId: string | undefined): string[] {
  return evidenceId ? [evidenceId] : [];
}

function preferLabelSource(
  left: GraphEntityLabelSource,
  right: GraphEntityLabelSource,
): GraphEntityLabelSource {
  const priority: Record<GraphEntityLabelSource, number> = {
    manual: 5,
    imported: 4,
    'llm-extraction': 3,
    canonical: 2,
    'legacy-alias': 1,
  };
  return priority[right] > priority[left] ? right : left;
}

function normalizeConfidence(value: number): number {
  if (!Number.isFinite(value)) return CONFIDENCE_FALLBACK;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function mergeOrderedStrings(left: readonly string[], right: readonly string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const value of [...left, ...right]) {
    if (seen.has(value)) continue;
    seen.add(value);
    merged.push(value);
  }
  return merged;
}

function isHangul(character: string): boolean {
  const codePoint = character.codePointAt(0);
  return codePoint !== undefined && codePoint >= 0xac00 && codePoint <= 0xd7a3;
}

function isKana(character: string): boolean {
  const codePoint = character.codePointAt(0);
  return (
    codePoint !== undefined &&
    ((codePoint >= 0x3040 && codePoint <= 0x30ff) || (codePoint >= 0x31f0 && codePoint <= 0x31ff))
  );
}

function isCjkIdeograph(character: string): boolean {
  const codePoint = character.codePointAt(0);
  return codePoint !== undefined && codePoint >= 0x4e00 && codePoint <= 0x9fff;
}

function isCyrillic(character: string): boolean {
  const codePoint = character.codePointAt(0);
  return codePoint !== undefined && codePoint >= 0x0400 && codePoint <= 0x04ff;
}

function isArabic(character: string): boolean {
  const codePoint = character.codePointAt(0);
  return codePoint !== undefined && codePoint >= 0x0600 && codePoint <= 0x06ff;
}

function isHebrew(character: string): boolean {
  const codePoint = character.codePointAt(0);
  return codePoint !== undefined && codePoint >= 0x0590 && codePoint <= 0x05ff;
}

function isGreek(character: string): boolean {
  const codePoint = character.codePointAt(0);
  return codePoint !== undefined && codePoint >= 0x0370 && codePoint <= 0x03ff;
}

function isDevanagari(character: string): boolean {
  const codePoint = character.codePointAt(0);
  return codePoint !== undefined && codePoint >= 0x0900 && codePoint <= 0x097f;
}

function isThai(character: string): boolean {
  const codePoint = character.codePointAt(0);
  return codePoint !== undefined && codePoint >= 0x0e00 && codePoint <= 0x0e7f;
}

function normalizeGraphEntityLabelValueFallback(value: string): string {
  let normalized = '';
  let lastWasSpace = true;
  for (const character of value.trim().toLowerCase()) {
    if (isLabelSeparator(character) || /\s/.test(character)) {
      if (!lastWasSpace) {
        normalized += ' ';
        lastWasSpace = true;
      }
      continue;
    }
    normalized += character;
    lastWasSpace = false;
  }
  return normalized.endsWith(' ') ? normalized.slice(0, -1) : normalized;
}

function isLabelSeparator(character: string): boolean {
  return '_/\\|()[]{}"\'「」『』【】《》.,;:!?'.includes(character);
}
