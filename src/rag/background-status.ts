import type { RAGConfig } from '../settings';

export function shouldRunRagStatusBackgroundRefresh(
  ragConfig: Pick<RAGConfig, 'autoUpdateEnabled'>,
): boolean {
  return ragConfig.autoUpdateEnabled;
}
