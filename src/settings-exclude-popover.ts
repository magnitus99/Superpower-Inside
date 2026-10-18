import { getLanguage, t } from './i18n';
import { isDomInstance } from './utils/dom';
import type { ExcludePathMetadata } from './utils/vault';

/** 행 위에서 팝오버가 열리기까지 기다리는 시간입니다. */
export const EXCLUDE_POPOVER_HOVER_DELAY_MS = 1000;

/** 행과 팝오버 사이를 오갈 때 닫힘을 늦추는 유예 시간입니다. */
const POPOVER_CLOSE_GRACE_MS = 160;

/** 팝오버 폭 상한, 행과의 간격, 좌우·위쪽 여백입니다. */
const POPOVER_WIDTH = 320;
const POPOVER_GAP = 12;
const POPOVER_MARGIN = 12;
const POPOVER_ARROW_HALF = 5;

/** 매칭 위치는 3곳까지만 보여주고 나머지는 개수로 요약합니다. */
const POPOVER_MATCH_LIMIT = 3;

/** 값이 없을 때와 상태 톤에 쓰는 표시입니다. */
const EMPTY_VALUE = '—';
const NEUTRAL_TONE_MARK = '○';
const WARNING_TONE_MARK = '◇';

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/** 팝오버 id는 행마다 달라야 하므로 문서 단위로만 증가시킵니다. */
let popoverIdSequence = 0;

/** 바이트 값을 사람이 읽는 단위로 바꿉니다. */
export function formatExcludeByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 ' + BYTE_UNITS[0];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  if (unitIndex === 0) return Math.round(value) + ' ' + BYTE_UNITS[0];
  const rounded = Math.round(value * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return text + ' ' + BYTE_UNITS[unitIndex];
}

/** 타임스탬프를 현재 언어의 날짜로 바꿉니다. 값이 없으면 null입니다. */
export function formatExcludeDate(timestampMs: number | null, locale: string): string | null {
  if (timestampMs === null || !Number.isFinite(timestampMs)) return null;
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(timestampMs));
}

/** 표시 경로를 브레드크럼 조각으로 나눕니다. */
export function splitExcludePathSegments(displayPath: string): string[] {
  return displayPath.split('/').filter((segment) => segment.length > 0);
}

export interface ExcludePopoverLayoutInput {
  anchor: { left: number; top: number; bottom: number; width: number };
  size: { width: number; height: number };
  /** 좌우 클램프 경계(설정 콘텐츠 사각형에서 여백을 뺀 값)입니다. */
  bounds: { left: number; right: number };
  /** 팝오버가 완전히 들어와야 하는 세로 경계(뷰포트에서 여백을 뺀 값)입니다. */
  vertical: { top: number; bottom: number };
  gap: number;
  arrowHalf: number;
}

export interface ExcludePopoverLayout {
  placement: 'above' | 'below';
  left: number;
  top: number;
  width: number;
  arrowX: number;
  /** 위·아래 어느 쪽도 전체 높이를 담지 못할 때 남는 높이입니다. 아니면 null입니다. */
  maxHeight: number | null;
}

/**
 * 행 위쪽을 기본으로 삼고, 위 공간이 부족할 때만 아래로 뒤집습니다.
 * 좌우는 설정 콘텐츠 경계 안으로 클램프하며 화살표는 팝오버 안에 유지합니다.
 * 위·아래 어느 쪽도 전체 높이를 담지 못하면 뷰포트 안에 남도록 위치를 클램프하고
 * 남는 높이를 maxHeight로 돌려줍니다(내부 스크롤).
 */
