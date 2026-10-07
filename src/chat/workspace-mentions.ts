import { FileView, TFile, type App } from 'obsidian';

export interface WorkspaceMentionFiles {
  current: readonly string[];
  tabs: readonly string[];
}

/** 채팅에 포커스가 옮겨져도 Obsidian이 기억하는 최근 문서와 모든 창의 탭을 사용한다. */
export function captureWorkspaceMentionFiles(app: App): WorkspaceMentionFiles {
  const current = app.workspace.getActiveFile();
  const tabs = new Set<string>();
  app.workspace.iterateAllLeaves((leaf) => {
    if (leaf.view instanceof FileView && leaf.view.file) {
      tabs.add(leaf.view.file.path);
      return;
    }
    // 아직 로드하지 않은 탭은 호스트가 저장한 파일 경로로 확인한다.
    const state: unknown = leaf.getViewState().state;
    if (!state || typeof state !== 'object' || !('file' in state) || typeof state.file !== 'string')
      return;
    const file = app.vault.getAbstractFileByPath(state.file);
    if (file instanceof TFile) tabs.add(file.path);
  });
  return { current: current ? [current.path] : [], tabs: [...tabs] };
}
