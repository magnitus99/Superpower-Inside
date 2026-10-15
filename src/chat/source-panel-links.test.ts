import { afterEach, describe, expect, it, vi } from 'vitest';
import { SourcePanel } from './source-panel';
import type { SourceCitation } from './types';

afterEach(() => vi.unstubAllGlobals());

describe('백틱 출처 링크', () => {
  it.each(['rag-1', 'Notes/합성 자료.md', 'Notes/합성 자료.md#결론'])(
    '%s 출처를 키보드로 접근 가능한 문서 링크로 바꾼다',
    (text) => {
      const citation: SourceCitation = {
        id: 'rag-1',
        filePath: 'Notes/합성 자료.md',
        heading: '결론',
        status: 'verified',
        preview: '합성 근거',
      };
      const openCitation = vi.fn();
      const listeners = new Map<string, EventListener>();
      const attributes = new Map<string, string>();
      const marker = {
        addClass: vi.fn(),
        setAttribute: (key: string, value: string) => attributes.set(key, value),
        setText: vi.fn(),
        addEventListener: (key: string, listener: EventListener) => listeners.set(key, listener),
      };
      const code = {
        textContent: text,
        closest: vi.fn().mockReturnValue(null),
        replaceWith: vi.fn(),
      };
      class Bubble {
        querySelectorAll = vi.fn().mockReturnValue([code]);
      }
      vi.stubGlobal('HTMLElement', Bubble);
      vi.stubGlobal('NodeFilter', { SHOW_TEXT: 4 });
      const container = {
        querySelector: () => new Bubble(),
        ownerDocument: {
          createElement: () => marker,
          createTreeWalker: () => ({ nextNode: () => null }),
        },
      } as unknown as HTMLElement;
      const panel = new SourcePanel({
        setIcon: vi.fn(),
        openCitation,
        copyCitationLink: vi.fn(),
        insertCitation: vi.fn(),
      });

      panel.linkAnswerCitationMarkers(container, [citation]);

      expect(code.replaceWith).toHaveBeenCalledWith(marker);
      expect(attributes.get('href')).toBe('Notes/합성 자료.md#결론');
      expect(attributes.get('data-href')).toBe('Notes/합성 자료.md#결론');
      const preventDefault = vi.fn();
      const event = { preventDefault } as unknown as MouseEvent;
      listeners.get('click')?.(event);
      expect(preventDefault).toHaveBeenCalled();
      expect(openCitation).toHaveBeenCalledWith(citation);
    },
  );
});