export function planExcludePopoverLayout(input: ExcludePopoverLayoutInput): ExcludePopoverLayout {
  const boundsWidth = Math.max(0, input.bounds.right - input.bounds.left);
  const width = Math.min(input.size.width, boundsWidth);
  const centerX = input.anchor.left + input.anchor.width / 2;
  const maxLeft = Math.max(input.bounds.left, input.bounds.right - width);
  const left = Math.min(Math.max(centerX - width / 2, input.bounds.left), maxLeft);
  const arrowMax = Math.max(input.arrowHalf, width - input.arrowHalf);
  const arrowX = Math.min(Math.max(centerX - left, input.arrowHalf), arrowMax);
  const aboveTop = input.anchor.top - input.gap - input.size.height;
  const belowTop = input.anchor.bottom + input.gap;
  const fitsAbove = aboveTop >= input.vertical.top;
  const fitsBelow = belowTop + input.size.height <= input.vertical.bottom;
  const placement: ExcludePopoverLayout['placement'] = fitsAbove ? 'above' : 'below';
  if (fitsAbove || fitsBelow) {
    return {
      placement,
      left,
      top: fitsAbove ? aboveTop : belowTop,
      width,
      arrowX,
      maxHeight: null,
    };
  }
  // 어느 쪽도 전체 높이를 담지 못하면 배치를 유지한 채 뷰포트 안으로 넣고
  // 남는 높이만 보여 줍니다. 화살표는 클램프된 뒤에도 행을 가리킵니다.
  const requestedTop = placement === 'above' ? aboveTop : belowTop;
  const top = Math.min(
    Math.max(requestedTop, input.vertical.top),
    Math.max(input.vertical.top, input.vertical.bottom),
  );
  const available = Math.max(0, input.vertical.bottom - top);
  return {
    placement,
    left,
    top,
    width,
    arrowX,
    maxHeight: Math.min(input.size.height, available),
  };
}

interface PopoverRow {
  rowEl: HTMLElement;
  valueEl: HTMLElement;
  removeButtonEl: HTMLElement;
  popoverEl: HTMLElement;
  value: string;
  rendered: boolean;
  focused: boolean;
}

export interface ExcludePathPopoverRow {
  rowEl: HTMLElement;
  valueEl: HTMLElement;
  removeButtonEl: HTMLElement;
  value: string;
}

export interface ExcludePathPopoverOptions {
  /** 팝오버 이벤트를 듣고 붙일 문서입니다. */
  doc: Document;
  /** 팝오버를 붙이는 컨테이너(설정 문서의 body)입니다. */
  container: HTMLElement;
  /** 좌우 클램프 기준이 되는 설정 콘텐츠 요소입니다. */
  boundsEl: HTMLElement;
  getMetadata: (value: string) => ExcludePathMetadata;
  hoverDelayMs?: number;
}

/**
 * 제외 경로 목록의 행별 메타데이터 팝오버를 관리합니다.
 *
 * 메타데이터는 팝오버를 처음 열 때 한 번만 계산하고, 목록이 다시 렌더되면
 * settings.ts가 컨트롤러를 새로 만들어 캐시도 함께 새로 만듭니다.
 */
export class ExcludePathPopoverController {
  private readonly options: ExcludePathPopoverOptions;
  private readonly hoverDelayMs: number;
  private readonly rows: PopoverRow[] = [];
  private readonly disposers: Array<() => void> = [];
  private activeRow: PopoverRow | null = null;
  private pendingRow: PopoverRow | null = null;
  private openTimer: number | null = null;
  private closeTimer: number | null = null;
  private destroyed = false;

