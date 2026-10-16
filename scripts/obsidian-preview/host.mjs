// 제품 번들에는 포함되지 않는 브라우저 검수용 호스트입니다.
let reference;
export function installHost(data) {
  reference = data;
  window.activeDocument = document;
  window.activeWindow = window;
  window.require = (name) => {
    throw Error(`검수 환경에서 Node 모듈을 실행할 수 없습니다: ${name}`);
  };
  const methods = {
    createEl(tag, options = {}) {
      return createElement(this, tag, options);
    },
    createDiv(options) {
      return createElement(this, 'div', options);
    },
    createSpan(options) {
      return createElement(this, 'span', options);
    },
    empty() {
      this.replaceChildren();
    },
    setText(text) {
      this.textContent = text;
    },
    addClass(...names) {
      this.classList.add(...names);
    },
    removeClass(...names) {
      this.classList.remove(...names);
    },
    toggleClass(name, enabled) {
      this.classList.toggle(name, enabled);
    },
    hasClass(name) {
      return this.classList.contains(name);
    },
    setCssProps(properties) {
      for (const [key, value] of Object.entries(properties)) this.style.setProperty(key, value);
    },
    instanceOf(type) {
      return this instanceof type;
    },
  };
  for (const [name, value] of Object.entries(methods)) {
    Object.defineProperty(HTMLElement.prototype, name, { value, configurable: true });
  }
}

function createElement(parent, tag, options = {}) {
  if (typeof options === 'string') options = { cls: options };
  const node = parent.ownerDocument.createElement(tag);
  if (options.cls)
    node.className = Array.isArray(options.cls) ? options.cls.join(' ') : options.cls;
  if (options.text !== undefined) node.textContent = options.text;
  if (options.type) node.setAttribute('type', options.type);
  if (options.value !== undefined) node.value = options.value;
  for (const [name, value] of Object.entries(options.attr ?? {}))
    node.setAttribute(name, String(value));
  if (options.title) node.title = options.title;
  parent.appendChild(node);
  return node;
}

export class Events {
  listeners = new Map();
  on(name, callback, context) {
    const entry = { events: this, name, callback, context };
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(entry);
    return entry;
  }
  offref(entry) {
    this.listeners.get(entry.name)?.delete(entry);
  }
  off(name, callback) {
    for (const entry of this.listeners.get(name) ?? [])
      if (entry.callback === callback) this.offref(entry);
  }
  trigger(name, ...args) {
    for (const entry of this.listeners.get(name) ?? []) entry.callback.apply(entry.context, args);
  }
}

export class Component {
  cleanups = [];
  children = new Set();
  loaded = false;
  load() {
    if (!this.loaded) {
      this.loaded = true;
      this.onload?.();
      for (const child of this.children) child.load();
    }
  }
  unload() {
    for (const child of this.children) child.unload();
    this.children.clear();
    for (const cleanup of this.cleanups.splice(0).reverse()) cleanup();
    if (this.loaded) this.onunload?.();
    this.loaded = false;
  }
  register(cleanup) {
    this.cleanups.push(cleanup);
  }
  registerEvent(entry) {
    this.register(() => entry.events.offref(entry));
  }
  registerDomEvent(element, type, callback, options) {
    element.addEventListener(type, callback, options);
    this.register(() => element.removeEventListener(type, callback, options));
  }
  registerInterval(id) {
    this.register(() => clearInterval(id));
    return id;
  }
  addChild(child) {
    this.children.add(child);
    if (this.loaded) child.load();
    return child;
  }
  removeChild(child) {
    if (this.children.delete(child)) child.unload();
    return child;
  }
}

export class TFile {
  constructor(path = '') {
    this.path = path;
    this.name = path.split('/').pop();
    this.basename = this.name.replace(/\.md$/u, '');
    this.extension = 'md';
    this.stat = { ctime: 0, mtime: 0, size: 0 };
  }
}
export class TFolder {
  constructor(path = '') {
    this.path = path;
    this.name = path.split('/').pop();
    this.children = [];
  }
  isRoot() {
    return this.path === '';
  }
}
export class WorkspaceLeaf {
  constructor(app) {
    this.app = app;
  }
}
export class ItemView extends Component {
  constructor(leaf) {
    super();
    this.app = leaf.app;
    this.leaf = leaf;
    this.containerEl = document.getElementById('preview-leaf');
    this.containerEl.replaceChildren();
    createElement(this.containerEl, 'div', { cls: 'view-header' });
    this.contentEl = createElement(this.containerEl, 'div', { cls: 'view-content' });
  }
}

function focusable(container) {
  return Array.from(
    container.querySelectorAll('button,input,select,textarea,a[href],[tabindex]'),
  ).filter(
    (node) =>
      !node.disabled &&
      node.tabIndex >= 0 &&
      !node.closest('[hidden]') &&
      node.getClientRects().length,
  );
}

