export interface ChatVariantNavLabels {
  prev: string;
  next: string;
  position: string;
}

export interface ChatVariantNavOptions {
  total: number;
  activeIndex: number;
  labels: ChatVariantNavLabels;
  setIcon: (element: HTMLElement, icon: string) => void;
  onSwitch: (targetIndex: number) => void;
}

/** 재생성 버전 이동(‹ N/M ›) 컨트롤. 변형이 2개 미만이면 아무것도 만들지 않는다. */
export function renderChatVariantNav(container: HTMLElement, options: ChatVariantNavOptions): void {
  if (options.total < 2) return;
  const nav = container.createDiv({ cls: 'superpower-inside-chat-variant-nav' });
  const prev = nav.createEl('button', {
    cls: 'superpower-inside-chat-variant-nav-button',
    attr: { type: 'button', 'aria-label': options.labels.prev, title: options.labels.prev },
  });
  options.setIcon(prev, 'chevron-left');
  prev.disabled = options.activeIndex <= 0;
  prev.addEventListener('click', () => options.onSwitch(options.activeIndex - 1));
  nav.createSpan({
    cls: 'superpower-inside-chat-variant-nav-position',
    text: options.labels.position,
  });
  const next = nav.createEl('button', {
    cls: 'superpower-inside-chat-variant-nav-button',
    attr: { type: 'button', 'aria-label': options.labels.next, title: options.labels.next },
  });
  options.setIcon(next, 'chevron-right');
  next.disabled = options.activeIndex >= options.total - 1;
  next.addEventListener('click', () => options.onSwitch(options.activeIndex + 1));
}
