import type { App } from 'obsidian';
import { describe, expect, it } from 'vitest';
import { formatActivePluginsForPrompt } from './obsidian-compat';

describe('Obsidian 플러그인 인식 프롬프트', () => {
  it('활성 플러그인 manifest 정보와 Context7 사용 지시를 포함한다', () => {
    const app = {
      plugins: {
        plugins: {
          dataview: {
            manifest: {
              name: 'Dataview',
              version: '0.5.68',
              description: 'Advanced queries over markdown files.',
            },
          },
        },
      },
    } as unknown as App;

    const prompt = formatActivePluginsForPrompt(app);

    expect(prompt).toContain('Dataview (dataview) v0.5.68');
    expect(prompt).toContain('Advanced queries over markdown files.');
    expect(prompt).toContain('Context7 MCP 도구');
    expect(prompt).toContain('플러그인 전용 문법을 추측하지 마세요');
  });
});