export class Modal {
  constructor(app) {
    this.app = app;
    const parsed = new DOMParser().parseFromString(reference.modal, 'text/html');
    this.containerEl = document.importNode(parsed.body.firstElementChild, true);
    this.modalEl = this.containerEl.querySelector('.modal');
    this.titleEl = this.containerEl.querySelector('.modal-title');
    this.contentEl = this.containerEl.querySelector('.modal-content');
    if (!this.modalEl || !this.titleEl || !this.contentEl)
      throw Error('공식 모달 구조와 검수 호스트가 다릅니다.');
    this.modalEl.setAttribute('role', 'dialog');
    this.modalEl.setAttribute('aria-modal', 'true');
    this.titleEl.id = `preview-modal-${crypto.randomUUID()}`;
    this.modalEl.setAttribute('aria-labelledby', this.titleEl.id);
    this.abort = new AbortController();
  }
  setTitle(text) {
    this.titleEl.textContent = text;
    return this;
  }
  setContent(content) {
    this.contentEl.replaceChildren(
      typeof content === 'string' ? document.createTextNode(content) : content,
    );
    return this;
  }
  setCloseCallback(callback) {
    this.closeCallback = callback;
    return this;
  }
  open() {
    if (this.containerEl.isConnected) return;
    this.previousFocus = document.activeElement;
    document.body.appendChild(this.containerEl);
    const signal = this.abort.signal;
    this.containerEl
      .querySelector('.modal-close-button')
      ?.addEventListener('click', () => this.close(), { signal });
    this.containerEl
      .querySelector('.modal-bg')
      ?.addEventListener('click', () => this.close(), { signal });
    document.addEventListener(
      'keydown',
      (event) => {
        if (document.querySelector('.modal-container:last-of-type') !== this.containerEl) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopImmediatePropagation();
          this.close();
        }
        if (event.key === 'Tab') {
          const nodes = focusable(this.modalEl);
          const next = nodes[0];
          const last = nodes.at(-1);
          if (
            event.shiftKey &&
            (document.activeElement === next || !this.modalEl.contains(document.activeElement))
          ) {
            event.preventDefault();
            last?.focus();
          } else if (
            !event.shiftKey &&
            (document.activeElement === last || !this.modalEl.contains(document.activeElement))
          ) {
            event.preventDefault();
            next?.focus();
          }
        }
      },
      { capture: true, signal },
    );
    const opened = this.onOpen?.();
    Promise.resolve(opened)
      .then(() => {
        if (!this.modalEl.contains(document.activeElement)) focusable(this.modalEl)[0]?.focus();
      })
      .catch(reportFailure);
  }
  close() {
    if (!this.containerEl.isConnected) return;
    this.abort.abort();
    this.containerEl.remove();
    if (this.previousFocus?.isConnected) this.previousFocus.focus({ preventScroll: true });
    this.onClose?.();
    this.closeCallback?.();
  }
}

export class Notice {
  constructor(message, duration = 5000) {
    this.containerEl = createElement(document.querySelector('.notice-container'), 'div', {
      cls: 'notice',
      attr: { role: 'status' },
    });
    this.messageEl = createElement(this.containerEl, 'div', { cls: 'notice-message' });
    this.setMessage(message);
    if (duration > 0) this.timer = setTimeout(() => this.hide(), duration);
  }
  setMessage(message) {
    this.messageEl.replaceChildren(
      typeof message === 'string' ? document.createTextNode(message) : message,
    );
    return this;
  }
  hide() {
    clearTimeout(this.timer);
    this.containerEl.remove();
  }
}

export function setIcon(element, name) {
  const svg = reference.icons[name] ?? reference.icons[`lucide-${name}`];
  if (!svg) throw Error(`공식 아이콘이 없습니다: ${name}`);
  const node = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
  element.replaceChildren(document.importNode(node, true));
}
export function getIcon(name) {
  const element = document.createElement('span');
  setIcon(element, name);
  return element.firstElementChild;
}
export function setTooltip(element, text) {
  element.setAttribute('aria-label', text);
  element.setAttribute('title', text);
}

