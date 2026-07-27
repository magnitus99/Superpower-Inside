import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('작업 버튼 피드백 적용 범위', () => {
  it('RAG 인덱싱 버튼의 no-op 경로는 침묵하지 않는다', () => {
    const source = readFileSync(new URL('./settings.ts', import.meta.url), 'utf8');

    expect(source).toContain("t('ragNoPendingUpdatesNotice')");
    expect(source).toContain("t('ragNoDocumentsNotice')");
  });

  it('세션 이름 변경과 삭제는 성공/실패 Notice를 남긴다', () => {
    const source = readFileSync(new URL('./chat/session-modal.ts', import.meta.url), 'utf8');

    expect(source).toContain("t('chatSessionRenamedNotice')");
    expect(source).toContain("t('chatSessionRenameFailedNotice'");
    expect(source).toContain("t('chatSessionDeletedNotice')");
    expect(source).toContain("t('chatSessionDeleteFailedNotice'");
  });
});
