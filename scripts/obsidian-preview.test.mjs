import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { assetPaths, parseCliJson, resolvePreviewFile } from './obsidian-preview.mjs';
import { Component, Events, installHost } from './obsidian-preview/host.mjs';

describe('Obsidian 브라우저 검수 환경', () => {
  it('DOM 생성 callback을 설정·부착된 실제 노드로 한 번 실행한다', () => {
    let document;
    class Element {
      constructor(tag) { this.tag = tag; this.ownerDocument = document; this.children = []; }
      appendChild(node) { this.children.push(node); node.parentElement = this; }
      setAttribute(name, value) { this[name] = value; }
    }
    document = { createElement: tag => new Element(tag) };
    vi.stubGlobal('window', {});
    vi.stubGlobal('document', document);
    vi.stubGlobal('HTMLElement', Element);
    try {
      installHost({});
      const parent = new Element('main');
      for (const method of ['createEl', 'createDiv', 'createSpan']) {
        const callback = vi.fn(node => {
          expect(parent.children.includes(node)).toBe(true);
          expect(node.textContent).toBe('configured');
          expect(node.className).toBe('fixture');
          node.disabled = true;
        });
        const options = { cls: 'fixture', text: 'configured' };
        const node = method === 'createEl' ? parent.createEl('button', options, callback) : parent[method](options, callback);
        expect(callback.mock.calls).toHaveLength(1);
        expect(callback.mock.calls[0][0] === node).toBe(true);
        expect(node.disabled).toBe(true);
      }
    } finally { vi.unstubAllGlobals(); }
  });

  it('기본 CSS의 로컬 자산만 수집하고 외부 주소를 허용하지 않는다', () => {
    expect(assetPaths('a{src:url("public/fonts/a.woff2")}b{src:url(data:x)}')).toEqual([
      'public/fonts/a.woff2',
    ]);
    for (const url of ['https://example.test/a', '../private', '/private', 'public/../private']) {
      expect(() => assetPaths(`a{src:url("${url}")}`)).toThrow();
    }
  });

  it('CLI 실패와 잘못된 응답은 자산 준비 성공으로 처리하지 않는다', () => {
    expect(parseCliJson('=> {"version":"1.0.0"}\n')).toEqual({ version: '1.0.0' });
    expect(() => parseCliJson('Error: unavailable')).toThrow();
  });

  it('서버는 검수 파일과 캡처한 자산 외의 경로를 노출하지 않는다', () => {
    expect(resolvePreviewFile('/bundle.js', '/cache', '/repo')).toBe(resolve('/cache/bundle.js'));
    expect(resolvePreviewFile('/styles.css', '/cache', '/repo')).toBe(resolve('/repo/styles.css'));
    expect(resolvePreviewFile('/public/fonts/a.woff2', '/cache', '/repo')).toBe(
      resolve('/cache/public/fonts/a.woff2'),
    );
    for (const path of [
      '/data.json',
      '/../../etc/passwd',
      '/public/../private',
      '/public/%2e%2e/x',
    ]) {
      expect(resolvePreviewFile(path, '/cache', '/repo')).toBeNull();
    }
  });

  it('컴포넌트 해제는 등록 이벤트·DOM 이벤트·자식 정리를 한 번만 실행한다', () => {
    const events = new Events();
    const component = new Component();
    const child = new Component();
    const target = new EventTarget();
    let calls = 0;
    let cleanups = 0;
    component.addChild(child);
    child.register(() => cleanups++);
    component.registerEvent(events.on('change', () => calls++));
    component.registerDomEvent(target, 'change', () => calls++);
    events.trigger('change');
    target.dispatchEvent(new Event('change'));
    expect(calls).toBe(2);
    component.unload();
    component.unload();
    events.trigger('change');
    target.dispatchEvent(new Event('change'));
    expect(calls).toBe(2);
    expect(cleanups).toBe(1);
  });
});
