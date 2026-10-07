import { describe, expect, it, vi } from 'vitest';
import { FileView, TFile, type App } from 'obsidian';
import { captureWorkspaceMentionFiles } from './workspace-mentions';

vi.mock('obsidian', () => ({
  FileView: class {
    file: TFile | null = null;
  },
  TFile: class {
    path = '';
  },
}));

describe('작업공간 문서 참조', () => {
  it('호스트의 최근 문서와 모든 창의 실제·지연 탭을 수집하고 중복을 제거한다', () => {
    const first = Object.assign(new TFile(), { path: '프로젝트/회의록.md' });
    const second = Object.assign(new TFile(), { path: '연구/설계.md' });
    const view = Object.assign(Object.create(FileView.prototype) as FileView, { file: first });
    const leaves = [
      { view, getViewState: () => ({}) },
      { view, getViewState: () => ({}) },
      { view: {}, getViewState: () => ({ state: { file: second.path } }) },
      { view: {}, getViewState: () => ({ state: { file: '없는.md' } }) },
      { view: {}, getViewState: () => ({}) },
    ];
    const app = {
      workspace: {
        getActiveFile: () => first,
        iterateAllLeaves: (callback: (leaf: (typeof leaves)[number]) => void) =>
          leaves.forEach(callback),
      },
      vault: { getAbstractFileByPath: (path: string) => (path === second.path ? second : null) },
    } as unknown as App;
    const snapshot = captureWorkspaceMentionFiles(app);
    first.path = '프로젝트/변경.md';
    expect(snapshot).toEqual({
      current: ['프로젝트/회의록.md'],
      tabs: ['프로젝트/회의록.md', '연구/설계.md'],
    });
  });

  it('열린 문서가 없으면 빈 스냅샷을 반환한다', () => {
    const app = {
      workspace: { getActiveFile: () => null, iterateAllLeaves: () => undefined },
    } as unknown as App;
    expect(captureWorkspaceMentionFiles(app)).toEqual({ current: [], tabs: [] });
  });
});
