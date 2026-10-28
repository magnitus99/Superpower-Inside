import { ItemView, Notice, TFile, setIcon, type WorkspaceLeaf } from 'obsidian';
import { t } from '../i18n';
import { formatRagEtaDuration } from '../rag/indexing-progress';
import { describeSearchStatus, type SearchStatusSnapshot } from '../rag/search-status';
import type { PluginLike } from '../settings';
import {
  groupEvidenceByPath,
  type SearchEvidence,
  type SearchFilters,
  type SearchPort,
  type SearchResponse,
} from './engine-port';
import {
  countSearchResults,
  formatLineRange,
  modifiedAfterFromPreset,
  parseFilterList,
  splitHighlightedText,
} from './view-state';

export const SEARCH_VIEW_TYPE = 'superpower-inside-search';

const HIDDEN_CLASS = 'superpower-inside-hidden';
const ACTIVE_CLASS = 'is-active';
const WARNING_CLASS = 'is-warning';
const PASSAGE_CLASS = 'superpower-inside-search-passage';

export interface SearchViewHost {
  app: PluginLike['app'];
  logger: Pick<PluginLike['logger'], 'warn' | 'error'>;
  refreshBus: PluginLike['refreshBus'];
  getSearchStatusSnapshot(): SearchStatusSnapshot;
  getSearchPort(): SearchPort | null;
}

export interface SearchResultHandlers {
  openEvidence(evidence: SearchEvidence): void;
}

interface PendingSearch {
  query: string;
  filters?: SearchFilters;
  /** 준비가 끝나면 한 번 자동으로 이어갈 수 있는지 여부입니다. */
  autoResume: boolean;
}

/** 준비 중 전환과 색인 세대 변화를 구분하기 위한 안정적인 상태 서명입니다. */
function searchStatusSignature(snapshot: SearchStatusSnapshot): string {
  return [
    snapshot.readiness,
    snapshot.indexing ? 'indexing' : 'idle',
    snapshot.ragStatus?.totalDocuments ?? -1,
    snapshot.ragStatus?.totalVectors ?? -1,
    snapshot.ragStatus?.staleDocuments ?? -1,
    snapshot.ragStatus?.missingDocuments ?? -1,
  ].join('|');
}

/** 엔진이 준 순서 그대로 결과 목록을 만든다. 점수 재계산·재정렬은 하지 않는다. */
export function createSearchResultList(
  container: HTMLElement,
  response: SearchResponse,
  handlers: SearchResultHandlers,
): HTMLElement[] {
  container.empty();
  const items: HTMLElement[] = [];
  for (const group of groupEvidenceByPath(response.evidence)) {
    const groupEl = container.createDiv({ cls: 'superpower-inside-search-group' });
    const header = groupEl.createDiv({ cls: 'superpower-inside-search-group-header' });
    const first = group.evidence[0];
    const pathButton = header.createEl('button', {
      cls: 'superpower-inside-search-path',
      text: group.path,
      attr: { type: 'button' },
    });
    pathButton.addEventListener('click', () => {
      if (first) handlers.openEvidence(first);
    });
    header.createSpan({
      cls: 'superpower-inside-search-group-count',
      text: t('searchResultGroupCount', { count: group.evidence.length }),
    });

    for (const evidence of group.evidence) {
      const item = groupEl.createDiv({
        cls: PASSAGE_CLASS,
        attr: { role: 'listitem', tabindex: '0' },
      });
      const quote = item.createEl('p', { cls: 'superpower-inside-search-quote' });
      const doc = quote.ownerDocument;
      for (const segment of splitHighlightedText(evidence.quote, evidence.highlights ?? [])) {
        if (segment.highlighted) quote.createEl('mark', { text: segment.text });
        else quote.appendChild(doc.createTextNode(segment.text));
      }

      const meta = item.createDiv({ cls: 'superpower-inside-search-meta' });
      meta.createSpan({
        cls: 'superpower-inside-search-location',
        text: t('searchResultLineLabel', {
          range: formatLineRange(evidence.startLine, evidence.endLine),
        }),
      });
      const signals = [evidence.signal, ...evidence.exactSignals].filter((value) => value.length > 0);
      if (signals.length > 0) {
        meta.createSpan({
          cls: 'superpower-inside-search-signals',
          text: t('searchResultSignals', { signals: signals.join(', ') }),
        });
      }
      if (evidence.duplicateOf !== null) {
        meta.createSpan({
          cls: 'superpower-inside-search-duplicate',
          text: t('searchResultDuplicate'),
        });
      }

      item.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        handlers.openEvidence(evidence);
      });
      items.push(item);
    }
  }
  return items;
}