  constructor(options: ExcludePathPopoverOptions) {
    this.options = options;
    this.hoverDelayMs = options.hoverDelayMs ?? EXCLUDE_POPOVER_HOVER_DELAY_MS;
    const onKeydown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      this.close();
    };
    const onViewportChange = (event: Event): void => {
      const row = this.activeRow;
      if (!row) return;
      // 팝오버 내부 스크롤은 위치를 바꾸지 않으므로 스크롤 위치를 보존합니다.
      if (event.type === 'scroll' && row.popoverEl.contains(event.target as Node)) return;
      this.updatePosition(row);
    };
    options.doc.addEventListener('keydown', onKeydown);
    this.disposers.push(() => options.doc.removeEventListener('keydown', onKeydown));
    const view = options.doc.defaultView;
    if (view) {
      view.addEventListener('resize', onViewportChange);
      view.addEventListener('scroll', onViewportChange, true);
      this.disposers.push(() => {
        view.removeEventListener('resize', onViewportChange);
        view.removeEventListener('scroll', onViewportChange, true);
      });
    }
  }

  /** 행 하나에 팝오버를 연결하고 경로 값 요소를 포커스 가능하게 만듭니다. */
  attachRow(input: ExcludePathPopoverRow): void {
    if (this.destroyed) return;
    popoverIdSequence += 1;
    const popoverId = 'superpower-inside-exclude-popover-' + String(popoverIdSequence);
    const popoverEl = this.options.container.createDiv({
      cls: 'superpower-inside-exclude-popover',
      attr: { id: popoverId, role: 'tooltip' },
    });
    const row: PopoverRow = {
      rowEl: input.rowEl,
      valueEl: input.valueEl,
      removeButtonEl: input.removeButtonEl,
      popoverEl,
      value: input.value,
      rendered: false,
      focused: false,
    };
    this.rows.push(row);
    input.valueEl.setAttribute('tabindex', '0');
    input.valueEl.setAttribute('aria-describedby', popoverId);

    const onRowPointerOver = (event: Event): void => {
      const target = event.target as Node | null;
      if (!isDomInstance(target, HTMLElement)) return;
      if (row.removeButtonEl.contains(target)) {
        this.cancelPendingOpen(row);
        if (this.activeRow === row) this.close();
        return;
      }
      if (!row.rowEl.contains(target)) return;
      this.scheduleOpen(row);
    };
    const onRowPointerLeave = (): void => {
      this.cancelPendingOpen(row);
      if (this.activeRow === row) this.deferClose();
    };
    const onValueFocus = (): void => {
      row.focused = true;
      this.open(row);
    };
    const onValueBlur = (): void => {
      row.focused = false;
      if (this.activeRow === row) this.close();
    };
    const onPopoverEnter = (): void => {
      this.cancelClose();
    };
    const onPopoverLeave = (): void => {
      if (this.activeRow === row) this.deferClose();
    };
    row.rowEl.addEventListener('pointerover', onRowPointerOver);
    row.rowEl.addEventListener('pointerleave', onRowPointerLeave);
    row.valueEl.addEventListener('focus', onValueFocus);
    row.valueEl.addEventListener('blur', onValueBlur);
    row.popoverEl.addEventListener('pointerenter', onPopoverEnter);
    row.popoverEl.addEventListener('pointerleave', onPopoverLeave);
    this.disposers.push(() => {
      row.rowEl.removeEventListener('pointerover', onRowPointerOver);
      row.rowEl.removeEventListener('pointerleave', onRowPointerLeave);
      row.valueEl.removeEventListener('focus', onValueFocus);
      row.valueEl.removeEventListener('blur', onValueBlur);
      row.popoverEl.removeEventListener('pointerenter', onPopoverEnter);
      row.popoverEl.removeEventListener('pointerleave', onPopoverLeave);
    });
  }

  /** 대기 중인 타이머를 정리하고 열린 팝오버를 닫습니다. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cancelPendingOpen();
    this.cancelClose();
    this.activeRow = null;
    for (const dispose of this.disposers) dispose();
    this.disposers.length = 0;
    for (const row of this.rows) row.popoverEl.remove();
    this.rows.length = 0;
  }

  private scheduleOpen(row: PopoverRow): void {
    if (this.destroyed) return;
    if (this.activeRow === row) {
      this.cancelClose();
      return;
    }
    if (this.pendingRow === row && this.openTimer !== null) return;
    this.cancelPendingOpen();
    this.pendingRow = row;
    this.openTimer = window.setTimeout(() => {
      this.openTimer = null;
      this.pendingRow = null;
      this.open(row);
    }, this.hoverDelayMs);
  }

  private open(row: PopoverRow): void {
    if (this.destroyed) return;
    this.cancelClose();
    if (this.activeRow && this.activeRow !== row) this.close();
    if (!row.rendered) {
      renderExcludePopoverContent(row.popoverEl, this.options.getMetadata(row.value));
      row.rendered = true;
    }
    this.activeRow = row;
    row.rowEl.addClass('is-active');
    this.updatePosition(row);
    row.popoverEl.addClass('is-open');
  }

  private close(): void {
    this.cancelPendingOpen();
    this.cancelClose();
    const row = this.activeRow;
    if (!row) return;
    this.activeRow = null;
    row.popoverEl.removeClass('is-open');
    row.rowEl.removeClass('is-active');
  }

  private deferClose(): void {
    // 경로 값에 포커스가 남아 있으면 키보드로 읽는 중이므로 유지합니다.
    if (this.activeRow?.focused) return;
    this.cancelClose();
    this.closeTimer = window.setTimeout(() => {
      this.closeTimer = null;
      this.close();
    }, POPOVER_CLOSE_GRACE_MS);
  }

  private cancelPendingOpen(row: PopoverRow | null = null): void {
    if (row && this.pendingRow !== row) return;
    if (this.openTimer !== null) window.clearTimeout(this.openTimer);
    this.openTimer = null;
    this.pendingRow = null;
  }

  private cancelClose(): void {
    if (this.closeTimer !== null) window.clearTimeout(this.closeTimer);
    this.closeTimer = null;
  }

  private updatePosition(row: PopoverRow): void {
    const anchorRect = row.rowEl.getBoundingClientRect();
    const contentRect = this.options.boundsEl.getBoundingClientRect();
    const viewportHeight = this.options.doc.defaultView?.innerHeight ?? 0;
    const bounds = {
      left: contentRect.left + POPOVER_MARGIN,
      right: contentRect.right - POPOVER_MARGIN,
    };
    const vertical = {
      top: POPOVER_MARGIN,
      bottom: viewportHeight > 0 ? viewportHeight - POPOVER_MARGIN : Number.POSITIVE_INFINITY,
    };
    const width = Math.min(POPOVER_WIDTH, Math.max(0, bounds.right - bounds.left));
    // 스크롤 제한을 잠시 풀고 자연 높이를 재서 배치 판단에 씁니다.
    row.popoverEl.removeClass('is-scrollable');
    row.popoverEl.setCssProps({ '--superpower-inside-exclude-popover-width': width + 'px' });
    const popoverRect = row.popoverEl.getBoundingClientRect();
    const layout = planExcludePopoverLayout({
      anchor: {
        left: anchorRect.left,
        top: anchorRect.top,
        bottom: anchorRect.bottom,
        width: anchorRect.width,
      },
      size: { width, height: popoverRect.height },
      bounds,
      vertical,
      gap: POPOVER_GAP,
      arrowHalf: POPOVER_ARROW_HALF,
    });
    row.popoverEl.setCssProps({
      '--superpower-inside-exclude-popover-width': layout.width + 'px',
      '--superpower-inside-exclude-popover-x': layout.left + 'px',
      '--superpower-inside-exclude-popover-y': layout.top + 'px',
      '--superpower-inside-exclude-popover-arrow-x': layout.arrowX + 'px',
    });
    row.popoverEl.toggleClass('is-below', layout.placement === 'below');
    if (layout.maxHeight === null) {
      row.popoverEl.removeClass('is-scrollable');
      return;
    }
    row.popoverEl.setCssProps({
      '--superpower-inside-exclude-popover-max-height': layout.maxHeight + 'px',
    });
    row.popoverEl.toggleClass('is-scrollable', layout.maxHeight < popoverRect.height);
  }
}

/** 승인된 V3 구성을 그대로 그립니다. 모든 문구는 팝오버를 열 때 t()로 읽습니다. */
function renderExcludePopoverContent(root: HTMLElement, metadata: ExcludePathMetadata): void {
  root.empty();
  const content = root.createDiv({ cls: 'superpower-inside-exclude-popover-content' });
  const header = content.createDiv({ cls: 'superpower-inside-exclude-popover-header' });
  header.createDiv({
    cls: 'superpower-inside-exclude-popover-title',
    text: t('excludePopoverTitle'),
  });
  header.createDiv({
    cls: 'superpower-inside-exclude-popover-kind',
    text:
      metadata.kind === 'pattern' ? t('excludePopoverKindPattern') : t('excludePopoverKindFolder'),
  });

  const crumbs = content.createEl('ol', { cls: 'superpower-inside-exclude-popover-crumbs' });
  crumbs.createEl('li', { text: t('excludePopoverRoot') });
  for (const segment of splitExcludePathSegments(metadata.displayPath)) {
    crumbs.createEl('li', { text: segment });
  }

  const status = content.createDiv({ cls: 'superpower-inside-exclude-popover-status' });
  status.createSpan({
    cls: 'superpower-inside-exclude-popover-tone',
    text: metadata.exists ? NEUTRAL_TONE_MARK : WARNING_TONE_MARK,
    attr: { 'aria-hidden': 'true' },
  });
  status.createSpan({
    cls: 'superpower-inside-exclude-popover-status-text',
    text: getStatusText(metadata),
  });
  if (!metadata.exists) status.addClass('is-warning');

  if (metadata.kind === 'pattern') renderExcludePopoverMatches(content, metadata);

  const stats = content.createDiv({ cls: 'superpower-inside-exclude-popover-stats' });
  appendExcludePopoverStat(stats, t('excludePopoverStatDocuments'), getDocumentCountText(metadata));
  appendExcludePopoverStat(stats, t('excludePopoverStatSize'), getSizeText(metadata));
  appendExcludePopoverStat(stats, t('excludePopoverStatModified'), getModifiedText(metadata));

  content.createDiv({
    cls: 'superpower-inside-exclude-popover-note',
    text: t('excludePopoverNote'),
  });
  root.createDiv({
    cls: 'superpower-inside-exclude-popover-arrow',
    attr: { 'aria-hidden': 'true' },
  });
}

