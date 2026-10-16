import { describe, expect, it } from 'vitest';
import { assetPaths, parseCliJson, resolvePreviewFile } from './obsidian-preview.mjs';
import { Component, Events } from './obsidian-preview/host.mjs';

describe('Obsidian 브라우저 검수 환경', () => {
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
    expect(resolvePreviewFile('/bundle.js', '/cache', '/repo')).toBe('/cache/bundle.js');
    expect(resolvePreviewFile('/styles.css', '/cache', '/repo')).toBe('/repo/styles.css');
    expect(resolvePreviewFile('/public/fonts/a.woff2', '/cache', '/repo')).toBe(
      '/cache/public/fonts/a.woff2',
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
