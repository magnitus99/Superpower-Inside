import { describe, expect, it } from 'vitest';
import { createStreamingRenderPlan } from './chat-streaming-renderer';

describe('Streaming renderer contract', () => {
  it('미완성 code fence는 streaming 중 markdown rerender를 미루고 inline cursor를 유지한다', () => {
    expect(
      createStreamingRenderPlan({
        content: '```ts\nconst value = 1;',
        isFinal: false,
        now: 1_000,
        lastMarkdownAt: 0,
      }),
    ).toMatchObject({
      mode: 'plain-partial',
      renderMarkdown: false,
      showCursor: true,
      hasIncompleteFence: true,
      preservesLayout: true,
    });
  });

  it('완성된 markdown은 batch 지연 예산이 지나면 중간 markdown render를 허용한다', () => {
    expect(
      createStreamingRenderPlan({
        content: '## 제목\n\n| A | B |\n| --- | --- |\n| 1 | 2 |',
        isFinal: false,
        now: 1_000,
        lastMarkdownAt: 500,
        minIntervalMs: 250,
      }),
    ).toMatchObject({
      mode: 'batched-markdown',
      renderMarkdown: true,
      showCursor: true,
      hasIncompleteFence: false,
    });
  });

  it('final render는 cursor를 제거하고 확정 markdown enhancement를 허용한다', () => {
    expect(
      createStreamingRenderPlan({
        content: '최종 답변',
        isFinal: true,
        now: 1_000,
        lastMarkdownAt: 900,
      }),
    ).toMatchObject({
      mode: 'final-markdown',
      renderMarkdown: true,
      showCursor: false,
    });
  });
});