function renderExcludePopoverMatches(root: HTMLElement, metadata: ExcludePathMetadata): void {
  const matches = metadata.matches.slice(0, POPOVER_MATCH_LIMIT);
  if (matches.length === 0) return;
  root.createDiv({
    cls: 'superpower-inside-exclude-popover-matches-label',
    text: t('excludePopoverMatchesLabel'),
  });
  const list = root.createEl('ul', { cls: 'superpower-inside-exclude-popover-matches' });
  for (const match of matches) {
    const item = list.createEl('li', { cls: 'superpower-inside-exclude-popover-match' });
    item.createSpan({ cls: 'superpower-inside-exclude-popover-match-path', text: match.path });
    item.createSpan({
      cls: 'superpower-inside-exclude-popover-match-count',
      text: t('excludePopoverCountValue', { count: match.fileCount }),
    });
  }
  const remaining = metadata.matchCount - matches.length;
  if (remaining > 0) {
    root.createDiv({
      cls: 'superpower-inside-exclude-popover-more',
      text: t('excludePopoverMatchesMore', { count: remaining }),
    });
  }
}

function appendExcludePopoverStat(parent: HTMLElement, label: string, value: string): void {
  const item = parent.createDiv({ cls: 'superpower-inside-exclude-popover-stat' });
  item.createDiv({ cls: 'superpower-inside-exclude-popover-stat-label', text: label });
  item.createDiv({ cls: 'superpower-inside-exclude-popover-stat-value', text: value });
}

function getStatusText(metadata: ExcludePathMetadata): string {
  if (!metadata.exists) return t('excludePopoverMissing');
  if (metadata.kind === 'pattern') {
    return t('excludePopoverPatternStatus', { count: metadata.matchCount });
  }
  return t('excludePopoverFolderStatus', { count: metadata.totalFileCount });
}

function getDocumentCountText(metadata: ExcludePathMetadata): string {
  if (!metadata.exists) return EMPTY_VALUE;
  return t('excludePopoverCountValue', { count: metadata.totalFileCount });
}

function getSizeText(metadata: ExcludePathMetadata): string {
  if (!metadata.exists) return EMPTY_VALUE;
  return formatExcludeByteSize(metadata.totalSizeBytes);
}

function getModifiedText(metadata: ExcludePathMetadata): string {
  if (!metadata.exists) return EMPTY_VALUE;
  return formatExcludeDate(metadata.latestMtimeMs, getPopoverLocale()) ?? EMPTY_VALUE;
}

function getPopoverLocale(): string {
  return getLanguage() === 'ko' ? 'ko-KR' : 'en-US';
}
