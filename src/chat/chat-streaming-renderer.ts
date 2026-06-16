export type StreamingRenderMode = 'plain-partial' | 'batched-markdown' | 'final-markdown';

export interface StreamingRenderInput {
  content: string;
  isFinal: boolean;
  now: number;
  lastMarkdownAt?: number;
  minIntervalMs?: number;
}

export interface StreamingRenderPlan {
  mode: StreamingRenderMode;
  renderMarkdown: boolean;
  showCursor: boolean;
  hasIncompleteFence: boolean;
  cursorClassName: string;
  preservesLayout: boolean;
}

const DEFAULT_MIN_INTERVAL_MS = 250;
export const STREAMING_CURSOR_CLASS = 'superpower-inside-chat-streaming-cursor';

export function createStreamingRenderPlan(input: StreamingRenderInput): StreamingRenderPlan {
  const hasIncompleteFence = hasUnclosedCodeFence(input.content);
  if (input.isFinal) {
    return {
      mode: 'final-markdown',
      renderMarkdown: true,
      showCursor: false,
      hasIncompleteFence,
      cursorClassName: STREAMING_CURSOR_CLASS,
      preservesLayout: true,
    };
  }

  const elapsed = input.now - (input.lastMarkdownAt ?? 0);
  const canBatchMarkdown =
    input.content.trim().length > 0 &&
    !hasIncompleteFence &&
    elapsed >= (input.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS);

  return {
    mode: canBatchMarkdown ? 'batched-markdown' : 'plain-partial',
    renderMarkdown: canBatchMarkdown,
    showCursor: true,
    hasIncompleteFence,
    cursorClassName: STREAMING_CURSOR_CLASS,
    preservesLayout: true,
  };
}

function hasUnclosedCodeFence(content: string): boolean {
  const matches = content.match(/(^|\n)```/g);
  return matches !== null && matches.length % 2 === 1;
}
