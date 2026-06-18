import type { RAGConfig } from '../settings';

export function shouldRunRagStatusBackgroundRefresh(
  ragConfig: Pick<RAGConfig, 'autoUpdateEnabled' | 'graphRagEnabled' | 'graphRagAutoSyncEnabled'>,
): boolean {
  return (
    ragConfig.autoUpdateEnabled ||
    ragConfig.graphRagEnabled ||
    ragConfig.graphRagAutoSyncEnabled
  );
}
