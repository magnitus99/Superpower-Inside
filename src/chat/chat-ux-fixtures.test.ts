import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

interface ProviderStreamFixture {
  id: string;
  provider: string;
  transport: string;
  scenario: string;
  chunks: Array<Record<string, unknown>>;
  expected: Record<string, unknown>;
}

interface ChatTurnFixture {
  id: string;
  stage: string;
  providerCapability: string;
  messages: Array<Record<string, unknown>>;
  expectedDom: Record<string, unknown>;
}

interface VisualA11yFixture {
  viewports: Array<{ id: string; width: number; height: number }>;
  reducedMotion: boolean[];
  keyboardFlows: string[];
  overflowSamples: string[];
  requiredSelectors: string[];
  motionTokens: string[];
  reducedMotionSelectors: string[];
}

const fixtureRoot = resolve(__dirname, '../../tests/fixtures/chat-ux');

function readFixture<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(fixtureRoot, name), 'utf8')) as T;
}

describe('chat UX fixture gate', () => {
  it('빈 대화와 자동 문서 참조 안내는 실제 sidebar 구조와 반응형 CSS에 고정된다', () => {
    const viewSource = readFileSync(resolve(__dirname, 'view.ts'), 'utf8');
    const styles = readFileSync(resolve(__dirname, '../../styles.css'), 'utf8');

    expect(viewSource).toContain("cls: 'superpower-inside-chat-empty-state'");
    expect(viewSource).toContain("setIcon(icon, 'book-open-text')");
    expect(viewSource).toContain('this.plugin.prepareRagForChat()');
    expect(viewSource).toContain("setHidden(this.readinessEl, snapshot.status === 'ready')");
    expect(viewSource).toContain('severity-${item.severity}');
    expect(styles).toContain('.superpower-inside-chat-empty-state-prompts button');
    expect(styles).toContain('.superpower-inside-chat-readiness.superpower-inside-hidden');
    expect(styles).toContain('.superpower-inside-chat-run-control.superpower-inside-hidden');
    expect(styles).toContain('@container (max-width: 420px)');
  });

  it('provider stream fixture는 주요 provider transport를 네트워크 없이 덮는다', () => {
    const fixtures = readFixture<ProviderStreamFixture[]>('provider-streams.json');

    expect(fixtures.map((fixture) => fixture.id).sort()).toEqual([
      'claude-thinking-tool-use',
      'ollama-ndjson',
      'openai-sse',
      'openrouter-reasoning',
      'request-url-buffered',
    ]);
    expect(fixtures.every((fixture) => fixture.chunks.length > 0)).toBe(true);
    expect(fixtures.every((fixture) => Object.keys(fixture.expected).length > 0)).toBe(true);
  });

  it('chat turn fixture는 streaming/완료/error/tool/source/cancel 흐름을 덮는다', () => {
    const fixtures = readFixture<ChatTurnFixture[]>('chat-turns.json');

    expect(fixtures.map((fixture) => fixture.id).sort()).toEqual([
      'cancellation',
      'code-fence',
      'long-markdown',
      'missing-provider',
      'normal-answer',
      'rate-limit',
      'source-warnings',
      'tool-approval',
      'tool-failure',
    ]);
    expect(fixtures.every((fixture) => fixture.messages.length > 0)).toBe(true);
    expect(fixtures.every((fixture) => fixture.expectedDom['statusLabel'])).toBe(true);
  });

  it('visual/accessibility fixture는 sidebar viewport, reduced motion, keyboard, overflow를 고정한다', () => {
    const fixture = readFixture<VisualA11yFixture>('visual-accessibility.json');

    expect(fixture.viewports.map((viewport) => viewport.id)).toEqual([
      'narrow-sidebar',
      'medium-split-pane',
      'wide-pane',
    ]);
    expect(fixture.reducedMotion).toEqual([false, true]);
    expect(fixture.keyboardFlows).toEqual(
      expect.arrayContaining([
        'send-with-enter',
        'force-send-with-mod-enter',
        'cancel-with-escape',
        'cancel-with-stop-all',
        'scroll-to-latest-answer',
        'mention-select-with-keyboard',
        'tool-approve',
      ]),
    );
    expect(fixture.overflowSamples.length).toBeGreaterThanOrEqual(2);
    expect(fixture.requiredSelectors).toEqual(
      expect.arrayContaining([
        '.superpower-inside-chat-input',
        '.superpower-inside-chat-readiness',
        '.superpower-inside-chat-run-control',
        '.superpower-inside-chat-stop-all',
        '.superpower-inside-scroll-to-bottom',
        '.superpower-inside-chat-message-status',
        '.superpower-inside-chat-citation-card',
        '.superpower-inside-chat-context-budget',
        '.superpower-inside-chat-data-boundary',
      ]),
    );
    expect(fixture.motionTokens).toEqual(
      expect.arrayContaining([
        '--superpower-inside-motion-fast',
        '--superpower-inside-motion-normal',
        '--superpower-inside-motion-slow',
      ]),
    );
    expect(fixture.reducedMotionSelectors).toEqual(
      expect.arrayContaining([
        '.superpower-inside-typing-dot',
        '.superpower-inside-tool-running-dots span',
        '.superpower-inside-chat-streaming-cursor::after',
      ]),
    );
  });
});
