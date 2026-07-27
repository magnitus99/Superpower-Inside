import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const styles = readFileSync(resolve(__dirname, '../../styles.css'), 'utf8');

describe('chat motion and accessibility CSS contract', () => {
  it('motion token과 reduced-motion path를 제공한다', () => {
    expect(styles).toContain('--superpower-inside-motion-fast');
    expect(styles).toContain('--superpower-inside-motion-normal');
    expect(styles).toContain('--superpower-inside-motion-slow');
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(styles).toContain('.superpower-inside-chat-streaming-cursor::after');
    expect(styles).toContain('.superpower-inside-chat-message-wrapper.assistant.generating::before');
  });

  it('좁은 sidebar와 keyboard focus selector를 고정한다', () => {
    expect(styles).toContain('container-type: inline-size');
    expect(styles).toContain('@container (max-width: 420px)');
    expect(styles).toContain('.superpower-inside-chat-container button:focus-visible');
    expect(styles).toContain('.superpower-inside-chat-citation-marker:focus-visible');
  });

  it('phase 3/4 chat sections가 overflow-safe selector를 가진다', () => {
    for (const selector of [
      '.superpower-inside-chat-readiness',
      '.superpower-inside-chat-context-budget',
      '.superpower-inside-chat-data-boundary',
      '.superpower-inside-chat-variant-compare',
      '.superpower-inside-chat-citation-marker',
    ]) {
      expect(styles).toContain(selector);
    }
  });
});
