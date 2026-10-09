import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');
const styles = source('../../styles.css');
const session = source('./session-modal.ts');
const prompt = source('./prompt-library-modal.ts');

describe('최종 디자인 개편의 접근성과 경계', () => {
  it('응답 탭과 작업 기록은 선택선만 유지하고 출처 간 경계는 남긴다', () => {
    for (const selector of [
      '.superpower-inside-chat-assistant-response-tabs',
      '.superpower-inside-tool-call-group',
      '.superpower-inside-chat-message-wrapper.assistant .superpower-inside-chat-message-actions',
    ]) {
      const start = styles.lastIndexOf(`${selector} {`);
      const rule = styles.slice(start, styles.indexOf('}', start));
      expect(start).toBeGreaterThanOrEqual(0);
      expect(rule).not.toMatch(/border-(?:top|bottom):\s*1px/);
    }
    expect(styles).toContain('border-bottom: 2px solid transparent;');
    expect(styles).toMatch(
      /\.superpower-inside-chat-citations\.embedded \.superpower-inside-chat-citation-card\s*\{[^}]*border-bottom:\s*1px/s,
    );
  });

  it('기록 모달은 이름 있는 대화상자와 독립된 선택 버튼을 제공한다', () => {
    expect(session).toContain("role: 'dialog'");
    expect(session).toContain("'aria-modal': 'true'");
    expect(session).toContain("cls: 'superpower-inside-session-open'");
    expect(session).not.toContain("itemEl.addEventListener('click'");
    expect(session).toContain('getPromptModalTabTarget(');
    expect(session).toContain('previousFocus?.isConnected');
    expect(session).toContain('unsubscribeSessions();');
    expect(session).not.toContain("addEventListener('remove'");
    expect(session).not.toContain('ensureSessionModalStyles');
  });

  it('기록 로드 실패는 해당 위치에서 재시도하고 삭제 후 포커스를 복원한다', () => {
    expect(session).toContain("text: t('retryLabel')");
    expect(session).toContain('focusPath');
    expect(session).toContain('searchInput.focus()');
  });

  it('프롬프트 초안과 기본 항목의 비활성 이유는 화면과 제어에 연결된다', () => {
    expect(prompt).toContain("t('promptProtectedReason')");
    expect(prompt).toContain("t('promptSaveBeforeApply')");
    expect(prompt).toContain("deleteBtn.setAttribute('aria-describedby'");
    expect(prompt).toContain('applyBtn.disabled = Boolean(draft)');
    expect(prompt).toContain('updateActionAvailability();');
  });
});
