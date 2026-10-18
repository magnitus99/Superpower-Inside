import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguage } from '../i18n';
import { hasAnswerDiagnostics, renderAnswerDiagnostics } from './answer-diagnostics';
import type { ChatMessageWithMeta } from './types';

vi.mock('obsidian', () => ({ setIcon: vi.fn() }));

interface ElementOptions {
  cls?: string;
  text?: string;
  attr?: Record<string, string>;
}

class TestElement {
  readonly children: TestElement[] = [];
  readonly attributes = new Map<string, string>();
  readonly listeners = new Map<string, () => void>();
  className = '';
  textContent = '';
  hidden = false;
  id = '';

  createEl(_tag: string, options: ElementOptions = {}): TestElement {
    const child = new TestElement();
    child.className = options.cls ?? '';
    child.textContent = options.text ?? '';
    for (const [name, value] of Object.entries(options.attr ?? {})) {
      child.setAttribute(name, value);
    }
    this.children.push(child);
    return child;
  }
  createDiv(options?: ElementOptions): TestElement {
    return this.createEl('div', options);
  }
  createSpan(options?: ElementOptions): TestElement {
    return this.createEl('span', options);
  }
  prepend(element: TestElement): void {
    const index = this.children.indexOf(element);
    if (index !== -1) this.children.splice(index, 1);
    this.children.unshift(element);
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    if (name === 'id') this.id = value;
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
  querySelector(selector: string): TestElement | null {
    for (const child of this.children) {
      if (child.className.split(' ').includes(selector.slice(1))) return child;
      const nested = child.querySelector(selector);
      if (nested) return nested;
    }
    return null;
  }
  addEventListener(name: string, callback: () => void): void {
    this.listeners.set(name, callback);
  }
  setText(value: string): void {
    this.textContent = value;
  }
  empty(): void {
    this.children.length = 0;
    this.textContent = '';
  }
}

function allText(element: TestElement): string {
  return [element.textContent, ...element.children.map(allText)].join(' ');
}

function message(overrides: Partial<ChatMessageWithMeta> = {}): ChatMessageWithMeta {
  return {
    id: 'diagnostic-1',
    role: 'assistant',
    content: '합성 답변',
    timestamp: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    status: 'complete',
    ...overrides,
  };
}

function render(container: TestElement, value: ChatMessageWithMeta): void {
  renderAnswerDiagnostics(container as unknown as HTMLElement, value);
}

describe('답변의 검색 및 사용량 표시', () => {
  beforeEach(() => {
    setLanguage('ko');
    vi.stubGlobal('HTMLElement', TestElement);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('사용자 메시지는 진단을 표시하지 않고 과거 답변의 미기록을 0으로 꾸미지 않는다', () => {
    expect(hasAnswerDiagnostics(message({ role: 'user' }))).toBe(false);
    expect(hasAnswerDiagnostics(message())).toBe(true);
    const container = new TestElement();
    render(container, message());
    expect(allText(container)).toContain('검색 기록이 없습니다');
    expect(allText(container)).toContain('사용량을 제공하지 않았습니다');
    expect(allText(container)).not.toContain('입력 0');
  });

  it('새 응답에서 실행하지 않은 검색과 과거의 미기록을 구분한다', () => {
    const container = new TestElement();
    render(container, message({ retrievalTrace: [] }));
    expect(allText(container)).toContain('BM25·임베딩 검색을 실행하지 않았습니다');
    expect(allText(container)).not.toContain('검색 기록이 없습니다');
  });

  it('원문을 확인한 출처와 실제 답변이 인용한 출처를 따로 표시한다', () => {
    const container = new TestElement();
    render(
      container,
      message({
        content: '합성 주장 [source-used]',
        citations: [
          { id: 'source-used', filePath: 'Used.md', preview: '', status: 'verified' },
          { id: 'source-unused', filePath: 'Unused.md', preview: '', status: 'verified' },
        ],
      }),
    );
    const answer = container.querySelector('.superpower-inside-answer-diagnostics-cited');
    expect(answer).not.toBeNull();
    if (!answer) throw new Error('답변 인용 영역이 필요합니다.');
    expect(allText(answer)).toContain('Used.md');
    expect(allText(answer)).not.toContain('Unused.md');
  });

  it('집계된 토큰과 포함 범위, 임베딩 미계측을 분리한다', () => {
    const container = new TestElement();
    render(
      container,
      message({
        usageSnapshot: {
          requests: 3,
          reportedRequests: 2,
          inputTokens: 1200,
          outputTokens: 80,
          totalTokens: 1280,
          cacheReadTokens: 300,
          reasoningTokens: 20,
        },
      }),
    );
    const text = allText(container);
    expect(text).toContain('입력 1,200');
    expect(text).toContain('출력 80');
    expect(text).toContain('합계 1,280');
    expect(text).toContain('3회 중 2회');
    expect(text).toContain('일부 요청');
    expect(
      allText(
        container.querySelector('.superpower-inside-answer-diagnostics-summary') ?? container,
      ),
    ).toContain('일부 요청');
    expect(text).toContain('입력에 포함');
    expect(text).toContain('출력에 포함');
    expect(text).toContain('임베딩 토큰 사용량은 집계하지 않습니다');
  });

  it('실제 검색 질의와 실패, 원래 점수를 확률이나 원문 검증으로 바꾸지 않는다', () => {
    const container = new TestElement();
    render(
      container,
      message({
        retrievalTrace: [
          {
            query: '색인 방식 비교',
            diagnostics: [
              {
                providerId: 'keyword',
                source: 'bm25',
                status: 'ok',
                durationMs: 8,
                candidateCount: 4,
                readiness: 'ready',
                estimatedCost: 'free',
              },
              {
                providerId: 'semantic',
                source: 'vector',
                status: 'timeout',
                durationMs: 100,
                candidateCount: 0,
                readiness: 'degraded',
                estimatedCost: 'free',
              },
            ],
            results: [{ filePath: 'Synthetic/Notes.md', bm25Score: 12.25, vectorScore: 0.72 }],
          },
        ],
        citations: [
          {
            id: 'source-1',
            filePath: 'Synthetic/Notes.md',
            preview: '합성 자료',
            status: 'candidate',
          },
        ],
      }),
    );
    const text = allText(container);
    expect(text).toContain('색인 방식 비교');
    expect(text).toContain('후보 4개');
    expect(text).toContain('시간 초과');
    expect(text).toContain('BM25 12.25');
    expect(text).toContain('벡터 0.72');
    expect(text).toContain('검색 후보');
    expect(text).toContain('정확도 확률이 아닙니다');
    expect(text).not.toContain('72%');
  });

  it('검색 실패와 건너뜀은 번역된 안내를 쓰고 내부 오류 문자열을 노출하지 않는다', () => {
    const container = new TestElement();
    render(
      container,
      message({
        retrievalTrace: [
          {
            query: '합성 질문',
            status: 'error',
            diagnostics: [
              {
                providerId: 'embed',
                source: 'embedding',
                status: 'skipped',
                skippedReason: 'internal-missing-index',
                durationMs: 0,
                candidateCount: 0,
                readiness: 'cold',
                estimatedCost: 'free',
              },
            ],
            results: [],
          },
        ],
      }),
    );
    expect(allText(container)).toContain('검색을 완료하지 못했습니다');
    expect(allText(container)).toContain('이 검색 단계는 실행하지 않았습니다');
    expect(allText(container)).not.toContain('internal-missing-index');
  });

  it('진행 중 상태와 사용자가 펼친 상태 및 동일 버튼을 갱신 후에도 보존한다', () => {
    const container = new TestElement();
    render(container, message({ status: 'streaming' }));
    const button = container.querySelector('.superpower-inside-answer-diagnostics-toggle');
    expect(allText(container)).toContain('수집 중');
    expect(button?.getAttribute('aria-expanded')).toBe('false');
    button?.listeners.get('click')?.();
    render(
      container,
      message({ usageSnapshot: { requests: 1, reportedRequests: 1, totalTokens: 0 } }),
    );
    expect(container.querySelector('.superpower-inside-answer-diagnostics-toggle')).toBe(button);
    expect(button?.getAttribute('aria-expanded')).toBe('true');
    expect(allText(container)).toContain('합계 0');
    expect(allText(container)).not.toContain('수집 중');
  });

  it('질문 임베딩 단계의 0을 검색 후보 0개로 표시하지 않는다', () => {
    const container = new TestElement();
    render(
      container,
      message({
        retrievalTrace: [
          {
            query: '합성 질문',
            diagnostics: [
              {
                providerId: 'embed',
                source: 'embedding',
                status: 'ok',
                durationMs: 2,
                candidateCount: 0,
                readiness: 'ready',
                estimatedCost: 'free',
              },
            ],
            results: [],
          },
        ],
      }),
    );
    expect(allText(container)).toContain('질문 임베딩');
    expect(allText(container)).not.toContain('후보 0개');
  });

  it('새 검색 기록이 없는 과거 출처도 저장된 검색 점수와 채택 경로를 표시한다', () => {
    const container = new TestElement();
    render(
      container,
      message({
        citations: [
          {
            id: 'old-1',
            filePath: 'Synthetic/History.md',
            status: 'verified',
            bm25Score: 1.25,
            vectorScore: 0.8,
            selectionReason: 'keyword-vector',
            preview: '합성 원문',
          },
        ],
      }),
    );
    expect(allText(container)).toContain('BM25 1.25');
    expect(allText(container)).toContain('벡터 0.8');
    expect(allText(container)).toContain('원문 확인');
  });
});
