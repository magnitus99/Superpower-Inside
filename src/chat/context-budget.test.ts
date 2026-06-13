import { describe, expect, it } from 'vitest';

import { createContextBudget } from './context-budget';

describe('createContextBudget', () => {
  it('Rust append plan으로 block text와 remaining chars를 갱신한다', () => {
    const budget = createContextBudget(7);

    expect(budget.append({ text: 'abc' })).toBe(true);
    expect(budget.append({ text: 'de😀f' })).toBe(false);

    expect(budget.getBlocks().map((block) => block.text)).toEqual(['abc', 'de😀']);
    expect(budget.getRemainingChars()).toBe(0);
    expect(budget.append({ text: 'x' })).toBe(false);
  });

  it('UTF-16 budget이 surrogate pair를 자르면 깨진 문자를 넣지 않는다', () => {
    const budget = createContextBudget(1);

    expect(budget.append({ text: '😀A' })).toBe(false);

    expect(budget.getBlocks()).toEqual([]);
    expect(budget.getRemainingChars()).toBe(0);
  });
});
