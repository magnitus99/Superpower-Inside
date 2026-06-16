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
}

const fixtureRoot = resolve(__dirname, '../../tests/fixtures/chat-ux');

function readFixture<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(fixtureRoot, name), 'utf8')) as T;
}

describe('chat UX fixture gate', () => {
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
      expect.arrayContaining(['send-with-enter', 'mention-select-with-keyboard', 'tool-approve']),
    );
    expect(fixture.overflowSamples.length).toBeGreaterThanOrEqual(2);
    expect(fixture.requiredSelectors).toEqual(
      expect.arrayContaining([
        '.superpower-inside-chat-input',
        '.superpower-inside-chat-message-status',
        '.superpower-inside-chat-citation-card',
      ]),
    );
  });
});
