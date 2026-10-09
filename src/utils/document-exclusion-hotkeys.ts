import { Platform, type App, type Hotkey } from 'obsidian';

/** 기본 핫키 UI가 관리하는 상태를 읽고 열기만 하는 좁은 호스트 경계입니다. */
type HotkeyApp = App & {
  hotkeyManager?: {
    getHotkeys(id: string): Hotkey[] | undefined;
    getDefaultHotkeys(id: string): Hotkey[] | undefined;
  };
  setting?: {
    open(): void;
    openTabById(id: string): void;
    findTabById(id: string): { setQuery?(query: string): void } | undefined;
  };
};

export function getDocumentExclusionHotkeyLabel(app: App, commandId: string): string | null {
  const manager = (app as HotkeyApp).hotkeyManager;
  if (!manager) return null;
  const hotkeys = manager.getHotkeys(commandId) ?? manager.getDefaultHotkeys(commandId) ?? [];
  const labels: Record<string, string> = Platform.isMacOS
    ? { Mod: '⌘', Meta: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧' }
    : { Mod: 'Ctrl', Meta: 'Meta', Ctrl: 'Ctrl', Alt: 'Alt', Shift: 'Shift' };
  return hotkeys
    .map((hotkey) =>
      [...hotkey.modifiers.map((modifier) => labels[modifier] ?? modifier), hotkey.key].join(
        Platform.isMacOS ? '' : '+',
      ),
    )
    .join(' / ');
}

export function openDocumentExclusionHotkeys(app: App, commandId: string): boolean {
  const setting = (app as HotkeyApp).setting;
  if (!setting) return false;
  setting.open();
  setting.openTabById('hotkeys');
  const tab = setting.findTabById('hotkeys');
  if (!tab?.setQuery) return false;
  tab.setQuery(commandId);
  return true;
}
