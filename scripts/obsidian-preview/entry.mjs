import { ChatView } from '../../src/chat/view';
import { DEFAULT_SETTINGS } from '../../src/settings';
import { RefreshBus } from '../../src/utils/refresh-bus';
import { setLanguage } from '../../src/i18n';
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
      openFile: async (file) => {
        window.preview.openedPath = file.path;
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
  };
  window.preview = { files, failSave: params.has('saveError'), reference, openedPath: null };
  const view = new ChatView(new WorkspaceLeaf(app), plugin);
  window.preview.view = view;
  view.load();
  await view.onOpen();

  if (!['empty', 'blocked'].includes(state)) {
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
      turnStage: state === 'running' ? 'streaming' : state === 'error' ? 'error' : 'complete',
      errorKind: state === 'error' ? 'network' : undefined,
      errorMessage: state === 'error' ? '합성 네트워크 오류' : undefined,
      stopReason: state === 'cancelled' ? 'cancelled' : undefined,
      citations: [
        {
          id: 'source-1',
          filePath: 'Examples/Topic.md',
          status: 'verified',
          preview: '관련된 생각을 모아 비교합니다. / Group related ideas.',
          line: 1,
        },
        {
          id: 'source-2',
          filePath: 'Examples/Daily.md',
          status: 'verified',
          preview: '시간에 따른 변화를 살핍니다. / Follow changes over time.',
          line: 2,
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
      ['answer', 'empty', 'blocked', 'running', 'error', 'partial', 'cancelled'],
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
    check(
      messages.getBoundingClientRect().bottom <= shell.getBoundingClientRect().bottom + 1,
      '답변 스크롤 영역이 입력 영역을 침범하지 않음',
    );
    window.preview.checks = checks;
    document.getElementById('preview-result').textContent =
      `호스트 계약 ${checks.length}개 통과 · ${reference.cssSha256.slice(0, 12)} · 임의 Markdown은 일반 텍스트, 합성 답변은 실제 Obsidian 렌더 결과`;
    return checks;
  }
  window.preview.checkHost = checkHost;
  toolbar.createEl('button', { text: '호스트 계약 검사' }).addEventListener('click', () => {
    void checkHost().catch(reportFailure);
  });
  async function checkAll() {
    const host = await checkHost();
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
    '제품 ChatView·출처 패널·저장 모달 실행 중. 검색·LLM·디스크 저장은 모의 환경입니다.';
  if (params.has('check')) await checkAll();
}
void start().catch(reportFailure);
