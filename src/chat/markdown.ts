import { MarkdownRenderer, Component } from 'obsidian';
import { t } from '../i18n';

/**
 * Markdown 콘텐츠를 지정한 HTMLElement에 렌더링합니다.
 * Obsidian의 MarkdownRenderer.renderMarkdown 래퍼입니다.
 */
export async function renderMarkdownToElement(
  el: HTMLElement,
  content: string,
  sourcePath: string,
  component: Component,
): Promise<void> {
  el.empty();
  await MarkdownRenderer.renderMarkdown(content, el, sourcePath, component);
}

/**
 * 렌더링된 마크다운 컨테이너 내의 코드 블록을 감싸고 복사 버튼을 추가합니다.
 * 각 <pre><code> 쌍을 .superpower-inside-code-block-wrapper 로 감싸고,
 * 우측 상단에 복사 버튼을 배치합니다.
 */
export function enhanceCodeBlocks(container: HTMLElement): void {
  const codeBlocks = container.querySelectorAll('pre > code');
  for (const codeEl of Array.from(codeBlocks)) {
    const preEl = codeEl.parentElement;
    if (!preEl || preEl.parentElement?.classList.contains('superpower-inside-code-block-wrapper')) {
      continue;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'superpower-inside-code-block-wrapper';
    preEl.parentNode?.insertBefore(wrapper, preEl);
    wrapper.appendChild(preEl);

    const copyBtn = wrapper.createEl('button', {
      cls: 'superpower-inside-code-copy-btn',
      text: t('copyCode'),
    });
    copyBtn.addEventListener('click', () => {
      const code = codeEl.textContent ?? '';
      void navigator.clipboard.writeText(code).then(() => {
        copyBtn.setText(t('copied'));
        setTimeout(() => copyBtn.setText(t('copyCode')), 1500);
      });
    });
    wrapper.appendChild(copyBtn);
  }
}

/**
 * 문자열 내의 HTML 특수문자를 이스케이프합니다.
 * 스트리밍 중 평문 표시용으로 사용됩니다.
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
