import type { TAbstractFile, TFile, Vault } from 'obsidian';
import type { ChatConfig, RAGConfig } from '../settings';
import { isRagFileExcluded } from '../utils/vault';

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
): PendingWriteRecoveryHost {
  return {
    getAbstractFileByPath: (path) => vault.getAbstractFileByPath(path),
    isRagFileExcluded: (path) => {
      const file = vault.getAbstractFileByPath(path);
      if (!isCurrentVaultFile(file)) return Promise.resolve(true);
      return isRagFileExcluded(vault, file, ragConfig, chatConfig);
    },
    scheduleFile,
    removeFile,
  };
}
