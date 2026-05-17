export type ExcludeValidationLevel = 'error' | 'warning';

export type ExcludeValidationCode =
  | 'empty'
  | 'trimmed'
  | 'duplicate'
  | 'comma'
  | 'path-backslash'
  | 'path-leading-slash'
  | 'path-missing'
  | 'extension-leading-dot'
  | 'extension-invalid'
  | 'extension-markdown';

export interface ExcludeValidationIssue {
  level: ExcludeValidationLevel;
  code: ExcludeValidationCode;
}

export interface ExcludeValidationResult {
  normalized: string;
  issues: ExcludeValidationIssue[];
  valid: boolean;
}

export function validateExcludePathInput(
  input: string,
  existingPaths: readonly string[],
  pathExists?: (path: string) => boolean,
): ExcludeValidationResult {
  const normalized = input.trim();
  const issues: ExcludeValidationIssue[] = [];

  if (!normalized) {
    issues.push({ level: 'error', code: 'empty' });
    return createResult(normalized, issues);
  }

  if (normalized !== input) {
    issues.push({ level: 'warning', code: 'trimmed' });
  }

  if (normalized.includes(',')) {
    issues.push({ level: 'error', code: 'comma' });
  }

  if (normalized.includes('\\')) {
    issues.push({ level: 'error', code: 'path-backslash' });
  }

  if (normalized.startsWith('/')) {
    issues.push({ level: 'error', code: 'path-leading-slash' });
  }

  if (hasDuplicate(normalized, existingPaths)) {
    issues.push({ level: 'error', code: 'duplicate' });
  }

  if (pathExists && !pathExists(normalized)) {
    issues.push({ level: 'warning', code: 'path-missing' });
  }

  return createResult(normalized, issues);
}

export function validateExcludeExtensionInput(
  input: string,
  existingExtensions: readonly string[],
): ExcludeValidationResult {
  const trimmed = input.trim();
  const issues: ExcludeValidationIssue[] = [];

  if (!trimmed) {
    issues.push({ level: 'error', code: 'empty' });
    return createResult(trimmed, issues);
  }

  if (trimmed !== input) {
    issues.push({ level: 'warning', code: 'trimmed' });
  }

  if (trimmed.includes(',')) {
    issues.push({ level: 'error', code: 'comma' });
  }

  const withoutLeadingDot = trimmed.startsWith('.') ? trimmed.slice(1) : trimmed;
  if (withoutLeadingDot !== trimmed) {
    issues.push({ level: 'warning', code: 'extension-leading-dot' });
  }

  const normalized = withoutLeadingDot.toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(normalized)) {
    issues.push({ level: 'error', code: 'extension-invalid' });
  }

  if (hasDuplicate(normalized, existingExtensions)) {
    issues.push({ level: 'error', code: 'duplicate' });
  }

  if (normalized === 'md') {
    issues.push({ level: 'warning', code: 'extension-markdown' });
  }

  return createResult(normalized, issues);
}

function createResult(
  normalized: string,
  issues: ExcludeValidationIssue[],
): ExcludeValidationResult {
  return {
    normalized,
    issues,
    valid: !issues.some((issue) => issue.level === 'error'),
  };
}

function hasDuplicate(value: string, existingValues: readonly string[]): boolean {
  const normalizedValue = value.toLowerCase();
  return existingValues.some((item) => item.trim().toLowerCase() === normalizedValue);
}