export class SearchView extends ItemView {
  private readonly host: SearchViewHost;
  private queryInput: HTMLInputElement | null = null;
  private runButton: HTMLButtonElement | null = null;
  private cancelButton: HTMLButtonElement | null = null;
  private filterToggleButton: HTMLButtonElement | null = null;
  private filtersEl: HTMLElement | null = null;
  private folderInput: HTMLInputElement | null = null;
  private extensionInput: HTMLInputElement | null = null;
  private tagInput: HTMLInputElement | null = null;
  private modifiedSelect: HTMLSelectElement | null = null;
  private indexEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private diagnosticsEl: HTMLElement | null = null;
  private resultsEl: HTMLElement | null = null;
  private resultItems: HTMLElement[] = [];
  private activeResultIndex = 0;
  private runController: AbortController | null = null;
  private pendingSearch: PendingSearch | null = null;
  private statusSignature = '';
  private indexEpoch = 0;
  private unsubscribeRefresh: (() => void) | null = null;

  constructor(leaf: WorkspaceLeaf, host: SearchViewHost) {
    super(leaf);
    this.host = host;
  }

  getViewType(): string {
    return SEARCH_VIEW_TYPE;
  }

  getDisplayText(): string {
    return t('searchViewTitle');
  }

  async onOpen(): Promise<void> {
    await Promise.resolve();
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass('superpower-inside-search-container');

    this.buildSearchBar(root);
    this.buildFilterPanel(root);
    this.indexEl = root.createDiv({
      cls: 'superpower-inside-search-index',
      attr: { 'aria-label': t('searchStatusReadinessLabel') },
    });
    this.statusEl = root.createDiv({
      cls: 'superpower-inside-search-status',
      attr: { role: 'status', 'aria-live': 'polite' },
    });
    this.diagnosticsEl = root.createDiv({ cls: 'superpower-inside-search-diagnostics' });
    this.resultsEl = root.createDiv({
      cls: 'superpower-inside-search-results',
      attr: { role: 'list', 'aria-label': t('searchResultsListLabel') },
    });

    root.addEventListener('keydown', (event) => this.handleKeydown(event));
    this.unsubscribeRefresh = this.host.refreshBus.on('rag', () => this.handleRagRefresh());
    this.renderIndexState();
    this.renderIdle();
  }

  async onClose(): Promise<void> {
    await Promise.resolve();
    this.pendingSearch = null;
    this.cancelRun();
    this.unsubscribeRefresh?.();
    this.unsubscribeRefresh = null;
  }

  private buildSearchBar(root: HTMLElement): void {
    const bar = root.createDiv({ cls: 'superpower-inside-search-bar' });
    const form = bar.createEl('form', {
      cls: 'superpower-inside-search-form',
      attr: { role: 'search' },
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.runSearch();
    });
    this.queryInput = form.createEl('input', {
      cls: 'superpower-inside-search-input',
      attr: {
        type: 'search',
        'aria-label': t('searchQueryLabel'),
        placeholder: t('searchQueryPlaceholder'),
        spellcheck: 'false',
      },
    });
    this.runButton = form.createEl('button', {
      cls: 'superpower-inside-search-run',
      text: t('searchRun'),
      attr: { type: 'submit' },
    });
    this.cancelButton = form.createEl('button', {
      cls: 'superpower-inside-search-cancel',
      attr: { type: 'button', 'aria-label': t('searchCancel') },
    });
    setIcon(this.cancelButton, 'x');
    this.cancelButton.addEventListener('click', () => this.cancelRun());
    this.filterToggleButton = bar.createEl('button', {
      cls: 'superpower-inside-search-filter-toggle',
      text: t('searchFiltersToggle'),
      attr: { type: 'button', 'aria-expanded': 'false' },
    });
    this.filterToggleButton.addEventListener('click', () => this.toggleFilters());
    bar.createSpan({ cls: 'superpower-inside-search-hint', text: t('searchResultOpenHint') });
    this.setRunning(false);
  }

