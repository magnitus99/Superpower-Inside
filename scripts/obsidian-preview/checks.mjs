import { SaveAnswerModal } from '../../src/chat/save-answer-modal';
import { t } from '../../src/i18n';

// 제품의 실제 저장 경로를 실행하되 합성 메모리 볼트만 변경합니다.
export async function checkProduct({ app, files, reference, lang, preview, toolbar }) {
  const checks = [];
  const assert = (condition, label) => {
    if (!condition) throw Error(`검수 실패: ${label}`);
    checks.push(label);
  };
  const waitFor = async (predicate) => {
    const deadline = Date.now() + 5000;
    while (!predicate()) {
      if (Date.now() > deadline) throw Error('제품 검수의 상태 전환 시간이 초과됐습니다.');
      await new Promise((done) => setTimeout(done, 25));
    }
  };
  const message = {
    role: 'assistant',
    content: reference.markdown[lang],
    citations: [
      {
        id: 'source-1',
        filePath: 'Examples/Topic.md',
        status: 'verified',
        preview: '합성 근거',
        line: 1,
      },
    ],
  };
  const trigger = toolbar.createEl('button', { text: '저장 계약' });
  trigger.focus();
  const previousFailure = preview.failSave;
  const originalPaths = new Set(files.keys());
  const modal = new SaveAnswerModal(app, message, 'Examples', 'Synthetic answer', trigger);
  try {
    preview.failSave = true;
    modal.open();
    const form = modal.contentEl.querySelector('form');
    const name = form.querySelector('input');
    const save = form.querySelector('button[type="submit"]');
    name.value = 'Synthetic answer';
    form.requestSubmit();
    assert(save.disabled, '저장 중 중복 실행 차단');
    await waitFor(() => !save.disabled);
    assert(name.value === 'Synthetic answer', '실패 후 입력 보존');
    assert(files.size === originalPaths.size, '실패한 저장은 파일 생성 없음');
    preview.failSave = false;
    form.requestSubmit();
    await waitFor(() => save.textContent === t('answerNoteSaved'));
    const saved = [...files.values()].find((entry) => !originalPaths.has(entry.file.path));
    assert(
      saved?.content.includes(message.content) && saved.content.includes('Examples/Topic.md'),
      '실제 직렬화의 답변·출처 보존',
    );
    const open = Array.from(form.querySelectorAll('button')).find(
      (button) => button.textContent === t('answerNoteOpen'),
    );
    assert(document.activeElement === open, '저장 성공 후 열기 행동에 포커스');
    open.click();
    await waitFor(() => !modal.containerEl.isConnected);
    assert(preview.openedPath === saved.file.path, '저장된 파일 열기 연결');
    assert(document.activeElement === trigger, '닫은 뒤 원래 제어로 복귀');
  } finally {
    modal.close();
    trigger.remove();
    preview.failSave = previousFailure;
    for (const path of files.keys()) if (!originalPaths.has(path)) files.delete(path);
  }
  return checks;
}