export class Menu {
  items = [];
  addItem(callback) {
    const item = {
      setTitle(text) {
        this.text = text;
        return this;
      },
      setIcon(icon) {
        this.icon = icon;
        return this;
      },
      setDisabled(value) {
        this.disabled = value;
        return this;
      },
      setChecked(value) {
        this.checked = value;
        return this;
      },
      onClick(action) {
        this.action = action;
        return this;
      },
    };
    callback(item);
    this.items.push(item);
    return this;
  }
  addSeparator() {
    this.items.push(null);
    return this;
  }
  setUseNativeMenu() {
    return this;
  }
  showAtMouseEvent(event) {
    this.showAtPosition({ x: event.clientX, y: event.clientY });
  }
  showAtPosition(position) {
    this.previousFocus = document.activeElement;
    this.element = createElement(document.body, 'div', { cls: 'menu', attr: { role: 'menu' } });
    this.element.setCssProps({ left: `${position.x}px`, top: `${position.y}px` });
    for (const item of this.items) {
      if (!item) {
        createElement(this.element, 'div', { cls: 'menu-separator', attr: { role: 'separator' } });
        continue;
      }
      const node = createElement(this.element, 'div', {
        cls: `menu-item${item.disabled ? ' is-disabled' : ''}`,
        attr: {
          role: 'menuitem',
          tabindex: item.disabled ? '-1' : '0',
          'aria-disabled': String(!!item.disabled),
        },
      });
      if (item.icon) setIcon(createElement(node, 'div', { cls: 'menu-item-icon' }), item.icon);
      createElement(node, 'div', { cls: 'menu-item-title', text: item.text });
      const execute = () => {
        if (!item.disabled) {
          this.hide();
          Promise.resolve(item.action?.()).catch(reportFailure);
        }
      };
      node.addEventListener('click', execute);
      node.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          execute();
        }
      });
    }
    this.abort = new AbortController();
    document.addEventListener(
      'pointerdown',
      (event) => {
        if (!this.element.contains(event.target)) this.hide();
      },
      { signal: this.abort.signal },
    );
    this.element.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.hide();
        return;
      }
      const nodes = Array.from(this.element.querySelectorAll('[tabindex="0"]'));
      let index = nodes.indexOf(document.activeElement);
      if (event.key === 'ArrowDown') index++;
      else if (event.key === 'ArrowUp') index--;
      else if (event.key === 'Home') index = 0;
      else if (event.key === 'End') index = nodes.length - 1;
      else return;
      event.preventDefault();
      nodes[(index + nodes.length) % nodes.length]?.focus();
    });
    this.element.querySelector('[tabindex="0"]')?.focus();
  }
  hide() {
    this.abort?.abort();
    this.element?.remove();
    if (this.previousFocus?.isConnected) this.previousFocus.focus();
  }
}

export const MarkdownRenderer = {
  async render(_app, text, element) {
    const language = Object.keys(reference.markdown).find(
      (key) => reference.markdown[key] === text,
    );
    if (!language) {
      element.textContent = text;
      return;
    }
    const parsed = new DOMParser().parseFromString(reference.rendered[language], 'text/html');
    element.replaceChildren(
      ...Array.from(parsed.body.firstElementChild.childNodes, (node) =>
        document.importNode(node, true),
      ),
    );
  },
};

export function reportFailure(error) {
  const result = document.getElementById('preview-result');
  result.dataset.failed = 'true';
  result.textContent = String(error?.stack ?? error);
}
export function normalizePath(path) {
  return path.replace(/\\/gu, '/').replace(/\/{2,}/gu, '/');
}
export const Platform = { isDesktopApp: true, isMacOS: true, isMobile: false };
export class Keymap {
  static isModEvent(event) {
    return event.metaKey;
  }
}
export function debounce(callback, timeout = 0) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => callback(...args), timeout);
  };
}
export function requestUrl() {
  return Promise.reject(Error('검수 환경에서는 외부 네트워크 요청을 실행하지 않습니다.'));
}

class Unsupported {
  constructor() {
    throw Error(`검수 호스트에서 지원하지 않는 API: ${new.target.name}`);
  }
}
export class App extends Unsupported {}
export class Plugin extends Component {}
export class PluginSettingTab extends Unsupported {}
export class Setting extends Unsupported {}
export class SettingGroup extends Unsupported {}
export class ButtonComponent extends Unsupported {}
export class TextComponent extends Unsupported {}
export class DropdownComponent extends Unsupported {}
export class ExtraButtonComponent extends Unsupported {}
export class ToggleComponent extends Unsupported {}
export class SecretComponent extends Unsupported {}
export class FileView extends Unsupported {}
export class FuzzySuggestModal extends Unsupported {}
export class SuggestModal extends Unsupported {}
export function prepareFuzzySearch() {
  throw Error('검수 호스트에서 퍼지 검색은 지원하지 않습니다.');
}
export function sanitizeHTMLToDom() {
  throw Error('검수 호스트에서 HTML 변환은 지원하지 않습니다.');
}
export function parseYaml() {
  throw Error('검수 호스트에서 YAML 파싱은 지원하지 않습니다.');
}
export function getFrontMatterInfo() {
  throw Error('검수 호스트에서 frontmatter 파싱은 지원하지 않습니다.');
}
export function getAllTags() {
  return [];
}
export function addIcon() {
  throw Error('검수 호스트에서 아이콘 추가는 지원하지 않습니다.');
}
export function moment() {
  throw Error('검수 호스트에서 날짜 포맷은 지원하지 않습니다.');
}
