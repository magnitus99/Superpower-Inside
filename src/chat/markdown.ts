import { MarkdownRenderer, Component } from 'obsidian';

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
 * 각 <pre><code> 쌍을 .super-obsidian-code-block-wrapper 로 감싸고,
 * 우측 상단에 복사 버튼을 배치합니다.
 */
export function enhanceCodeBlocks(container: HTMLElement): void {
  const codeBlocks = container.querySelectorAll('pre > code');
  for (const codeEl of Array.from(codeBlocks)) {
    const preEl = codeEl.parentElement;
    if (!preEl || preEl.parentElement?.classList.contains('super-obsidian-code-block-wrapper')) {
      continue;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'super-obsidian-code-block-wrapper';
    preEl.parentNode?.insertBefore(wrapper, preEl);
    wrapper.appendChild(preEl);

    const copyBtn = document.createElement('button');
    copyBtn.className = 'super-obsidian-code-copy-btn';
    copyBtn.textContent = '복사';
    copyBtn.addEventListener('click', () => {
      const text = codeEl.textContent ?? '';
      void navigator.clipboard.writeText(text).then(() => {
        const originalText = copyBtn.textContent;
        copyBtn.textContent = '복사됨';
        setTimeout(() => {
          if (originalText !== null) {
            copyBtn.textContent = originalText;
          }
        }, 1500);
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
    .replace(/"/g, '&quot;');
}
