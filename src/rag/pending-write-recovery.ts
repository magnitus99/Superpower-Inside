import type { TAbstractFile, TFile, Vault } from 'obsidian';
import type { ChatConfig, RAGConfig } from '../settings';
import { getRagFileInventory, isRagFileExcluded, isRagFileMetadataExcluded, type RagFileInventory } from '../utils/vault';

export interface PendingWriteRecoveryHost {
  getAbstractFileByPath(path: string): TAbstractFile | null;
  isRagFileExcluded(path: string): Promise<boolean>;
  scheduleFile(file: TFile): void;
  removeFile(path: string): Promise<unknown>;
}

function isCurrentVaultFile(file: TAbstractFile | null): file is TFile {
  return file !== null && 'extension' in file && 'stat' in file && 'basename' in file;
}

/**
 * 중단된 파일 쓰기 원장을 복구 큐로 넘긴다.
 * store가 내구 요청을 먼저 등록한 뒤 원장을 지우고, indexer가 성공·삭제 시 요청을 완료한다.
 */
export async function recoverPendingFileWrites(
  pendingPaths: readonly string[],
  host: PendingWriteRecoveryHost,
): Promise<void> {
  for (const path of new Set(pendingPaths)) {
    const file = host.getAbstractFileByPath(path);
    if (isCurrentVaultFile(file) && !(await host.isRagFileExcluded(path))) {
      host.scheduleFile(file);
      continue;
    }
    await host.removeFile(path);
  }
}

export function createPendingWriteRecoveryHost(
  vault: Vault,
  ragConfig: RAGConfig,
  chatConfig: ChatConfig,
  scheduleFile: (file: TFile) => void,
  removeFile: (path: string) => Promise<unknown>,
  inventory?: RagFileInventory,
): PendingWriteRecoveryHost {
  let manifest: Promise<RagFileInventory> | undefined;
  return {
    getAbstractFileByPath: (path) => vault.getAbstractFileByPath(path),
    isRagFileExcluded: async (path) => {
      const file = vault.getAbstractFileByPath(path);
      if (!isCurrentVaultFile(file)) return true;
      manifest ??= inventory ? Promise.resolve(inventory) : getRagFileInventory(vault, ragConfig, chatConfig);
      const current = await manifest;
      const failure = current.failures.find((entry) => entry.file.path === path);
      // 읽기 실패를 제외·orphan으로 바꾸어 내구 자료를 지우지 않습니다.
      if (failure) throw new Error(`Source recovery blocked: ${failure.reason}`);
      // 자동 admission은 원문을 probe하지 않고 YAML·읽기 실패 판정을 실제 indexer 준비에 맡깁니다.
      if ('verification' in current && current.verification === 'metadata-only') return isRagFileMetadataExcluded(vault, file, ragConfig, chatConfig);
      return isRagFileExcluded(vault, file, ragConfig, chatConfig);
    },
    scheduleFile,
    removeFile,
  };
}
