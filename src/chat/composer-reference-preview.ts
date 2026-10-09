import { setIcon } from 'obsidian';
import type { ContextPreviewChip } from './chat-composer';

let previewId = 0;

/** 기본 textarea를 유지하면서 참조 정보를 마우스와 키보드 모두로 확인한다. */
export function renderComposerReferencePreview(
  container: HTMLElement,
  chips: readonly ContextPreviewChip[],
): void {
  container.empty();
  const list = container.createDiv({ cls: 'superpower-inside-reference-list' });
  const id = `superpower-inside-reference-${++previewId}`;
  const preview = container.createDiv({
    cls: 'superpower-inside-reference-popover',
    attr: { id, role: 'tooltip' },
  });
  let activeSummary: HTMLButtonElement | null = null;
  const hide = (): void => {
    activeSummary?.setAttribute('aria-expanded', 'false');
    preview.toggleClass('expanded', false);
  };
  container.onmouseleave = () => {
    if (container.ownerDocument.activeElement !== activeSummary) hide();
  };
  for (const chip of chips) {
    if (chip.valid === undefined) {
      list.createSpan({
        cls: `superpower-inside-chat-context-chip ${chip.cls}`,
        text: chip.label,
      });
      continue;
    }
    const reference = list.createSpan({
      cls: 'superpower-inside-composer-reference',
    });
    const summary = reference.createEl('button', {
      cls: `superpower-inside-chat-context-chip ${chip.cls} ${chip.valid ? 'valid' : 'missing'}`,
      attr: {
        type: 'button',
        'aria-label': `${chip.label}: ${chip.detail ?? ''}`,
        'aria-describedby': id,
        'aria-expanded': 'false',
      },
    });
    const icon = summary.createSpan({
      cls: 'superpower-inside-reference-icon',
      attr: { 'aria-hidden': 'true' },
    });
    setIcon(icon, chip.valid ? 'check' : 'circle-alert');
    summary.createSpan({ text: chip.label });
    if (!chip.valid)
      summary.createSpan({ cls: 'superpower-inside-reference-state', text: chip.detail });
    const show = (): void => {
      hide();
      activeSummary = summary;
      preview.empty();
      preview.createDiv({ cls: 'superpower-inside-reference-state', text: chip.detail });
      for (const path of chip.paths ?? [])
        preview.createDiv({ cls: 'superpower-inside-reference-path', text: path });
      preview.toggleClass('expanded', true);
      summary.setAttribute('aria-expanded', 'true');
    };
    summary.addEventListener('mouseenter', show);
    summary.addEventListener('focus', show);
    summary.addEventListener('blur', hide);
    summary.addEventListener('click', show);
    summary.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      hide();
    });
  }
}