  private buildFilterPanel(root: HTMLElement): void {
    this.filtersEl = root.createDiv({ cls: 'superpower-inside-search-filters' });
    this.filtersEl.toggleClass(HIDDEN_CLASS, true);
    const filters = this.filtersEl;
    this.folderInput = this.buildFilterRow(
      filters,
      t('searchFilterFolder'),
      t('searchFilterFolderPlaceholder'),
    );
    this.extensionInput = this.buildFilterRow(
      filters,
      t('searchFilterExtension'),
      t('searchFilterExtensionPlaceholder'),
    );
    this.tagInput = this.buildFilterRow(
      filters,
      t('searchFilterTag'),
      t('searchFilterTagPlaceholder'),
    );

    const row = filters.createDiv({ cls: 'superpower-inside-search-filter-row' });
    const field = row.createEl('label', { cls: 'superpower-inside-search-filter-field' });
    field.createSpan({ cls: 'superpower-inside-search-filter-label', text: t('searchFilterModified') });
    this.modifiedSelect = field.createEl('select', {
      cls: 'dropdown superpower-inside-search-filter-input',
      attr: { 'aria-label': t('searchFilterModified') },
    });
    const presets: Array<[string, string]> = [
      ['any', t('searchFilterModifiedAny')],
      ['week', t('searchFilterModifiedWeek')],
      ['month', t('searchFilterModifiedMonth')],
      ['year', t('searchFilterModifiedYear')],
    ];
    for (const [value, label] of presets) {
      this.modifiedSelect.createEl('option', { value, text: label });
    }

    const reset = filters.createEl('button', {
      cls: 'superpower-inside-search-filter-reset',
      text: t('searchFilterReset'),
      attr: { type: 'button' },
    });
    reset.addEventListener('click', () => this.resetFilters());
  }

  private buildFilterRow(
    parent: HTMLElement,
    label: string,
    placeholder: string,
  ): HTMLInputElement {
    const row = parent.createDiv({ cls: 'superpower-inside-search-filter-row' });
    const field = row.createEl('label', { cls: 'superpower-inside-search-filter-field' });
    field.createSpan({ cls: 'superpower-inside-search-filter-label', text: label });
    return field.createEl('input', {
      cls: 'superpower-inside-search-filter-input',
      attr: { type: 'text', placeholder, spellcheck: 'false', 'aria-label': label },
    });
  }

  private toggleFilters(): void {
    const filters = this.filtersEl;
    const button = this.filterToggleButton;
    if (!filters || !button) return;
    const expanded = filters.hasClass(HIDDEN_CLASS);
    filters.toggleClass(HIDDEN_CLASS, !expanded);
    button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    button.toggleClass(ACTIVE_CLASS, expanded);
  }

  private resetFilters(): void {
    if (this.folderInput) this.folderInput.value = '';
    if (this.extensionInput) this.extensionInput.value = '';
    if (this.tagInput) this.tagInput.value = '';
    if (this.modifiedSelect) this.modifiedSelect.value = 'any';
  }

