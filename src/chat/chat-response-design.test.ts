import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const chatRoot = __dirname;
const viewSource = readFileSync(resolve(chatRoot, 'view.ts'), 'utf8');
const toolPanelSource = readFileSync(resolve(chatRoot, 'tool-call-panel.ts'), 'utf8');
const sourcePanelSource = readFileSync(resolve(chatRoot, 'source-panel.ts'), 'utf8');
const styles = readFileSync(resolve(chatRoot, '../../styles.css'), 'utf8');

describe('assistant 단일 캔버스 디자인 계약', () => {
  it('답변, 작업 기록, 출처를 접근 가능한 단일 응답 레이아웃으로 조립한다', () => {
    expect(viewSource.includes("from './assistant-response-layout'")).toBe(true);
    expect(viewSource.includes('createAssistantResponseLayout(')).toBe(true);
    expect(styles.includes('.superpower-inside-chat-assistant-response-tabs')).toBe(true);
    expect(styles.includes('.superpower-inside-chat-assistant-response-tab[aria-selected=')).toBe(
      true,
    );
    expect(styles.includes('.superpower-inside-chat-assistant-response-panel')).toBe(true);
  });

  it('도구 호출과 세부 정보는 같은 작업 그룹에 귀속된다', () => {
    expect(toolPanelSource.includes('superpower-inside-tool-call-group')).toBe(true);
    expect(toolPanelSource.includes('superpower-inside-tool-call-details')).toBe(true);
    expect(styles.includes('.superpower-inside-tool-call-group')).toBe(true);
    expect(styles.includes('.superpower-inside-tool-call-details')).toBe(true);
  });

  it('출처는 sources tab 안에서 중복 disclosure 없이 임베드할 수 있다', () => {
    expect(sourcePanelSource.includes("mode?: 'disclosure' | 'embedded'")).toBe(true);
    expect(sourcePanelSource.includes("mode === 'embedded'")).toBe(true);
    expect(viewSource.includes("mode: 'embedded'")).toBe(true);
  });

  it('메시지 행동은 근거 요약과 핵심 행동, 더 보기로 위계를 나눈다', () => {
    expect(viewSource.includes('superpower-inside-chat-message-evidence')).toBe(true);
    expect(viewSource.includes('superpower-inside-chat-message-action-buttons')).toBe(true);
    expect(viewSource.includes('assistantResponseMoreActions')).toBe(true);
    expect(styles.includes('.superpower-inside-chat-message-evidence')).toBe(true);
  });

  it('emoji 대신 Obsidian 아이콘을 사용하고 좁은 sidebar reflow를 제공한다', () => {
    expect(viewSource.includes("return '🤖'")).toBe(false);
    expect(viewSource.includes("return '👤'")).toBe(false);
    expect(viewSource.includes("setIcon(avatar, 'sparkles')")).toBe(true);
    expect(styles.includes('@container (max-width: 420px)')).toBe(true);
    expect(styles.includes('.superpower-inside-chat-assistant-response-tabs')).toBe(true);
  });

  it('전체 응답 disclosure도 semantic button과 aria 상태로 제어한다', () => {
    expect(viewSource.includes('superpower-inside-chat-response-collapse')).toBe(true);
    expect(viewSource.includes("'aria-expanded'")).toBe(true);
    expect(viewSource.includes("'aria-controls'")).toBe(true);
  });

  it('세션 전환 뒤 분리된 빈 상태 DOM 참조가 새 안내 화면을 막지 않는다', () => {
    expect(viewSource.includes('if (this.emptyStateEl && !this.emptyStateEl.isConnected)')).toBe(
      true,
    );
  });

  it('답변 본문은 주변 채팅 UI와 같은 작은 본문 크기 토큰을 사용한다', () => {
    expect(styles).toMatch(
      /\.superpower-inside-chat-assistant-response\s+\.superpower-inside-chat-bubble\.assistant\s*\{[^}]*font-size:\s*var\(--font-ui-small\)[^}]*line-height:\s*1\.6/s,
    );
  });
});
