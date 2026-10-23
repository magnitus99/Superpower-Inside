import { ChatView } from '../../src/chat/view';
import { SearchView } from '../../src/search/view';
import { DEFAULT_SETTINGS } from '../../src/settings';
import { RefreshBus } from '../../src/utils/refresh-bus';
import { setLanguage, t } from '../../src/i18n';
import {
  installHost,
  reportFailure,
  Events,
  TFile,
  TFolder,
  WorkspaceLeaf,
  Component,
  Modal,
  Menu,
} from './host.mjs';
import { checkProduct } from './checks.mjs';

async function start() {
  const params = new URLSearchParams(location.search);
  const reference = await (await fetch('/reference.json')).json();
  installHost(reference);
  const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
  const lang = params.get('lang') === 'en' ? 'en' : 'ko';
  const state = params.get('state') ?? 'answer';
  document.body.className = `mod-macos theme-${theme}`;
  document.documentElement.lang = lang;
  setLanguage(lang);
  const width = Number(params.get('width') ?? 420);
  document.body.setCssProps({
    '--preview-width': `${Math.max(240, Math.min(1200, Number.isFinite(width) ? width : 420))}px`,
  });

  const files = new Map();
  const folders = new Map([
    ['', new TFolder()],
    ['Examples', new TFolder('Examples')],
  ]);
  const vault = Object.assign(new Events(), {
    configDir: '.obsidian',
    adapter: { exists: async (path) => files.has(path) || folders.has(path) },
    getAllFolders: () => [...folders.values()],
    getRoot: () => folders.get(''),
    getAbstractFileByPath: (path) => files.get(path)?.file ?? folders.get(path) ?? null,
    getMarkdownFiles: () => [...files.values()].map((entry) => entry.file),
    getFiles: () => [...files.values()].map((entry) => entry.file),
    getAllLoadedFiles: () => [...folders.values(), ...vault.getFiles()],
    createFolder: async (path) => {
      const folder = new TFolder(path);
      folders.set(path, folder);
      vault.trigger('create', folder);
      return folder;
    },
    cachedRead: async (file) => {
      const entry = files.get(file.path);
      if (!entry) throw Error('합성 파일이 없습니다.');
      return entry.content;
    },
    read: async (file) => vault.cachedRead(file),
    create: async (path, content) => {
      await new Promise((done) => setTimeout(done, 300));
      if (window.preview.failSave) throw Error('합성 저장 실패');
      if (files.has(path) || folders.has(path)) throw Error('이미 존재하는 합성 경로입니다.');
      const file = new TFile(path);
      files.set(path, { file, content });
      vault.trigger('create', file);
      return file;
    },
  });
  const workspace = Object.assign(new Events(), {
    getActiveFile: () => null,
    getLeavesOfType: () => [],
    iterateAllLeaves() {},
    getMostRecentLeaf: () => null,
    getActiveViewOfType: () => null,
    getLeaf: () => ({
      openFile: async (file, state) => {
        window.preview.openedPath = file.path;
        window.preview.openedLine = state?.eState?.line ?? null;
      },
    }),
  });
  const app = {
    vault,
    workspace,
    metadataCache: {
      getFileCache: () => null,
      getFirstLinkpathDest: () => null,
      getTags: () => ({}),
    },
    plugins: { plugins: {} },
    setting: {
      open() {
        throw Error('이 검수에서는 설정 화면을 지원하지 않습니다.');
      },
      openTabById() {
        throw Error('설정 화면을 지원하지 않습니다.');
      },
    },
  };
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.chat.autoSaveEnabled = false;
  settings.chat.saveFolder = 'Examples';
  settings.ollama.enabled = state !== 'blocked';
  settings.chat.defaultModel = state === 'blocked' ? '' : 'ollama:llama3.1';
  const logger = Object.fromEntries(
    ['trace', 'debug', 'info', 'notice', 'warn', 'error', 'fatal'].map((name) => [name, () => {}]),
  );
  const plugin = {
    app,
    manifest: { id: 'superpower-inside' },
    settings,
    logger,
    refreshBus: new RefreshBus(),
    mcpRegistry: null,
    ragEngine: null,
    vectorStore: null,
    eventDrivenRagStats: null,
    prepareRagForChat: async () => false,
    getSourceFileProcessingStatus: async () => null,
    isRagIndexing: () => false,
    // ?retrieval=preparing|degraded로 검색 준비 안내를 검수합니다.
    getRetrievalReadiness: () =>
      ['preparing', 'degraded'].includes(params.get('retrieval') ?? '')
        ? params.get('retrieval')
        : 'ready',
  };
  window.preview = {
    files,
    failSave: params.has('saveError'),
    reference,
    openedPath: null,
    openedLine: null,
  };

  // ?state=search는 색인 검색 화면을 합성 엔진 결과로 검수합니다.
  const searchScenario = {
    query: params.get('query') ?? (lang === 'en' ? 'topic organization' : '주제별 정리'),
    empty: params.has('empty'),
    fail: params.has('fail'),
    unavailable: params.has('unavailable'),
    truncated: params.has('truncated'),
    unmatched: params.has('unmatched'),
    stale: params.has('stale'),
    // ?other=1은 확신도가 높지 않을 때의 "다른 해석" 안내를 검수합니다.
    ambiguous: params.has('other'),
  };
  if (state === 'search') {
    for (const path of [
      'Examples/Search-Topic.md',
      'Examples/Search-Daily.md',
    ]) {
      files.set(path, { file: new TFile(path), content: '' });
    }
  }
  const searchHost = {
    app,
    logger,
    refreshBus: plugin.refreshBus,
    getRagRuntimeState: () => ({
      ragStatus: params.has('noindex')
        ? null
        : {
            totalDocuments: Number(params.get('docs') ?? 12),
            staleDocuments: Number(params.get('stale') ?? 0),
            missingDocuments: 0,
          },
      ragIndexingStatus: params.has('indexing')
        ? { running: true, progress: { completedFiles: 3, totalFiles: 12 } }
        : null,
    }),
    isRagIndexing: () => params.has('indexing'),
    // 검색 화면은 색인 상태 스냅샷을 직접 받습니다.
    getSearchStatusSnapshot: () => ({
      readiness: params.has('noindex') ? 'empty' : 'ready',
      keywordIndex: params.has('noindex') ? 'empty' : 'ready',
      ragStatus: params.has('noindex')
        ? null
        : {
            totalDocuments: Number(params.get('docs') ?? 12),
            staleDocuments: Number(params.get('stale') ?? 0),
            missingDocuments: 0,
          },
      indexing: params.has('indexing')
        ? {
            completedFiles: 3,
            totalFiles: 12,
            etaRemainingMs: null,
          }
        : null,
    }),
    getSearchPort: () => {
      if (searchScenario.unavailable) return null;
      return async (request) => {
        await new Promise((done) => setTimeout(done, 120));
        if (searchScenario.fail) {
          throw Error(lang === 'en' ? 'synthetic engine failure' : '합성 엔진 실패');
        }
        const ko = lang === 'ko';
        const evidence = searchScenario.empty || searchScenario.stale
          ? []
          : [
              {
                sourceId: 'search-1',
                path: 'Examples/Search-Topic.md',
                revision: 'rev-1',
                startLine: 4,
                endLine: 6,
                quote: ko
                  ? '주제별 정리는 관련된 생각을 모아 비교하는 기록입니다.'
                  : 'Topic-based organization groups related notes for comparison.',
                contextBefore: '',
                contextAfter: '',
                score: 4.2,
                rank: 1,
                signal: 'phrase',
                phraseMatches: 1,
                proximityScore: 0.7,
                fieldScore: 1,
                exactSignals: [],
                negatedNearby: false,
                duplicateOf: null,
                highlights: [{ start: 0, end: ko ? 7 : 12 }],
              },
              {
                sourceId: 'search-2',
                path: 'Examples/Search-Daily.md',
                revision: 'rev-1',
                startLine: 12,
                endLine: 12,
                quote: ko
                  ? '시간순 기록은 날짜별 변화를 남깁니다.'
                  : 'Chronological notes keep changes next to their dates.',
                contextBefore: '',
                contextAfter: '',
                score: 2.1,
                rank: 2,
                signal: 'bm25',
                phraseMatches: 0,
                proximityScore: 0.2,
                fieldScore: 0.5,
                exactSignals: [],
                negatedNearby: false,
                duplicateOf: null,
                highlights: [{ start: 0, end: ko ? 6 : 13 }],
              },
            ];
        return {
          evidence,
          queryTokens: [
            {
              text: request.query,
              position: 0,
              field: 'content',
              kind: 'term',
              negated: false,
              phraseIndex: null,
            },
          ],
          phrases: [],
          diagnostics: {
            candidateDepth: 8,
            candidateDocuments: 24,
            selectedDocuments: 2,
            truncated: searchScenario.truncated,
            droppedDocuments: { budget: 2, belowThreshold: 9, filtered: 0 },
            unmatchedTerms: searchScenario.unmatched ? ['quarz'] : [],
            zeroHitReason: searchScenario.empty ? 'no-candidate' : null,
          },
          coverage: {
            status: searchScenario.stale ? 'incomplete' : 'supported',
            reviewedDocuments: 2,
            unreviewedDocuments: 0,
            notIndexedDocuments: 0,
          },
          staleDocuments: searchScenario.stale ? 1 : 0,
          confidence: searchScenario.empty
            ? 'low'
            : searchScenario.ambiguous
              ? 'medium'
              : 'high',
          alternativeInterpretations: searchScenario.ambiguous
            ? ['Examples/Search-Daily.md']
            : [],
        };
      };
    },
  };

  const view =
    state === 'search'
      ? new SearchView(new WorkspaceLeaf(app), searchHost)
      : new ChatView(new WorkspaceLeaf(app), plugin);
  window.preview.view = view;
  view.load();
  await view.onOpen();

  if (state === 'search') {
    window.preview.runSearch = async (query) => {
      const input = document.querySelector('.superpower-inside-search-input');
      const form = document.querySelector('.superpower-inside-search-form');
      if (!input || !form) throw Error('검색 입력을 찾지 못했습니다.');
      input.value = query ?? searchScenario.query;
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await new Promise((done) => setTimeout(done, 260));
    };
    if (!params.has('idle')) await window.preview.runSearch();
  } else if (!['empty', 'blocked'].includes(state)) {
    view.addMessage(
      'user',
      lang === 'en'
        ? 'Compare two ways of organizing notes.'
        : '노트를 정리하는 두 방식을 비교해줘.',
      undefined,
      undefined,
      { status: 'complete' },
    );
    view.addMessage('assistant', reference.markdown[lang], undefined, undefined, {
      status: state === 'running' ? 'streaming' : state === 'error' ? 'error' : 'complete',
      turnStage: state === 'running' ? 'streaming-answer' : state === 'error' ? 'error' : 'complete',
      errorKind: state === 'error' ? 'network' : undefined,
      errorMessage: state === 'error' ? '합성 네트워크 오류' : undefined,
      stopReason: state === 'cancelled' ? 'cancelled' : undefined,
      usageSnapshot:
        params.get('diagnostics') === 'missing'
          ? undefined
          : {
              requests: 3,
              reportedRequests: state === 'partial' ? 2 : 3,
              inputTokens: 12450,
              outputTokens: 690,
              totalTokens: 13140,
              cacheReadTokens: 2048,
              reasoningTokens: 240,
            },
      retrievalTrace:
        params.get('diagnostics') === 'missing'
          ? undefined
          : [
              {
                query:
                  lang === 'en'
                    ? 'Compare topic-based and chronological organization'
                    : '주제별 정리와 시간순 정리 비교',
                diagnostics: [
                  {
                    providerId: 'query-embedding',
                    source: 'embedding',
                    status: state === 'error' ? 'error' : 'ok',
                    durationMs: 36,
                    candidateCount: 0,
                    readiness: state === 'error' ? 'degraded' : 'ready',
                    estimatedCost: 'free',
                    error:
                      state === 'error'
                        ? '합성 임베딩 요청 실패 / Synthetic embedding failure'
                        : undefined,
                  },
                  {
                    providerId: 'bm25',
                    source: 'bm25',
                    status: 'ok',
                    durationMs: 8,
                    candidateCount: 5,
                    readiness: 'ready',
                    estimatedCost: 'free',
                  },
                  {
                    providerId: 'exact-vector',
                    source: 'vector',
                    status: state === 'partial' ? 'timeout' : 'ok',
                    durationMs: 19,
                    candidateCount: state === 'partial' ? 0 : 4,
                    readiness: state === 'partial' ? 'degraded' : 'ready',
                    estimatedCost: 'free',
                  },
                ],
                results: [
                  {
                    filePath: 'Examples/Topic.md',
                    line: 1,
                    bm25Score: 3.42,
                    vectorScore: 0.81,
                    selectionReason: 'keyword-vector',
                  },
                  {
                    filePath: 'Examples/Daily.md',
                    line: 2,
                    bm25Score: 1.7,
                    vectorScore: 0.72,
                    selectionReason: 'keyword-vector',
                  },
                ],
              },
            ],
      citations: [
        {
          id: 'source-1',
          filePath: 'Examples/Topic.md',
          status: 'verified',
          preview: '관련된 생각을 모아 비교합니다. / Group related ideas.',
          line: 1,
          bm25Score: 3.42,
          vectorScore: 0.81,
          selectionReason: 'keyword-vector',
        },
        {
          id: 'source-2',
          filePath: 'Examples/Daily.md',
          status: 'verified',
          preview: '시간에 따른 변화를 살핍니다. / Follow changes over time.',
          line: 2,
          bm25Score: 1.7,
          vectorScore: 0.72,
          selectionReason: 'keyword-vector',
        },
      ],
      sourceWarnings:
        state === 'partial'
          ? [
              {
                id: 'limited',
                kind: 'unverified-source',
                label: '일부 자료 미확인',
                detail: '합성 시나리오에서 확인 범위를 제한했습니다.',
              },
            ]
          : undefined,
    });
    if (state === 'running') view.setLoading(true);
  }

  const toolbar = document.getElementById('preview-toolbar');
  toolbar.createSpan({
    text: `Obsidian ${reference.version} · 공식 기본 CSS · 합성 자료 · 외부 요청 차단`,
  });
  for (const [key, label, values, selected] of [
    ['width', '패널 폭', ['320', '420', '520', '800'], String(width)],
    ['theme', '테마', ['light', 'dark'], theme],
    ['lang', '언어', ['ko', 'en'], lang],
    [
      'state',
      '상태',
      ['answer', 'empty', 'blocked', 'running', 'error', 'partial', 'cancelled', 'search'],
      state,
    ],
  ]) {
    const field = toolbar.createEl('label', { text: label });
    const select = field.createEl('select');
    for (const value of values) select.createEl('option', { text: value, value });
    select.value = selected;
    select.addEventListener('change', () => {
      params.set(key, select.value);
      location.search = params.toString();
    });
  }
  const failLabel = toolbar.createEl('label', { text: '저장 실패' });
  const failSave = failLabel.createEl('input', { type: 'checkbox' });
  failSave.checked = window.preview.failSave;
  failSave.addEventListener('change', () => {
    window.preview.failSave = failSave.checked;
  });

  async function checkHost() {
    const checks = [];
    function check(condition, name) {
      if (!condition) throw Error(`검수 실패: ${name}`);
      checks.push(name);
    }
    await document.fonts.ready;
    const button = document.body.createEl('button', { text: '검수', cls: 'preview-calibration' });
    const computed = getComputedStyle(button);
    const expected = reference.measurements[`theme-${theme}`];
    for (const [property, value] of Object.entries(expected))
      check(computed.getPropertyValue(property) === value, `기본 버튼 ${property}`);
    button.remove();
    const component = new Component();
    const eventTarget = new EventTarget();
    let calls = 0;
    component.registerDomEvent(eventTarget, 'change', () => calls++);
    component.unload();
    eventTarget.dispatchEvent(new Event('change'));
    check(calls === 0, '이벤트 해제');
    const trigger = toolbar.createEl('button', { text: '모달 검수' });
    trigger.focus();
    const modal = new Modal(app);
    modal.setTitle('모달 계약');
    const first = modal.contentEl.createEl('input', { attr: { 'aria-label': '첫 입력' } });
    const last = modal.contentEl.createEl('button', { text: '끝 버튼' });
    modal.open();
    await Promise.resolve();
    last.focus();
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
    );
    check(
      modal.modalEl.contains(document.activeElement) && document.activeElement !== last,
      '모달 포커스 순환',
    );
    first.focus();
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    check(
      !modal.containerEl.isConnected && document.activeElement === trigger,
      'Escape와 포커스 복귀',
    );
    const menu = new Menu();
    let selected = false;
    menu.addItem((item) =>
      item.setTitle('첫 행동').onClick(() => {
        selected = true;
      }),
    );
    menu.addItem((item) => item.setTitle('두 번째 행동').onClick(() => {}));
    menu.showAtPosition({ x: 20, y: 80 });
    menu.element.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }),
    );
    check(document.activeElement.textContent.includes('두 번째'), '메뉴 키보드 이동');
    menu.element.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }),
    );
    document.activeElement.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    check(selected && !menu.element.isConnected, '메뉴 실행·닫기');
    trigger.remove();
    check(document.documentElement.scrollWidth <= window.innerWidth, '전체 가로 넘침 없음');
    const shell = document.querySelector('.superpower-inside-chat-messages-shell');
    const messages = document.querySelector('.superpower-inside-chat-messages');
    if (shell && messages) {
      check(
        messages.getBoundingClientRect().bottom <= shell.getBoundingClientRect().bottom + 1,
        '답변 스크롤 영역이 입력 영역을 침범하지 않음',
      );
    }
    window.preview.checks = checks;
    document.getElementById('preview-result').textContent =
      state === 'search'
        ? `호스트 계약 ${checks.length}개 통과 · ${reference.cssSha256.slice(0, 12)} · 합성 검색 결과`
        : `호스트 계약 ${checks.length}개 통과 · ${reference.cssSha256.slice(0, 12)} · 임의 Markdown은 일반 텍스트, 합성 답변은 실제 Obsidian 렌더 결과`;
    return checks;
  }
  window.preview.checkHost = checkHost;
  toolbar.createEl('button', { text: '호스트 계약 검사' }).addEventListener('click', () => {
    void checkHost().catch(reportFailure);
  });
  async function checkSearch() {
    const checks = [];
    function check(condition, name) {
      if (!condition) throw Error(`검수 실패: ${name}`);
      checks.push(name);
    }
    const root = document.querySelector('.superpower-inside-search-container');
    check(Boolean(root), '검색 화면 컨테이너');
    const input = root.querySelector('.superpower-inside-search-input');
    check(input?.getAttribute('aria-label') === t('searchQueryLabel'), '검색 입력 라벨');
    check(
      root.querySelector('.superpower-inside-search-results')?.getAttribute('role') === 'list',
      '결과 목록 role',
    );
    check(
      root
        .querySelector('.superpower-inside-search-filters')
        ?.hasClass('superpower-inside-hidden') === true,
      '필터 기본 접힘',
    );
    if (params.has('unavailable')) {
      check(
        root.querySelector('.superpower-inside-search-status')?.textContent ===
          t('searchStatusUnavailable'),
        '엔진 사용 불가 상태',
      );
    } else if (params.has('fail')) {
      check(
        root
          .querySelector('.superpower-inside-search-status')
          ?.textContent.startsWith(t('searchStatusFailed', { message: '' }).split(':')[0]),
        '검색 실패 상태',
      );
    } else if (params.has('stale')) {
      check(
        root.querySelector('.superpower-inside-search-status')?.textContent ===
          t('searchStatusStaleNoResults', { count: 1 }),
        '오래된 색인 상태',
      );
      check(
        root.querySelector('.superpower-inside-search-status')?.hasClass('is-warning') === true,
        '오래된 색인 경고 표시',
      );
    } else if (params.has('empty')) {
      check(
        root.querySelector('.superpower-inside-search-status')?.textContent ===
          t('searchStatusEmpty'),
        '빈 결과 상태',
      );
      check(
        root.textContent.includes(t('searchStatusEmptyReason', { reason: 'no-candidate' })),
        '빈 결과 사유',
      );
    } else {
      const passages = root.querySelectorAll('.superpower-inside-search-passage');
      check(passages.length === 2, '결과 구절 렌더');
      check(
        passages[0].querySelector('mark')?.textContent.length > 0,
        '강조 구간 표시',
      );
      check(
        root.querySelectorAll('.superpower-inside-search-path').length === 2,
        '파일별 그룹',
      );
      input.focus();
      root.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
      );
      check(document.activeElement === passages[1], '키보드 결과 이동');
      passages[1].dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
      check(window.preview.openedPath === 'Examples/Search-Daily.md', '결과에서 문서 열기');
      check(window.preview.openedLine === 11, '원문 줄 위치 전달');
    }
    check(document.documentElement.scrollWidth <= window.innerWidth, '전체 가로 넘침 없음');
    return checks;
  }

  async function checkAll() {
    const host = await checkHost();
    if (state === 'search') {
      const search = await checkSearch();
      window.preview.checks = [...host, ...search];
      const result = document.getElementById('preview-result');
      result.dataset.failed = 'false';
      result.textContent = `기본 스타일·호스트 ${host.length}개 / 검색 화면 ${search.length}개 통과 · Obsidian ${reference.version} · ${reference.cssSha256.slice(0, 12)}`;
      return;
    }
    const product = await checkProduct({
      app,
      files,
      reference,
      lang,
      preview: window.preview,
      toolbar,
    });
    window.preview.checks = [...host, ...product];
    const result = document.getElementById('preview-result');
    result.dataset.failed = 'false';
    result.textContent = `기본 스타일·호스트 ${host.length}개 / 실제 저장 계약 ${product.length}개 통과 · Obsidian ${reference.version} · ${reference.cssSha256.slice(0, 12)}`;
  }
  toolbar.createEl('button', { text: '제품 계약 검사' }).addEventListener('click', () => {
    void checkAll().catch(reportFailure);
  });
  window.addEventListener('error', (event) => reportFailure(event.error ?? event.message));
  window.addEventListener('unhandledrejection', (event) => reportFailure(event.reason));
  document.getElementById('preview-result').textContent =
    state === 'search'
      ? '제품 SearchView 실행 중. 색인 엔진은 합성 결과이며 LLM을 호출하지 않습니다.'
      : '제품 ChatView·출처 패널·저장 모달 실행 중. 검색·LLM·디스크 저장은 모의 환경입니다.';
  if (params.has('check')) await checkAll();
}
void start().catch(reportFailure);
