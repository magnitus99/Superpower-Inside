import type { App } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import {
  getDocumentExclusionHotkeyLabel,
  openDocumentExclusionHotkeys,
} from './document-exclusion-hotkeys';
vi.mock('obsidian', () => ({ Platform: { isMacOS: true } }));

describe('문서 제외 명령의 기본 핫키 화면 연결', () => {
  it('미할당·사용자 할당·명시적 해제 상태를 구분한다', () => {
    const getHotkeys = vi.fn(() => undefined as { modifiers: string[]; key: string }[] | undefined);
    const app = {
      hotkeyManager: { getHotkeys, getDefaultHotkeys: () => [{ modifiers: ['Mod'], key: 'E' }] },
    } as unknown as App;
    expect(getDocumentExclusionHotkeyLabel(app, 'command')).toContain('E');
    getHotkeys.mockReturnValue([
      { modifiers: ['Mod', 'Shift'], key: 'X' },
      { modifiers: ['Alt'], key: 'E' },
    ]);
    expect(getDocumentExclusionHotkeyLabel(app, 'command')).toContain('X');
    expect(getDocumentExclusionHotkeyLabel(app, 'command')).toContain('E');
    getHotkeys.mockReturnValue([]);
    expect(getDocumentExclusionHotkeyLabel(app, 'command')).toBe('');
  });

  it('기본 핫키 화면을 먼저 열고 정확한 명령 ID로 필터링한다', () => {
    const setQuery = vi.fn();
    const open = vi.fn();
    const openTabById = vi.fn();
    const app = {
      setting: { open, openTabById, findTabById: () => ({ setQuery }) },
    } as unknown as App;
    expect(openDocumentExclusionHotkeys(app, 'plugin:command')).toBe(true);
    expect(open).toHaveBeenCalledOnce();
    expect(openTabById).toHaveBeenCalledWith('hotkeys');
    expect(setQuery).toHaveBeenCalledWith('plugin:command');
    expect(openTabById.mock.invocationCallOrder[0]).toBeLessThan(
      setQuery.mock.invocationCallOrder[0],
    );
  });

  it('지원하지 않는 호스트에서는 실패를 표시할 수 있도록 반환한다', () => {
    expect(openDocumentExclusionHotkeys({} as App, 'command')).toBe(false);
    expect(getDocumentExclusionHotkeyLabel({} as App, 'command')).toBeNull();
  });
});