  private readFilters(): SearchFilters | undefined {
    const filters: SearchFilters = {};
    const pathPrefixes = parseFilterList(this.folderInput?.value ?? '');
    if (pathPrefixes.length > 0) filters.pathPrefixes = pathPrefixes;
    const extensions = parseFilterList(this.extensionInput?.value ?? '').map((value) =>
      value.replace(/^\./u, '').toLowerCase(),
    );
    if (extensions.length > 0) filters.extensions = extensions;
    const tags = parseFilterList(this.tagInput?.value ?? '').map((value) =>
      value.replace(/^#/u, ''),
    );
    if (tags.length > 0) filters.tags = tags;
    const modifiedAfter = modifiedAfterFromPreset(
      this.modifiedSelect?.value ?? 'any',
      Date.now(),
    );
    if (modifiedAfter !== undefined) filters.modifiedAfter = modifiedAfter;
    return Object.keys(filters).length > 0 ? filters : undefined;
  }

  private renderIndexState(): void {
    const el = this.indexEl;
    if (!el) return;
    el.empty();
    el.removeClass(WARNING_CLASS);
    const snapshot = this.host.getSearchStatusSnapshot();
    this.noteStatusSnapshot(snapshot);
    const status = snapshot.ragStatus;
    const hasDocuments = (status?.totalDocuments ?? 0) > 0;
    const indexing = snapshot.indexing;
    if (indexing && indexing.totalFiles > 0) {
      el.setText(
        indexing.etaRemainingMs !== null
          ? t('searchIndexProgressEta', {
              completed: Math.min(indexing.completedFiles, indexing.totalFiles),
              total: indexing.totalFiles,
              eta: formatRagEtaDuration(indexing.etaRemainingMs),
            })
          : t('searchIndexProgress', {
              completed: Math.min(indexing.completedFiles, indexing.totalFiles),
              total: indexing.totalFiles,
            }),
      );
      // 진행 중에도 질의를 대기 등록할 수 있도록 제출 경로를 열어 둡니다.
      this.setRunEnabled(true);
      return;
    }
    if (snapshot.readiness !== 'ready') {
      // 준비 중에는 부분 색인을 결과 근거로 쓰지 않습니다. 확인된 제한(degraded)만
      // 이미 색인된 문서 범위에서 검색을 허용하고, preparing은 대기 등록을 받습니다.
      const description = describeSearchStatus(snapshot);
      el.setText(
        description.detail ? `${description.label} · ${description.detail}` : description.label,
      );
      el.addClass(WARNING_CLASS);
      this.setRunEnabled(
        snapshot.readiness === 'preparing' ||
          (snapshot.readiness === 'degraded' && hasDocuments),
      );
      return;
    }
    if (!status) {
      el.setText(t('searchIndexMissing'));
      el.addClass(WARNING_CLASS);
      this.setRunEnabled(false);
      return;
    }
    if (!hasDocuments) {
      el.setText(t('searchIndexEmpty'));
      el.addClass(WARNING_CLASS);
      this.setRunEnabled(false);
      return;
    }
    this.setRunEnabled(true);
    const pending = status.staleDocuments + status.missingDocuments;
    if (pending > 0) {
      el.setText(t('searchIndexStale', { count: pending }));
      el.addClass(WARNING_CLASS);
    }
  }

  private renderIdle(): void {
    this.clearResults();
    this.setStatusText(t('searchStatusIdle'), false);
  }

  private renderSearching(): void {
    this.clearResults();
    this.setStatusText(t('searchStatusSearching'), false);
  }

  private renderUnavailable(): void {
    this.clearResults();
    this.setStatusText(t('searchStatusUnavailable'), true);
  }

  private renderFailed(error: unknown): void {
    this.clearResults();
    const message = error instanceof Error ? error.message : String(error);
    this.setStatusText(t('searchStatusFailed', { message }), true);
  }

  private renderResponse(response: SearchResponse): void {
    const counts = countSearchResults(response);
    if (counts.passages === 0) {
      this.clearResults();
      this.setStatusText(
        response.staleDocuments > 0
          ? t('searchStatusStaleNoResults', { count: response.staleDocuments })
          : t('searchStatusEmpty'),
        true,
      );
      this.renderEmptyDiagnostics(response);
      return;
    }
    this.renderDiagnostics(response);
    this.setStatusText(
      t('searchStatusResults', { count: counts.passages, documents: counts.documents }),
      response.staleDocuments > 0,
    );
    if (!this.resultsEl) return;
    this.resultItems = createSearchResultList(this.resultsEl, response, {
      openEvidence: (evidence) => this.openEvidence(evidence),
    });
    // 신뢰도 높은 결과를 먼저 보여 주고, 다른 해석 후보는 목록 뒤에 붙입니다.
    this.appendInterpretationNotice(response, this.resultsEl);
    this.resultItems.forEach((item, index) => {
      item.addEventListener('focus', () => {
        this.activeResultIndex = index;
        this.markActiveResult();
      });
    });
    this.activeResultIndex = 0;
    this.markActiveResult();
  }

  private renderEmptyDiagnostics(response: SearchResponse): void {
    const el = this.diagnosticsEl;
    if (!el) return;
    const reason = response.diagnostics.zeroHitReason;
    if (reason !== null) {
      el.createDiv({
        cls: 'superpower-inside-search-diagnostic',
        text: t('searchStatusEmptyReason', { reason }),
      });
    }
    if (response.diagnostics.unmatchedTerms.length > 0) {
      el.createDiv({
        cls: 'superpower-inside-search-diagnostic',
        text: t('searchStatusUnmatched', { terms: response.diagnostics.unmatchedTerms.join(', ') }),
      });
    }
    this.appendCoverageNotice(response, el);
    this.appendInterpretationNotice(response, el);
  }

  /**
   * 확신도가 높지 않을 때 다른 해석 후보를 덧붙입니다.
   * 답변을 막고 되묻지 않고, 이미 보여 준 결과 뒤에 한 줄로 안내합니다.
   */
  private appendInterpretationNotice(response: SearchResponse, el: HTMLElement): void {
    const alternatives = response.alternativeInterpretations ?? [];
    if (response.confidence === 'high' || alternatives.length === 0) return;
    el.createDiv({
      cls: 'superpower-inside-search-diagnostic',
      text: t('searchStatusOtherInterpretations', {
        paths: alternatives.join(', '),
      }),
    });
  }

  private renderDiagnostics(response: SearchResponse): void {
    const el = this.diagnosticsEl;
    if (!el) return;
    el.empty();
    const { diagnostics } = response;
    if (response.staleDocuments > 0) {
      el.createDiv({
        cls: 'superpower-inside-search-diagnostic is-warning',
        text: t('searchStatusStale', { count: response.staleDocuments }),
      });
    }
    this.appendCoverageNotice(response, el);
    if (diagnostics.unmatchedTerms.length > 0) {
      el.createDiv({
        cls: 'superpower-inside-search-diagnostic',
        text: t('searchStatusUnmatched', { terms: diagnostics.unmatchedTerms.join(', ') }),
      });
    }
    el.createDiv({
      cls: 'superpower-inside-search-diagnostic is-note',
      text: t('searchScoreNotice'),
    });
  }

  /** 후보 범위 검색과 예산에 따른 일부 검토를 전체 색인 검토로 오인하지 않게 알린다. */
  private appendCoverageNotice(response: SearchResponse, el: HTMLElement): void {
    if (response.coverage.documentScope !== 'candidates' && !response.diagnostics.truncated) return;
    el.createDiv({
      cls:
        response.coverage.documentScope === 'candidates'
          ? 'superpower-inside-search-diagnostic is-warning'
          : 'superpower-inside-search-diagnostic',
      text: t('searchStatusTruncated', {
        total: response.coverage.reviewedDocuments,
        candidate: response.diagnostics.candidateDocuments,
        selected: response.diagnostics.selectedDocuments,
      }),
    });
  }

  private clearResults(): void {
    this.resultsEl?.empty();
    this.diagnosticsEl?.empty();
    this.resultItems = [];
    this.activeResultIndex = 0;
  }

  private setStatusText(text: string, warning: boolean): void {
    const el = this.statusEl;
    if (!el) return;
    el.setText(text);
    el.toggleClass(WARNING_CLASS, warning);
  }

  private setRunEnabled(enabled: boolean): void {
    if (!this.runButton) return;
    this.runButton.disabled = !enabled;
  }

  private setRunning(running: boolean): void {
    this.cancelButton?.toggleClass(HIDDEN_CLASS, !running);
    this.runButton?.toggleClass(ACTIVE_CLASS, running);
  }

  private markActiveResult(): void {
    this.resultItems.forEach((item, index) => {
      item.toggleClass(ACTIVE_CLASS, index === this.activeResultIndex);
    });
  }

  private handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && (this.runController || this.pendingSearch)) {
      event.preventDefault();
      this.cancelRun();
      this.renderIdle();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    if (this.resultItems.length === 0) return;
    event.preventDefault();
    const delta = event.key === 'ArrowDown' ? 1 : -1;
    const next = Math.min(Math.max(this.activeResultIndex + delta, 0), this.resultItems.length - 1);
    this.activeResultIndex = next;
    this.markActiveResult();
    this.resultItems[next]?.focus();
  }

