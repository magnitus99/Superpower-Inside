import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { App } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import { getTernlightEmbedder } from './ternlight-runtime';
import { TERNLIGHT_MODEL_FILE_NAME } from './ternlight-model';

vi.mock('obsidian', () => ({
  normalizePath: (path: string) => path,
  requestUrl: vi.fn(),
}));

describe('Ternlight runtime', () => {
  it('검증된 내장 WASM을 초기화해 384차원 정규화 벡터를 만든다', async () => {
    const bytes = readFileSync(join(process.cwd(), TERNLIGHT_MODEL_FILE_NAME));
    const model = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const app = {
      vault: {
        configDir: '.obsidian',
        adapter: {
          exists: vi.fn().mockResolvedValue(true),
          readBinary: vi.fn().mockResolvedValue(model),
          writeBinary: vi.fn(),
          remove: vi.fn(),
          rename: vi.fn(),
        },
      },
    } as unknown as App;

    const embed = await getTernlightEmbedder({
      app,
      pluginId: 'superpower-inside',
      pluginVersion: '1.4.2',
    });
    const vector = embed('semantic search inside Obsidian');
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));

    expect(vector).toHaveLength(384);
    expect(norm).toBeCloseTo(1, 5);
  });
});
