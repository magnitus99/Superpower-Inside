import type { Vault, TFile, DataAdapter } from 'obsidian';
import { t } from '../i18n';
import { isExcludedPathRust } from '../rag/rust-core';
import type { RAGConfig, ChatConfig } from '../settings';
import { isRecommendableExcludeExtension } from './rag-exclude-validation';

export interface RagFileTypeCount {
  extension: string;
  label: string;
  count: number;
}

export interface RagExcludeRecommendation extends RagFileTypeCount {
  reason: string;
}

export interface RagFileTypeSummary {
  targetTypes: RagFileTypeCount[];
  excludeRecommendations: RagExcludeRecommendation[];
  totalTargetFiles: number;
}

const DEFAULT_EXCLUDE_PATHS = [
  '.obsidian',
  '.superpower-inside',
  '.git',
  'node_modules',
  'attachments',
];
const SENSITIVE_FILE_NAMES = new Set(['.env']);
const SENSITIVE_EXTENSIONS = new Set(['env']);
const TEXT_EXTENSIONS = new Set([
  'md',
  'txt',
  'markdown',
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'json',
  'jsonc',
  'css',
  'scss',
  'sass',
  'less',
  'html',
  'htm',
  'xml',
  'svg',
  'py',
  'java',
  'go',
  'rs',
  'rb',
  'php',
  'cs',
  'cpp',
  'c',
  'h',
  'hpp',
  'swift',
  'kt',
  'kts',
  'sh',
  'bash',
  'zsh',
  'fish',
  'ps1',
  'sql',
  'csv',
  'tsv',
  'yaml',
  'yml',
  'toml',
  'ini',
  'conf',
  'config',
  'log',
  'gitignore',
  'dockerignore',
]);

/**
 * 볼트에서 마크다운 파일 목록을 가져오되, 제외 패턴을 적용합니다.
 */
export function getMarkdownFilesFiltered(vault: Vault, excludePatterns: string[]): TFile[] {
  const allFiles = vault.getMarkdownFiles();
  return allFiles.filter((file) => !isExcludedPath(file.path, excludePatterns));
}

export async function getRagCandidateFiles(
  vault: Vault,
  ragConfig: RAGConfig,
  chatConfig: ChatConfig,
): Promise<TFile[]> {
  const effectiveExcludePaths = getEffectiveExcludePaths(ragConfig, chatConfig);
  const candidates: TFile[] = [];

  for (const file of vault.getFiles()) {
    if (isExcludedPath(file.path, effectiveExcludePaths)) continue;
    if (isExcludedExt(file.path, ragConfig.excludeExts)) continue;
    if (await isRagIndexableFile(vault, file)) {
      candidates.push(file);
    }
  }

  return candidates;
}

export async function isRagIndexableFile(vault: Vault, file: TFile): Promise<boolean> {
  if (isSensitiveFile(file)) return false;
  if (file.stat.size === 0) return false;
  const extension = normalizeExtension(file.extension || getPathExtension(file.path));
  if (TEXT_EXTENSIONS.has(extension) || isKnownTextFileName(file.name)) return true;
  return canReadAsText(vault, file);
}

