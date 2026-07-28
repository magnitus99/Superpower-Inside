import { describe, expect, it } from 'vitest';
import type { ToolDefinition } from '../llm/providers';
import {
  MAX_CHAT_TOOL_CATALOG_BYTES,
  MAX_CHAT_TOOL_DEFINITIONS,
  selectBoundedToolDefinitions,
} from './tool-catalog-budget';

function tool(name: string, description = name): ToolDefinition {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: { type: 'object', properties: {} },
    },
  };
}

describe('채팅 provider 도구 카탈로그 예산', () => {
  it('내장 도구를 보존하고 전체 정의 수를 64개로 제한한다', () => {
    const native = Array.from({ length: 5 }, (_, index) => tool(`superpower_inside_${index}`));
    const external = Array.from({ length: 100 }, (_, index) => tool(`external_${index}`));

    const result = selectBoundedToolDefinitions(native, external);

    expect(result).toHaveLength(MAX_CHAT_TOOL_DEFINITIONS);
    expect(result.slice(0, native.length)).toEqual(native);
  });

  it('과도하게 큰 외부 schema를 건너뛰고 뒤의 작은 도구를 유지한다', () => {
    const native = [tool('superpower_inside_search')];
    const oversized = tool('oversized', 'x'.repeat(MAX_CHAT_TOOL_CATALOG_BYTES));
    const small = tool('small');

    const result = selectBoundedToolDefinitions(native, [oversized, small]);

    expect(result.map((definition) => definition.function.name)).toEqual([
      'superpower_inside_search',
      'small',
    ]);
  });

  it('중복 이름은 첫 정의만 provider에 전달한다', () => {
    const first = tool('same', 'first');
    const second = tool('same', 'second');

    expect(selectBoundedToolDefinitions([], [first, second])).toEqual([first]);
  });
});
