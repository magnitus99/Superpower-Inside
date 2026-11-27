import type { Vault, TFile, DataAdapter, EventRef } from 'obsidian';
import { getFrontMatterInfo, parseYaml, TFolder } from 'obsidian';
import { t } from '../i18n';
import {
  decodeSourceBytesRust,
  TEXT_DECODER_VERSION,
  isExcludedPathRust,
  countFilesByExtensionsRust,
  planExcludePathMetadataRust,
  isExcludedExtRust,
  isRagFrontmatterExcludedRust,
  planRagFileContentProbeIndicesRust,
  planRagFileIndexabilityRust,
  planRagIndexingManifestRust,
  planRagFileTypeSummaryRust,
  type RustRagFileEligibilityInput,
  type RustRagFileIndexabilityPlan,
  type RustRagFileTextProbeInput,
  type RustSourceRevision,
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

export type ExcludePathEntryKind = 'folder' | 'pattern';

export interface ExcludePathMatch {
  path: string;
  fileCount: number;
  sizeBytes: number;
  latestMtimeMs: number | null;
}

export interface ExcludePathMetadata {
  entry: string;
  kind: ExcludePathEntryKind;
  displayPath: string;
  exists: boolean;
  matches: ExcludePathMatch[];
  matchCount: number;
  totalFileCount: number;
  totalSizeBytes: number;
  latestMtimeMs: number | null;
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

export interface RagFileFailure {
  file: TFile;
  reason: string;
}

/** 본문 없는 단일 스캔 manifest. 허용 자료 수는 candidates + failures이며 제외와 바이너리는 별도다. */
export interface RagFileInventory {
  candidates: TFile[];
  failures: RagFileFailure[];
  emptyFiles: TFile[];
  policyExcluded: TFile[];
  unsupported: TFile[];
  totalVaultFiles: number;
}

export type RagIndexingVerdict =
  | { kind: 'candidate' | 'policy-excluded' | 'unsupported'; mtime: number; size: number }
  | { kind: 'failed'; mtime: number; size: number; reason: string };

/** 후보는 아직 byte 검증 전입니다. 일반 inventory API의 검증 의미와 구별합니다. */
export interface RagIndexingManifest extends RagFileInventory {
  verification: 'metadata-only';
  verdicts: Map<string, RagIndexingVerdict>;
  isCurrent(): boolean;
}

const indexingManifestOwners = new WeakMap<RagIndexingManifest, { current(): boolean; snapshots: Map<TFile, RagProbeSnapshot> }>();

export function getRagIndexingManifest(vault: Vault, ragConfig: RAGConfig, chatConfig: ChatConfig): RagIndexingManifest {
  const files = vault.getFiles();
  const policy = readRagEligibilityPolicy(vault, ragConfig, chatConfig);
  const cache = getRagEligibilityCache(vault);
  const revision = cache.revision;
  const snapshots = files.map(probeSnapshot);
  const plan = planRagIndexingManifestRust(files.map(toRagFileEligibilityInput), policy.excludePaths, policy.excludeExts);
  if (!plan) throw new Error('Rust source indexing manifest is unavailable (regenerate WASM).');
  const ownerCurrent = (): boolean => !cache.disposed && cache.revision === revision && JSON.stringify(policy) === JSON.stringify(readRagEligibilityPolicy(vault, ragConfig, chatConfig));
  const manifest: RagIndexingManifest = {
    verification: 'metadata-only', verdicts: new Map(),
    candidates: selectByRustIndices(files, plan.candidateIndices, { dedupe: true }),
    failures: plan.failures.map(({ index, reason }) => ({ file: files[index], reason })),
    emptyFiles: selectByRustIndices(files, plan.emptyIndices, { dedupe: true }),
    policyExcluded: selectByRustIndices(files, plan.policyExcludedIndices, { dedupe: true }),
    unsupported: [], totalVaultFiles: files.length,
    isCurrent: () => {
      const live = vault.getFiles();
      return cache.reusable && ownerCurrent() && files.length === live.length && snapshots.every((snapshot, index) => live[index] === snapshot.file && sameProbeSnapshot(snapshot, probeSnapshot(snapshot.file)));
    },
  };
  indexingManifestOwners.set(manifest, { current: ownerCurrent, snapshots: new Map(snapshots.map((snapshot) => [snapshot.file, snapshot])) });
  // metadata-only는 새 byte I/O를 하지 않지만 같은 이벤트 owner의 실제 verdict는 재사용합니다.
  if (cache.reusable) manifest.candidates = manifest.candidates.filter((file) => {
    const entry = cache.entries.get(file.path);
    if (!entry?.verdict?.reusable || !sameProbeSnapshot(entry.snapshot, probeSnapshot(file))) return true;
    const verdict = entry.verdict;
    if (verdict.reason === 'binary') { manifest.unsupported.push(file); return false; }
    if (verdict.textValid) {
      const excluded = isRagFrontmatterExcludedRust(verdict.metadata.frontmatter);
      if (excluded === true) { manifest.policyExcluded.push(file); return false; }
      if (excluded === false) manifest.verdicts.set(file.path, { kind: 'candidate', mtime: file.stat.mtime, size: file.stat.size });
    }
    return true;
  });
  return manifest;
}

/** 경로·확장자·민감 파일 정책만 확인합니다. YAML은 준비한 현재 본문으로 별도 검사합니다. */
export function isRagFileMetadataExcluded(vault: Vault, file: TFile, ragConfig: RAGConfig, chatConfig: ChatConfig): boolean {
  const policy = readRagEligibilityPolicy(vault, ragConfig, chatConfig);
  const plan = planRagIndexingManifestRust([toRagFileEligibilityInput(file)], policy.excludePaths, policy.excludeExts);
  if (!plan) throw new Error('Rust source policy is unavailable.');
  return plan.policyExcludedIndices.length > 0;
}

export function getRagPreparedContentVerdict(vault: Vault, file: TFile, content: string, ragConfig: RAGConfig, chatConfig: ChatConfig): { kind: 'candidate' | 'policy-excluded' | 'failed'; reason?: string } {
  if (isRagFileMetadataExcluded(vault, file, ragConfig, chatConfig)) return { kind: 'policy-excluded' };
  const metadata = parseRagFrontmatterContent(file, content);
  if (metadata.frontmatterUnreadable) return { kind: 'failed', reason: 'frontmatter-unreadable' };
  const excluded = isRagFrontmatterExcludedRust(metadata.frontmatter);
  if (excluded === null) return { kind: 'failed', reason: 'frontmatter-unavailable' };
  return { kind: excluded ? 'policy-excluded' : 'candidate' };
}

export function recordRagIndexingVerdict(inventory: RagFileInventory | undefined, file: TFile, verdict: Omit<RagIndexingVerdict, 'mtime' | 'size'> & { reason?: string }): void {
  if (!inventory || !('verification' in inventory) || inventory.verification !== 'metadata-only') return;
  const manifest = inventory as RagIndexingManifest;
  const owner = indexingManifestOwners.get(manifest);
  const snapshot = owner?.snapshots.get(file);
  if (!owner?.current() || !snapshot || !sameProbeSnapshot(snapshot, probeSnapshot(file))) return;
  if (verdict.kind === 'failed') manifest.verdicts.set(file.path, { kind: 'failed', mtime: file.stat.mtime, size: file.stat.size, reason: verdict.reason ?? 'preparation-failed' });
  else manifest.verdicts.set(file.path, { kind: verdict.kind, mtime: file.stat.mtime, size: file.stat.size });
}

/** 기존 vector 행이 있어도 아직 byte 판정하지 않은 후보는 준비해야 합니다. */
export function getRagUnverifiedIndexingFiles(inventory: RagFileInventory): readonly TFile[] {
  if (!('verification' in inventory) || inventory.verification !== 'metadata-only') return [];
  const manifest = inventory as RagIndexingManifest;
  if (!manifest.isCurrent()) return manifest.candidates;
  return manifest.candidates.filter((file) => {
    const verdict = manifest.verdicts.get(file.path);
    return !verdict || verdict.kind !== 'candidate' || verdict.mtime !== file.stat.mtime || verdict.size !== file.stat.size;
  });
}

/** 완료 proof에는 모든 후보가 실제 판정되고 같은 이벤트 epoch인 경우만 반환합니다. */
export function getSettledRagIndexingInventory(manifest: RagIndexingManifest): RagFileInventory | null {
  if (!manifest.isCurrent()) return null;
  const inventory: RagFileInventory = { candidates: [], failures: [...manifest.failures], emptyFiles: [...manifest.emptyFiles], policyExcluded: [...manifest.policyExcluded], unsupported: [...manifest.unsupported], totalVaultFiles: manifest.totalVaultFiles };
  for (const file of manifest.candidates) {
    const verdict = manifest.verdicts.get(file.path);
    if (!verdict || verdict.mtime !== file.stat.mtime || verdict.size !== file.stat.size) return null;
    if (verdict.kind === 'failed') inventory.failures.push({ file, reason: verdict.reason });
    else if (verdict.kind === 'candidate') inventory.candidates.push(file);
    else if (verdict.kind === 'unsupported') inventory.unsupported.push(file);
    else inventory.policyExcluded.push(file);
  }
  return inventory;
}

export async function getRagFileInventory(
  vault: Vault,
  ragConfig: RAGConfig,
  chatConfig: ChatConfig,
): Promise<RagFileInventory> {
  const files = vault.getFiles();
  const plan = await planRagFileIndexability(vault, files, () =>
    readRagEligibilityPolicy(vault, ragConfig, chatConfig),
  );
  return {
    candidates: selectByRustIndices(files, plan.candidateIndices, { dedupe: true }),
    failures: plan.failures.map(({ index, reason }) => ({ file: files[index], reason })),
    emptyFiles: selectByRustIndices(files, plan.emptyIndices, { dedupe: true }),
    policyExcluded: selectByRustIndices(files, plan.policyExcludedIndices, { dedupe: true }),
    unsupported: selectByRustIndices(files, plan.unsupportedIndices, { dedupe: true }),
    totalVaultFiles: files.length,
  };
}

export async function getRagCandidateFiles(
  vault: Vault,
  ragConfig: RAGConfig,
  chatConfig: ChatConfig,
): Promise<TFile[]> {
  try {
    return (await getRagFileInventory(vault, ragConfig, chatConfig)).candidates;
  } catch (error) {
    // 기존 후보 API의 dispose 중 빈 목록 계약만 유지하고 manifest/status는 취소를 전파한다.
    if (error instanceof DOMException && error.name === 'AbortError') return [];
    throw error;
  }
}

export async function isRagCandidateFile(
  vault: Vault,
  file: TFile,
  ragConfig: RAGConfig,
  chatConfig: ChatConfig,
): Promise<boolean> {
  const plan = await planRagFileIndexability(vault, [file], () =>
    readRagEligibilityPolicy(vault, ragConfig, chatConfig),
  );
  return selectByRustIndices([file], plan.candidateIndices, { dedupe: true }).length === 1;
}

export async function isRagIndexableFile(vault: Vault, file: TFile): Promise<boolean> {
  const plan = await planRagFileIndexability(vault, [file], () => ({
    excludePaths: [],
    excludeExts: [],
  }));
  return selectByRustIndices([file], plan.candidateIndices, { dedupe: true }).length === 1;
}

/**
 * 사용자가 직접 지정한 파일을 읽을 수 있는지 확인합니다.
 *
 * 확장자 제외는 자동 검색·인덱싱 범위를 줄이는 설정이므로 명시 참조에는 적용하지 않습니다.
 * 경로 제외·민감 파일·YAML 제외·크기·이진 형식 제한은 그대로 유지합니다.
 */
export async function isExplicitRagReadAllowed(
  vault: Vault,
  file: TFile,
  ragConfig: RAGConfig,
  chatConfig: ChatConfig,
): Promise<boolean> {
  if (isExcludedPath(file.path, getEffectiveExcludePaths(ragConfig, chatConfig, vault.configDir)))
    return false;
  return isRagIndexableFile(vault, file);
}

/** 개별 작업에서도 경로·확장자·현재 YAML 제외를 다시 확인합니다. */
export async function isRagFileExcluded(
  vault: Vault,
  file: TFile,
  ragConfig: RAGConfig,
  chatConfig: ChatConfig,
): Promise<boolean> {
  if (
    isExcludedPath(file.path, getEffectiveExcludePaths(ragConfig, chatConfig, vault.configDir)) ||
    isExcludedExt(file.path, ragConfig.excludeExts)
  )
    return true;
  const metadata = await readRagFrontmatter(vault, file);
  return (
    metadata.frontmatterUnreadable === true ||
    isRagFrontmatterExcludedRust(metadata.frontmatter) !== false
  );
}

/** 이미 읽은 본문이 있을 때 추가 디스크 I/O 없이 경로·확장자·YAML 제외를 즉시 확인합니다. */
export function isRagFileExcludedWithContent(
  vault: Vault,
  file: TFile,
  content: string,
  ragConfig: RAGConfig,
  chatConfig: ChatConfig,
): boolean {
  if (
    isExcludedPath(file.path, getEffectiveExcludePaths(ragConfig, chatConfig, vault.configDir)) ||
    isExcludedExt(file.path, ragConfig.excludeExts)
  )
    return true;
  const metadata = parseRagFrontmatterContent(file, content);
  return (
    metadata.frontmatterUnreadable === true ||
    isRagFrontmatterExcludedRust(metadata.frontmatter) !== false
  );
}

export async function getRagFileTypeSummary(
  vault: Vault,
  ragConfig: RAGConfig,
  chatConfig: ChatConfig,
): Promise<RagFileTypeSummary> {
  const plan = await planRagFileIndexability(vault, vault.getFiles(), () =>
    readRagEligibilityPolicy(vault, ragConfig, chatConfig),
  );
  const summary = planRagFileTypeSummaryRust(plan.summaryInputs, t('noExtensionLabel'));
  if (!summary) throw new Error('Rust file type summary is unavailable.');
  return {
    ...summary,
    excludeRecommendations: summary.excludeRecommendations.map(localizeRagExcludeRecommendation),
  };
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
  excludePaths: readonly string[] = [],
): Record<string, number> {
  const normalizedKeys = extensions
    .map((extension) => extension.trim().toLowerCase().replace(/^\./, ''))
    .filter((extension): extension is string => extension.length > 0);
  const fileExtensions = vault
    .getFiles()
    .filter((file) => isExcludedPathRust(file.path, excludePaths) === false)
    .map((file) => file.extension);

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

/**
 * 설정의 제외 경로 항목 하나에 대해 팝오버가 표시할 메타데이터를 계산합니다.
 *
 * 매칭·집계·정렬은 Rust/WASM이 담당하며, 이 함수는 볼트 API 결과를 wire 형식으로
 * 옮기기만 합니다. Rust 코어를 쓸 수 없으면 계산을 대체하지 않고 빈 결과를 돌려줍니다.
 */
export function getExcludePathMetadata(vault: Vault, value: string): ExcludePathMetadata {
  const folders = vault
    .getAllLoadedFiles()
    .filter((entry): entry is TFolder => entry instanceof TFolder)
    .map((folder) => folder.path);
  const files = vault.getFiles().map((file) => ({
    path: file.path,
    sizeBytes: file.stat.size,
    mtimeMs: file.stat.mtime,
  }));

  return (
    planExcludePathMetadataRust(value, folders, files) ?? createEmptyExcludePathMetadata(value)
  );
}

/** Rust 코어를 쓸 수 없을 때 돌려줄 빈 메타데이터입니다. */
function createEmptyExcludePathMetadata(value: string): ExcludePathMetadata {
  return {
    entry: value,
    kind: value.includes('*') || value.includes('?') ? 'pattern' : 'folder',
    displayPath: value.trim(),
    exists: false,
    matches: [],
    matchCount: 0,
    totalFileCount: 0,
    totalSizeBytes: 0,
    latestMtimeMs: null,
  };
}

function getPathExtension(filePath: string): string {
  const fileName = filePath.split('/').pop() ?? filePath;
  if (!fileName.includes('.') || (fileName.startsWith('.') && fileName.indexOf('.', 1) === -1)) {
    return '';
  }
  return fileName.split('.').pop() ?? '';
}

// 부분 바이트 API가 없어 전체 파일을 읽으므로 최소 안전 큐로 제한합니다.
const VAULT_READ_CONCURRENCY = 1;

type RagFrontmatter = Pick<RustRagFileEligibilityInput, 'frontmatter' | 'frontmatterUnreadable'>;
interface RagProbeVerdict {
  contentHash?: string;
  sourceMetadataHash?: string;
  readable: boolean;
  textValid: boolean;
  reason?: string;
  metadata: RagFrontmatter;
  reusable: boolean;
}
interface RagProbeSnapshot {
  file: TFile;
  path: string;
  extension: string;
  mtime: number;
  size: number;
  decoder: typeof decodeSourceBytesRust;
  decoderVersion: string;
}
interface RagProbeEntry {
  snapshot: RagProbeSnapshot;
  result: Promise<RagProbeVerdict>;
  verdict?: RagProbeVerdict;
  users: number;
}
interface RagEligibilityCache {
  sourceEpochs: Map<string, object>;
  entries: Map<string, RagProbeEntry>;
  refs: EventRef[];
  reusable: boolean;
  disposed: boolean;
  revision: number;
  queue: Promise<void>;
}

// 본문·바이트·디코딩 결과 객체는 저장하지 않는다. 모듈 교체 시 WeakMap도 새로 생성된다.
const ragEligibilityCaches = new WeakMap<Vault, RagEligibilityCache>();

/** 플러그인 unload에서 호출한다. 구독과 판정을 폐기하고 진행 중인 이전 epoch 게시도 막는다. */
export function disposeRagFileEligibilityCache(vault: Vault): void {
  const cache = ragEligibilityCaches.get(vault);
  if (!cache) return;
  cache.disposed = true;
  cache.entries.clear();
  cache.sourceEpochs.clear();
  for (const ref of cache.refs) vault.offref(ref);
  cache.refs.length = 0;
  // 진행 중 read가 끝나기 전에 재초기화되어도 같은 vault의 큐 1 상한을 유지한다.
}

function getRagEligibilityCache(vault: Vault): RagEligibilityCache {
  const existing = ragEligibilityCaches.get(vault);
  if (existing && !existing.disposed) return existing;
  const cache: RagEligibilityCache = {
    sourceEpochs: new Map(),
    entries: new Map(),
    refs: [],
    reusable: false,
    disposed: false,
    revision: 0,
    queue: existing?.queue ?? Promise.resolve(),
  };
  ragEligibilityCaches.set(vault, cache);
  // 이벤트를 받을 수 없는 모의/호스트에서는 진행 중 I/O만 합치고 완료 판정은 재사용하지 않는다.
  if (typeof vault.on === 'function' && typeof vault.offref === 'function') {
    const invalidate = (path: string, descendants: boolean) => {
      cache.revision++;
      cache.entries.delete(path);
      cache.sourceEpochs.delete(path);
      if (descendants) {
        for (const key of cache.entries.keys()) {
          if (key.startsWith(`${path}/`)) cache.entries.delete(key);
        }
        for (const key of cache.sourceEpochs.keys()) {
          if (key.startsWith(`${path}/`)) cache.sourceEpochs.delete(key);
        }
      }
    };
    cache.refs.push(
      vault.on('create', (file) => invalidate(file.path, file instanceof TFolder)),
      vault.on('modify', (file) => invalidate(file.path, file instanceof TFolder)),
      vault.on('delete', (file) => invalidate(file.path, file instanceof TFolder)),
      vault.on('rename', (file, oldPath) => {
        invalidate(oldPath, file instanceof TFolder);
        invalidate(file.path, file instanceof TFolder);
      }),
    );
    cache.reusable = true;
  }
  return cache;
}

function probeSnapshot(file: TFile): RagProbeSnapshot {
  return {
    file,
    path: file.path,
    extension: file.extension,
    mtime: file.stat.mtime,
    size: file.stat.size,
    decoder: decodeSourceBytesRust,
    decoderVersion: TEXT_DECODER_VERSION,
  };
}

function sameProbeSnapshot(left: RagProbeSnapshot, right: RagProbeSnapshot): boolean {
  return (
    left.file === right.file &&
    left.path === right.path &&
    left.extension === right.extension &&
    left.mtime === right.mtime &&
    left.size === right.size &&
    left.decoder === right.decoder &&
    left.decoderVersion === right.decoderVersion
  );
}

const unreadableRagProbe = (reason = 'read-failed'): RagProbeVerdict => ({
  reason,
  readable: false,
  textValid: false,
  metadata: { frontmatterUnreadable: true },
  reusable: false,
});

export type RagPreparedSourceRevision = RustSourceRevision & { sourceMetadataHash: string };

export function getRagPreparedSourceRevision(vault: Vault, file: TFile): RagPreparedSourceRevision | null {
  const cache = ragEligibilityCaches.get(vault);
  const entry = cache?.entries.get(file.path);
  const verdict = entry?.verdict;
  if (!cache?.reusable || cache.disposed || !entry || !verdict?.reusable || !verdict.textValid ||
      !sameProbeSnapshot(entry.snapshot, probeSnapshot(file)) || typeof verdict.contentHash !== 'string' ||
      typeof verdict.sourceMetadataHash !== 'string' || !/^[0-9a-f]{8}$/.test(verdict.contentHash) || !/^[0-9a-f]{8}$/.test(verdict.sourceMetadataHash)) return null;
  return { filePath: file.path, sourceMtime: entry.snapshot.mtime, sourceSize: entry.snapshot.size, contentHash: verdict.contentHash, sourceMetadataHash: verdict.sourceMetadataHash };
}

/** 읽기 전에 잡은 fingerprint·이벤트 owner가 살아 있을 때 준비 verdict만 캐시에 게시합니다. */
export function beginRagPreparedSourceProbe(vault: Vault, file: TFile): (result: { text?: string; reason?: string; contentHash?: string; sourceMetadataHash?: string }) => void {
  const cache = getRagEligibilityCache(vault);
  const snapshot = probeSnapshot(file);
  const epoch = cache.sourceEpochs.get(snapshot.path) ?? {};
  cache.sourceEpochs.set(snapshot.path, epoch);
  return (result) => {
    if (!cache.reusable || cache.disposed || cache.sourceEpochs.get(snapshot.path) !== epoch || !sameProbeSnapshot(snapshot, probeSnapshot(file))) return;
    const metadata = result.text !== undefined ? parseRagFrontmatterContent(file, result.text) : {};
    const reason = metadata.frontmatterUnreadable ? 'frontmatter-unreadable' : result.reason;
    // transient I/O·codec·YAML은 다음 호출에서 다시 시도합니다. 확정 binary만 실패 재사용 허용.
    if (reason && reason !== 'binary') {
      const previous = cache.entries.get(snapshot.path);
      if (previous && sameProbeSnapshot(previous.snapshot, snapshot)) cache.entries.delete(snapshot.path);
      return;
    }
    const verdict: RagProbeVerdict = { readable: true, textValid: !reason, metadata, reusable: true, ...(reason ? { reason } : {}),
      ...(result.contentHash !== undefined ? { contentHash: result.contentHash } : {}), ...(result.sourceMetadataHash !== undefined ? { sourceMetadataHash: result.sourceMetadataHash } : {}) };
    cache.entries.set(snapshot.path, { snapshot, result: Promise.resolve(verdict), verdict, users: 0 });
  };
}

async function probeRagFileBytes(vault: Vault, file: TFile): Promise<RagProbeVerdict> {
  try {
    const budget = decodeSourceBytesRust(new Uint8Array(), false, file.stat.size);
    if (!budget?.ok) return unreadableRagProbe(budget?.reason ?? 'decoder-unavailable');
    const bytes = new Uint8Array(await vault.readBinary(file));
    // stat 이후 커진 파일도 Rust 예산으로 재검사해 큰 WASM 복사 전에 사유를 보존한다.
    const actualBudget = decodeSourceBytesRust(new Uint8Array(), false, bytes.byteLength);
    if (!actualBudget?.ok) return unreadableRagProbe(actualBudget?.reason ?? 'decoder-unavailable');
    const markdown = ['md', 'markdown'].includes(file.extension.toLowerCase());
    const decoded = decodeSourceBytesRust(bytes, markdown);
    const metadata = markdown && decoded?.ok ? parseRagFrontmatterContent(file, decoded.text) : {};
    return {
      readable: decoded !== null,
      textValid: decoded?.ok === true && metadata.frontmatterUnreadable !== true,
      ...(!decoded?.ok ? { reason: decoded?.reason ?? 'decoder-unavailable' } :
        metadata.frontmatterUnreadable ? { reason: 'frontmatter-unreadable' } : {}),
      metadata,
      // I/O·코덱·YAML 실패는 같은 stat에서도 복구 후 재시도한다.
      reusable: (decoded?.ok === true || decoded?.reason === 'binary') && metadata.frontmatterUnreadable !== true,
    };
  } catch (error) {
    return unreadableRagProbe(error instanceof RangeError ? 'memory-budget' :
      error instanceof Error && error.name === 'QuotaExceededError' ? 'quota-exceeded' : 'read-failed');
  }
}

async function enqueueRagProbe(
  cache: RagEligibilityCache,
  probe: () => Promise<RagProbeVerdict>,
): Promise<RagProbeVerdict> {
  const previous = cache.queue;
  let release!: () => void;
  cache.queue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return cache.disposed ? unreadableRagProbe() : await probe();
  } finally {
    release();
  }
}

async function readCachedRagProbe(
  vault: Vault,
  file: TFile,
  cache: RagEligibilityCache,
): Promise<RagProbeVerdict> {
  const originalPath = file.path;
  const originalExtension = file.extension;
  while (!cache.disposed) {
    const snapshot = probeSnapshot(file);
    let entry = cache.entries.get(snapshot.path);
    if (!entry || !sameProbeSnapshot(entry.snapshot, snapshot)) {
      entry = {
        snapshot,
        users: 0,
        result: enqueueRagProbe(cache, () =>
          cache.entries.get(snapshot.path) === entry &&
          sameProbeSnapshot(snapshot, probeSnapshot(file))
            ? probeRagFileBytes(vault, file)
            : Promise.resolve(unreadableRagProbe()),
        ),
      };
      cache.entries.set(snapshot.path, entry);
    }
    entry.users++;
    const verdict = await entry.result;
    const current =
      cache.entries.get(snapshot.path) === entry &&
      sameProbeSnapshot(snapshot, probeSnapshot(file)) &&
      !cache.disposed;
    entry.users--;
    if (current && verdict.reusable) entry.verdict = verdict;
    if (current && entry.users === 0 && (!cache.reusable || !verdict.reusable)) {
      cache.entries.delete(snapshot.path);
    }
    if (current) return verdict;
    // 삭제/rename된 이전 목록은 닫고, 같은 경로 modify는 새 epoch 판정으로 재시도한다.
    if (
      file.path !== originalPath ||
      file.extension !== originalExtension ||
      !vault.getFiles().includes(file)
    )
      return unreadableRagProbe();
  }
  return unreadableRagProbe();
}

function readRagEligibilityPolicy(vault: Vault, ragConfig: RAGConfig, chatConfig: ChatConfig) {
  return {
    excludePaths: getEffectiveExcludePaths(ragConfig, chatConfig, vault.configDir),
    excludeExts: [...ragConfig.excludeExts],
  };
}

async function planRagFileIndexability(
  vault: Vault,
  files: readonly TFile[],
  readPolicy: () => { excludePaths: readonly string[]; excludeExts: readonly string[] },
): Promise<RustRagFileIndexabilityPlan> {
  if (decodeSourceBytesRust(new Uint8Array(), false) === null)
    throw new Error('Rust source decoder unavailable');
  const cache = getRagEligibilityCache(vault);
  while (!cache.disposed) {
    const revision = cache.revision;
    const policy = readPolicy();
    const { excludePaths, excludeExts } = policy;
    const liveFiles = new Set(vault.getFiles());
    const inputs = files.map((file) => ({
      ...toRagFileEligibilityInput(file),
      ...(!liveFiles.has(file) ? { frontmatterUnreadable: true } : {}),
    }));
    const probeIndices =
      planRagFileContentProbeIndicesRust(inputs, excludePaths, excludeExts);
    if (!probeIndices) throw new Error('Rust source probe plan is unavailable.');
    const textProbes = await readRagFileTextProbes(vault, files, probeIndices, inputs, cache);
    // 이미 읽은 앞 파일이 뒤 파일 I/O 중 바뀌어도 이전 판정을 게시하지 않는다.
    if (cache.revision !== revision || JSON.stringify(policy) !== JSON.stringify(readPolicy()))
      continue;
    if (cache.disposed) break;
    const plan = planRagFileIndexabilityRust(inputs, excludePaths, excludeExts, textProbes);
    if (!plan) throw new Error('Rust source inventory planning failed');
    return plan;
  }
  throw new DOMException('Source inventory disposed', 'AbortError');
}

/** 메타데이터 캐시 갱신 전에도 현재 YAML을 그대로 Rust 경계에 전달합니다. */
async function readRagFrontmatter(
  vault: Vault,
  file: TFile,
): Promise<Pick<RustRagFileEligibilityInput, 'frontmatter' | 'frontmatterUnreadable'>> {
  const ext = file.extension.toLowerCase();
  if (ext !== 'md' && ext !== 'markdown') return {};
  let content: string;
  try {
    const budget = decodeSourceBytesRust(new Uint8Array(), false, file.stat.size);
    if (!budget?.ok) return { frontmatterUnreadable: true };
    const decoded = decodeSourceBytesRust(new Uint8Array(await vault.readBinary(file)));
    if (!decoded?.ok) return { frontmatterUnreadable: true };
    content = decoded.text;
  } catch {
    // 제외 속성을 확인할 수 없으면 오래된 인덱스도 검색에 사용하지 않습니다.
    return { frontmatterUnreadable: true };
  }
  return parseRagFrontmatterContent(file, content);
}

function parseRagFrontmatterContent(
  file: TFile,
  content: string,
): Pick<RustRagFileEligibilityInput, 'frontmatter' | 'frontmatterUnreadable'> {
  const ext = file.extension.toLowerCase();
  if (ext !== 'md' && ext !== 'markdown') return {};
  try {
    if (!content.startsWith('---') && !content.startsWith('\uFEFF---'))
      return { frontmatter: null };
    const info = getFrontMatterInfo(content);
    // 구문 오류가 있는 YAML은 제외 속성을 확인할 수 없으므로 후보에서도 차단합니다.
    const frontmatter: unknown = info.exists ? parseYaml(info.frontmatter) : null;
    return { frontmatter };
  } catch {
    return { frontmatterUnreadable: true };
  }
}

/** YAML에서 제외한 문서는 경로·확장자 설정과 독립적으로 읽기 전용 목록에 표시합니다. */
export async function getFrontmatterExcludedFiles(vault: Vault): Promise<TFile[]> {
  const excluded: TFile[] = [];
  const allFiles = vault.getFiles();
  for (let offset = 0; offset < allFiles.length; offset += VAULT_READ_CONCURRENCY) {
    const slice = allFiles.slice(offset, offset + VAULT_READ_CONCURRENCY);
    const results = await Promise.all(
      slice.map(async (file) => ({ file, frontmatter: await readRagFrontmatter(vault, file) })),
    );
    for (const { file, frontmatter } of results) {
      if (frontmatter.frontmatter === undefined || frontmatter.frontmatterUnreadable) continue;
      const result = isRagFrontmatterExcludedRust(frontmatter.frontmatter);
      if (result === null) throw new Error('Frontmatter exclusion policy is unavailable.');
      if (result) excluded.push(file);
    }
  }
  return excluded;
}

async function readRagFileTextProbes(
  vault: Vault,
  files: readonly TFile[],
  probeIndices: readonly number[],
  inputs: RustRagFileEligibilityInput[],
  cache: RagEligibilityCache,
): Promise<RustRagFileTextProbeInput[]> {
  const probes: RustRagFileTextProbeInput[] = [];
  const normalizedProbeIndices = normalizeRustIndices(probeIndices, files.length, { dedupe: true });
  for (let offset = 0; offset < normalizedProbeIndices.length; offset += VAULT_READ_CONCURRENCY) {
    const slice = normalizedProbeIndices.slice(offset, offset + VAULT_READ_CONCURRENCY);
    const batchProbes = await Promise.all(
      slice.map(async (index): Promise<RustRagFileTextProbeInput | null> => {
        const file = files[index];
        if (!file) return null;
        const verdict = await readCachedRagProbe(vault, file, cache);
        const input = inputs[index];
        if (input) Object.assign(input, verdict.metadata);
        return { index, readable: verdict.readable, sample: '', textValid: verdict.textValid,
          ...(verdict.reason ? { reason: verdict.reason } : {}) };
      }),
    );
    for (const probe of batchProbes) {
      if (probe) probes.push(probe);
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

function localizeRagExcludeRecommendation(
  recommendation: RagExcludeRecommendation,
): RagExcludeRecommendation {
  return {
    ...recommendation,
    reason:
      recommendation.reason === 'too-large'
        ? t('ragExcludeTooLargeReason')
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