  /** readiness·색인 수가 바뀌면 세대를 올려 진행 중 결과의 유효성을 판정합니다. */
  private noteStatusSnapshot(snapshot: SearchStatusSnapshot): void {
    const signature = searchStatusSignature(snapshot);
    if (this.statusSignature !== '' && this.statusSignature !== signature) {
      this.indexEpoch += 1;
    }
    this.statusSignature = signature;
  }

  /** 준비가 끝나면 보존한 검색을 한 번만 이어갑니다. */
  private handleRagRefresh(): void {
    this.renderIndexState();
    this.resumePendingSearch();
  }

  /** 공통 재개 경로: ready에서 한 번 실행하고, degraded·실패에서는 대기를 버립니다. */
  private resumePendingSearch(): void {
    const pending = this.pendingSearch;
    if (!pending) return;
    const readiness = this.host.getSearchStatusSnapshot().readiness;
    if (readiness === 'degraded') {
      this.pendingSearch = null;
      this.setStatusText(t('searchStatusUnavailable'), true);
      return;
    }
    if (!pending.autoResume) return;
    if (readiness !== 'ready') return;
    this.pendingSearch = null;
    if (this.queryInput) this.queryInput.value = pending.query;
    void this.executeSearch(pending.query, pending.filters, { allowAutoResume: false });
  }

