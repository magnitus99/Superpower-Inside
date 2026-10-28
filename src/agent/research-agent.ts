import {
  isScopedVaultResearchIntentRust,
  isWholeVaultResearchIntentRust,
} from '../rag/rust-core';
import { t } from '../i18n';

/** 볼트 연구 실행 중 사용자에게 표시하는 단계입니다. */
export type VaultResearchPhase =
  | 'inventory'
  | 'map'
  | 'screen'
  | 'extract'
  | 'reduce'
  | 'search'
  | 'verify'
  | 'followup'
  | 'answer'
  | 'repair'
  | 'complete';

/** 진행 이벤트의 공통 형태입니다. 실행은 `indexed-vault-review.ts`가 소유합니다. */
export interface VaultResearchProgress {
  phase: VaultResearchPhase;
  completedFiles: number;
  totalFiles: number;
  currentPath?: string;
}

export function isWholeVaultResearchRequest(question: string): boolean {
  return isWholeVaultResearchIntentRust(question) === true;
}

export function isScopedVaultResearchRequest(question: string): boolean {
  return isScopedVaultResearchIntentRust(question) === true;
}

export function getVaultResearchPhaseLabel(phase: VaultResearchPhase): string {
  switch (phase) {
    case 'inventory':
      return t('vaultResearchPhaseInventory');
    case 'map':
      return t('vaultResearchPhaseMap');
    case 'screen':
      return t('vaultResearchPhaseScreen');
    case 'extract':
      return t('vaultResearchPhaseExtract');
    case 'reduce':
      return t('vaultResearchPhaseReduce');
    case 'search':
      return t('vaultResearchPhaseSearch');
    case 'verify':
      return t('vaultResearchPhaseVerify');
    case 'followup':
      return t('vaultResearchPhaseFollowup');
    case 'answer':
      return t('vaultResearchPhaseAnswer');
    case 'repair':
      return t('vaultResearchPhaseRepair');
    case 'complete':
      return t('vaultResearchPhaseComplete');
  }
}