export async function getRagFileTypeSummary(
  vault: Vault,
  ragConfig: RAGConfig,
  chatConfig: ChatConfig,
): Promise<RagFileTypeSummary> {
  const effectiveExcludePaths = getEffectiveExcludePaths(ragConfig, chatConfig);
  const targetCounts = new Map<string, number>();
  const recommendationCounts = new Map<string, { count: number; reason: string }>();

  for (const file of vault.getFiles()) {
    if (isExcludedPath(file.path, effectiveExcludePaths)) continue;
    if (isExcludedExt(file.path, ragConfig.excludeExts)) continue;

    const extension = normalizeExtension(file.extension || getPathExtension(file.path));
    const key = extension || '(none)';
    if (await isRagIndexableFile(vault, file)) {
      targetCounts.set(key, (targetCounts.get(key) ?? 0) + 1);
      continue;
    }
    if (key !== '(none)' && !isRecommendableExcludeExtension(key)) {
      continue;
    }

    const existing = recommendationCounts.get(key);
    recommendationCounts.set(key, {
      count: (existing?.count ?? 0) + 1,
      reason: getExcludeRecommendationReason(file),
    });
  }

  const targetTypes = toSortedFileTypeCounts(targetCounts);
  const excludeRecommendations = [...recommendationCounts.entries()]
    .map(([extension, item]) => ({
      extension,
      label: getExtensionLabel(extension),
      count: item.count,
      reason: item.reason,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  return {
    targetTypes,
    excludeRecommendations,
    totalTargetFiles: targetTypes.reduce((sum, item) => sum + item.count, 0),
  };
}

/**
 * 주어진 경로가 제외 패턴에 매칭되는지 확인합니다.
 * 패턴은 폴더 이름(정확 매칭) 또는 glob-like 패턴을 지원합니다.
 */
export function isExcluded(filePath: string, patterns: string[]): boolean {
  return isExcludedPath(filePath, patterns);
}

export function isExcludedPath(filePath: string, patterns: readonly string[]): boolean {
  const rustResult = isExcludedPathRust(filePath, patterns);
  if (rustResult !== null) return rustResult;
  return isExcludedPathWithTypeScript(filePath, patterns);
}

function isExcludedPathWithTypeScript(filePath: string, patterns: readonly string[]): boolean {
  const lowerPath = normalizePath(filePath);
  for (const pattern of patterns) {
    const p = normalizePath(pattern);
    if (!p) continue;

    if (p.endsWith('/**')) {
      if (matchesPathSegment(lowerPath, p.slice(0, -3))) return true;
      continue;
    }

    if (p.startsWith('**/')) {
      if (matchesPathSegment(lowerPath, p.slice(3))) return true;
      continue;
    }

    if (p.includes('*')) {
      if (globToRegExp(p).test(lowerPath)) return true;
      continue;
    }

    if (matchesPathSegment(lowerPath, p)) {
      return true;
    }

    if (!p.includes('/') && lowerPath.endsWith('.' + p)) {
      return true;
    }
  }
  return false;
}

/**
 * 파일 확장자가 제외 목록에 있는지 확인합니다.
 */
export function isExcludedExt(filePath: string, excludeExts: string[]): boolean {
  const ext = normalizeExtension(getPathExtension(filePath));
  return excludeExts.map((e) => normalizeExtension(e)).includes(ext);
}

export function countFilesByExtensions(
  vault: Vault,
  extensions: readonly string[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const extension of extensions) {
    const normalized = normalizeExtension(extension);
    if (normalized) {
      counts[normalized] = 0;
    }
  }

  for (const file of vault.getFiles()) {
    const extension = normalizeExtension(file.extension);
    if (extension && Object.hasOwn(counts, extension)) {
      counts[extension]++;
    }
  }

  return counts;
}

function normalizeExtension(extension: string): string {
  return extension.trim().replace(/^\./, '').toLowerCase();
}

function normalizePath(path: string): string {
  return path
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
    .replace(/^\/+/, '')
    .toLowerCase();
}

function getPathExtension(filePath: string): string {
  const fileName = filePath.split('/').pop() ?? filePath;
  if (!fileName.includes('.') || (fileName.startsWith('.') && fileName.indexOf('.', 1) === -1)) {
    return '';
  }
  return fileName.split('.').pop() ?? '';
}

function matchesPathSegment(filePath: string, pattern: string): boolean {
  if (!pattern) return false;
  if (filePath === pattern) return true;
  if (filePath.startsWith(pattern + '/')) return true;
  if (filePath.endsWith('/' + pattern)) return true;
  return filePath.includes('/' + pattern + '/');
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '.*');
  return new RegExp(`(^|/)${escaped.replace(/\*/g, '[^/]*')}($|/)`);
}

function isKnownTextFileName(fileName: string): boolean {
  const normalized = fileName.toLowerCase();
  return TEXT_EXTENSIONS.has(normalized) || TEXT_EXTENSIONS.has(normalized.replace(/^\./, ''));
}

function isSensitiveFile(file: TFile): boolean {
  const name = file.name.toLowerCase();
  const extension = normalizeExtension(file.extension || getPathExtension(file.path));
  return (
    SENSITIVE_FILE_NAMES.has(name) ||
    name.startsWith('.env.') ||
    (extension !== '' && SENSITIVE_EXTENSIONS.has(extension))
  );
}

async function canReadAsText(vault: Vault, file: TFile): Promise<boolean> {
  try {
    const content = await vault.cachedRead(file);
    return isProbablyText(content.slice(0, 4096));
  } catch {
    return false;
  }
}

function isProbablyText(sample: string): boolean {
  if (!sample) return false;
  if (sample.includes('\u0000')) return false;
  let controlChars = 0;
  for (let i = 0; i < sample.length; i++) {
    const code = sample.charCodeAt(i);
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
      controlChars++;
    }
  }
  return controlChars / sample.length < 0.02;
}

function getExcludeRecommendationReason(file: TFile): string {
  if (isSensitiveFile(file)) {
    return t('ragExcludeSensitiveReason');
  }
  return t('ragExcludeUnreadableReason');
}

function toSortedFileTypeCounts(counts: Map<string, number>): RagFileTypeCount[] {
  return [...counts.entries()]
    .map(([extension, count]) => ({
      extension,
      label: getExtensionLabel(extension),
      count,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function getExtensionLabel(extension: string): string {
  return extension === '(none)' ? t('noExtensionLabel') : `.${extension}`;
}

/**
 * Vault adapter를 통해 JSON 파일을 원자적으로 씁니다.
 * 상위 디렉토리가 없으면 자동으로 생성합니다.
 * temp 파일에 먼저 쓴 후 rename하여 부분 쓰기로 인한 파일 손상을 방지합니다.
 */
export async function writeJsonToVault(
  adapter: DataAdapter,
  path: string,
  data: unknown,
): Promise<void> {
  const dir = path.split('/').slice(0, -1).join('/');
  if (dir) {
    await adapter.mkdir(dir);
  }
  const json = JSON.stringify(data);
  const tmpPath = `${path}.tmp.${Date.now()}`;
  await adapter.write(tmpPath, json);
  try {
    await adapter.rename(tmpPath, path);
  } catch (renameError) {
    try {
      if (await adapter.exists(path)) {
        await adapter.remove(path);
      }
      await adapter.rename(tmpPath, path);
    } catch (fallbackError) {
      try {
        await adapter.remove(tmpPath);
      } catch {
        // temp 파일 정리 실패는 무시
      }
      throw fallbackError instanceof Error ? fallbackError : renameError;
    }
  }
}

/**
 * Vault adapter를 통해 JSON 파일을 읽어 파싱합니다.
 * 파일이 없으면 null을 반환합니다.
 */
export async function readJsonFromVault(adapter: DataAdapter, path: string): Promise<unknown> {
  if (!(await adapter.exists(path))) {
    return null;
  }
  const raw = await adapter.read(path);
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export function getEffectiveExcludePaths(ragConfig: RAGConfig, chatConfig: ChatConfig): string[] {
  const paths = [...DEFAULT_EXCLUDE_PATHS, ...ragConfig.excludePaths];
  if (ragConfig.excludeChatFolder && chatConfig.saveFolder) {
    if (!paths.includes(chatConfig.saveFolder)) {
      paths.push(chatConfig.saveFolder);
    }
  }
  return paths;
}