  private cancelRun(): void {
    this.pendingSearch = null;
    const controller = this.runController;
    if (!controller) return;
    this.runController = null;
    controller.abort();
    this.setRunning(false);
    this.renderIdle();
  }

  private async runSearch(): Promise<void> {
    const query = this.queryInput?.value.trim() ?? '';
    if (query.length === 0) {
      this.pendingSearch = null;
      this.renderIdle();
      return;
    }
    const filters = this.readFilters();
    // 준비 중 제출은 이전 실행을 먼저 취소해 늦은 응답이 새 대기를 덮지 않게 합니다.
    if (this.host.getSearchStatusSnapshot().readiness === 'preparing') {
      this.cancelRun();
      this.pendingSearch = { query, filters, autoResume: true };
      this.renderIndexState();
      this.setStatusText(t('searchStatusWaitingForIndex'), false);
      return;
    }
    this.pendingSearch = null;
    await this.executeSearch(query, filters, { allowAutoResume: true });
  }

  private async executeSearch(
    query: string,
    filters: SearchFilters | undefined,
    options: { allowAutoResume: boolean },
  ): Promise<void> {
    const port = this.host.getSearchPort();
    if (!port) {
      this.pendingSearch = null;
      this.renderUnavailable();
      return;
    }
    this.cancelRun();
    const controller = new AbortController();
    this.runController = controller;
    const startEpoch = this.indexEpoch;
    this.renderSearching();
    this.setRunning(true);
    try {
      const response = await port({ query, filters, signal: controller.signal });
      if (controller.signal.aborted || this.runController !== controller) return;
      this.runController = null;
      this.setRunning(false);
      const current = this.host.getSearchStatusSnapshot();
      this.noteStatusSnapshot(current);
      if (current.readiness === 'degraded') {
        this.pendingSearch = null;
        // 확인된 제한은 이미 색인된 문서 범위의 결과를 계속 보여 줍니다.
        // 응답 자체가 없을 때만 사용 불가로 닫습니다.
        if (!response) {
          this.renderUnavailable();
          return;
        }
        this.renderResponse(response);
        return;
      }
      // 준비가 다시 시작됐거나 색인 세대가 달라진 결과는 게시하지 않고 대기로 돌립니다.
      if (current.readiness === 'preparing' || this.indexEpoch !== startEpoch) {
        this.pendingSearch = { query, filters, autoResume: options.allowAutoResume };
        this.renderIndexState();
        if (current.readiness === 'ready' && options.allowAutoResume) {
          // ready 이벤트가 이미 지나갔어도 남은 한 번의 재개를 즉시 시작합니다.
          this.resumePendingSearch();
          return;
        }
        this.setStatusText(
          t(options.allowAutoResume ? 'searchStatusWaitingForIndex' : 'searchStatusIndexChanged'),
          false,
        );
        return;
      }
      if (!response) {
        this.renderUnavailable();
        return;
      }
      this.renderResponse(response);
    } catch (error) {
      if (controller.signal.aborted || this.runController !== controller) return;
      this.runController = null;
      this.setRunning(false);
      this.pendingSearch = null;
      this.host.logger.error('Vault search failed.', { source: 'search.view', error });
      this.renderFailed(error);
    }
  }

  private openEvidence(evidence: SearchEvidence): void {
    const file = this.host.app.vault.getAbstractFileByPath(evidence.path);
    if (!(file instanceof TFile)) {
      new Notice(t('searchFileMissing', { path: evidence.path }));
      return;
    }
    const line = Math.max(0, evidence.startLine - 1);
    void this.host.app.workspace.getLeaf(false).openFile(file, { eState: { line } });
  }
}
