import { createRequire } from 'node:module';
import { vi } from 'vitest';

vi.mock('obsidian', () => {
  // 테스트에서는 설치된 YAML 파서로 Obsidian의 호스트 API를 대체합니다.
  const yaml = createRequire(import.meta.url)('js-yaml') as { load: (source: string) => unknown };
  return {
    getFrontMatterInfo: (content: string) => {
      const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)(?:\r?\n|$)/.exec(content);
      return { exists: match !== null, frontmatter: match?.[1] ?? '' };
    },
    parseYaml: yaml.load,
    // 경로 정규화는 순수 함수라 호스트 없이도 같은 결과를 냅니다.
    normalizePath: (path: string) => path.replace(/\\/gu, '/').replace(/\/{2,}/gu, '/'),
  };
});

type TestWindow = typeof globalThis &
  Pick<Window, 'clearInterval' | 'clearTimeout' | 'setInterval' | 'setTimeout'>;

const testGlobal = globalThis as typeof globalThis & { window?: TestWindow };

if (!testGlobal.window) {
  Object.defineProperty(testGlobal, 'window', {
    configurable: true,
    value: testGlobal,
  });
}
