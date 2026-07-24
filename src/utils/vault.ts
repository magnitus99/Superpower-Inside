import type { Vault, TFile, DataAdapter } from 'obsidian';
import { t } from '../i18n';
import {
  isExcludedPathRust,
  countFilesByExtensionsRust,
  isExcludedExtRust,
  planRagFileContentProbeIndicesRust,
  planRagFileIndexabilityRust,
  planRagFileTypeSummaryRust,
  type RustRagFileEligibilityInput,
  type RustRagFileIndexabilityPlan,
  type RustRagFileTextProbeInput,
  type RustRagFileTypeInput,
} from '../rag/rust-core';
import type { RAGConfig, ChatConfig } from '../settings';
import { normalizeRustIndices, selectByRustIndices } from './rust-index-plan';

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
  '.superpower-inside',
  '.git',
  'node_modules',
  'attachments',
  '.venv',
  '__pycache__',
  '.codegraph',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '.playwright-mcp',
  '.playwright-cli',
];
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
  const effectiveExcludePaths = getEffectiveExcludePaths(ragConfig, chatConfig, vault.configDir);
  const files = vault.getFiles();
  const plan = await planRagFileIndexability(
    vault,
    files,
    effectiveExcludePaths,
    ragConfig.excludeExts,
  );
  return selectByRustIndices(files, plan.candidateIndices, { dedupe: true });
}

export async function isRagCandidateFile(
  vault: Vault,
  file: TFile,
  ragConfig: RAGConfig,
  chatConfig: ChatConfig,
): Promise<boolean> {
  const effectiveExcludePaths = getEffectiveExcludePaths(ragConfig, chatConfig, vault.configDir);
  const plan = await planRagFileIndexability(
    vault,
    [file],
    effectiveExcludePaths,
    ragConfig.excludeExts,
  );
  return selectByRustIndices([file], plan.candidateIndices, { dedupe: true }).length === 1;
}

export async function isRagIndexableFile(vault: Vault, file: TFile): Promise<boolean> {
  const plan = await planRagFileIndexability(vault, [file], [], []);
  return selectByRustIndices([file], plan.candidateIndices, { dedupe: true }).length === 1;
}

export async function getRagFileTypeSummary(
  vault: Vault,
  ragConfig: RAGConfig,
  chatConfig: ChatConfig,
): Promise<RagFileTypeSummary> {
  const effectiveExcludePaths = getEffectiveExcludePaths(ragConfig, chatConfig, vault.configDir);
  const plan = await planRagFileIndexability(
    vault,
    vault.getFiles(),
    effectiveExcludePaths,
    ragConfig.excludeExts,
  );
  const fileTypeInputs = plan.summaryInputs.map(localizeRagFileTypeInputReason);

  return (
    planRagFileTypeSummaryRust(fileTypeInputs, t('noExtensionLabel')) ?? {
      targetTypes: [],
      excludeRecommendations: [],
      totalTargetFiles: 0,
    }
  );
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
  return rustResult ?? false;
}

/**
 * 파일 확장자가 제외 목록에 있는지 확인합니다.
 */
export function isExcludedExt(filePath: string, excludeExts: string[]): boolean {
  const normalizedKeys = excludeExts.map((extension) =>
    extension.trim().toLowerCase().replace(/^\./, ''),
  );
  const normalizedFilePath = filePath.trim();

  const rustResult = isExcludedExtRust(normalizedFilePath, normalizedKeys);
  if (rustResult !== null) return rustResult;

  const pathExt = getPathExtension(normalizedFilePath).trim().toLowerCase();
  const normalizedPathExt = pathExt.startsWith('.') ? pathExt.slice(1) : pathExt;
  return normalizedKeys.includes(normalizedPathExt);
}

export function countFilesByExtensions(
  vault: Vault,
  extensions: readonly string[],
): Record<string, number> {
  const normalizedKeys = extensions
    .map((extension) => extension.trim().toLowerCase().replace(/^\./, ''))
    .filter((extension): extension is string => extension.length > 0);
  const fileExtensions = vault.getFiles().map((file) => file.extension);

  const rustResult = countFilesByExtensionsRust(fileExtensions, normalizedKeys);
  if (rustResult !== null) return rustResult;

  const counts: Record<string, number> = {};
  for (const extension of normalizedKeys) {
    counts[extension] = 0;
  }
  for (const fileExtension of fileExtensions) {
    const normalizedExtension = fileExtension.trim().toLowerCase();
    const noDot = normalizedExtension.startsWith('.')
      ? normalizedExtension.slice(1)
      : normalizedExtension;
    if (noDot && Object.hasOwn(counts, noDot)) {
      counts[noDot] += 1;
    }
  }

  return counts;
}

function getPathExtension(filePath: string): string {
  const fileName = filePath.split('/').pop() ?? filePath;
  if (!fileName.includes('.') || (fileName.startsWith('.') && fileName.indexOf('.', 1) === -1)) {
    return '';
  }
  return fileName.split('.').pop() ?? '';
}

async function planRagFileIndexability(
  vault: Vault,
  files: readonly TFile[],
  excludePaths: readonly string[],
  excludeExts: readonly string[],
): Promise<RustRagFileIndexabilityPlan> {
  const inputs = files.map(toRagFileEligibilityInput);
  const probeIndices = planRagFileContentProbeIndicesRust(inputs, excludePaths, excludeExts) ?? [];
  const textProbes = await readRagFileTextProbes(vault, files, probeIndices);
  return (
    planRagFileIndexabilityRust(inputs, excludePaths, excludeExts, textProbes) ?? {
      candidateIndices: [],
      summaryInputs: [],
    }
  );
}

async function readRagFileTextProbes(
  vault: Vault,
  files: readonly TFile[],
  probeIndices: readonly number[],
): Promise<RustRagFileTextProbeInput[]> {
  const probes: RustRagFileTextProbeInput[] = [];
  const normalizedProbeIndices = normalizeRustIndices(probeIndices, files.length, { dedupe: true });
  for (const index of normalizedProbeIndices) {
    const file = files[index];
    if (!file) continue;
    try {
      const content = await vault.cachedRead(file);
      probes.push({ index, readable: true, sample: content.slice(0, 4096) });
    } catch {
      probes.push({ index, readable: false, sample: '' });
    }
  }
  return probes;
}

function toRagFileEligibilityInput(file: TFile): RustRagFileEligibilityInput {
  return {
    filePath: file.path,
    fileName: file.name,
    extension: file.extension,
    size: file.stat.size,
  };
}

function localizeRagFileTypeInputReason(input: RustRagFileTypeInput): RustRagFileTypeInput {
  if (input.indexable || !input.recommendationReason) return input;
  return {
    ...input,
    recommendationReason:
      input.recommendationReason === 'sensitive'
        ? t('ragExcludeSensitiveReason')
        : t('ragExcludeUnreadableReason'),
  };
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

export function getEffectiveExcludePaths(
  ragConfig: RAGConfig,
  chatConfig: ChatConfig,
  configDir?: string,
): string[] {
  const paths = [...DEFAULT_EXCLUDE_PATHS];
  const normalizedConfigDir = configDir?.trim();
  if (normalizedConfigDir) {
    paths.push(normalizedConfigDir);
  }
  paths.push(...ragConfig.excludePaths);
  if (ragConfig.excludeChatFolder && chatConfig.saveFolder) {
    if (!paths.includes(chatConfig.saveFolder)) {
      paths.push(chatConfig.saveFolder);
    }
  }
  return paths;
}
