import type { App, TFile } from 'obsidian';
import type { ChatConfig, RAGConfig } from '../settings';
import {
  getEffectiveExcludePaths,
  getRagCandidateFiles,
  isExcludedPath,
  isRagCandidateFile,
} from '../utils/vault';
import type { NativeVaultFileScope } from './obsidian-native-vault-port';

export class RagNativeVaultFileScope implements NativeVaultFileScope {
  constructor(
    private readonly app: App,
    private readonly getRagConfig: () => RAGConfig,
    private readonly getChatConfig: () => ChatConfig,
  ) {}

  listCandidateFiles(): Promise<readonly TFile[]> {
    return getRagCandidateFiles(this.app.vault, this.getRagConfig(), this.getChatConfig());
  }

  isCandidateFile(file: TFile): Promise<boolean> {
    return isRagCandidateFile(this.app.vault, file, this.getRagConfig(), this.getChatConfig());
  }

  isPathVisible(path: string): boolean {
    return !isExcludedPath(
      path,
      getEffectiveExcludePaths(this.getRagConfig(), this.getChatConfig(), this.app.vault.configDir),
    );
  }
}
