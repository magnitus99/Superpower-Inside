import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

describe('자체 생성물 통합 경로', () => {
  it('Rust·bindgen·base64 출력은 .local 아래에만 둔다', () => {
    const build = source('scripts/build-rag-wasm.fish');
    expect(build).toContain('$REPO_ROOT/.local/generated/rag-wasm');
    expect(build).toContain('$REPO_ROOT/.local/cache/bindgen');
    expect(build).toContain('$REPO_ROOT/.local/cache/rust');
    expect(build).toContain('.local/generated/rag-wasm-bytes.ts');
    expect(build).not.toContain('toolchain install');
    expect(build).toContain('--frozen');
    expect(source('scripts/check-rust-local.fish')).toContain('/.local/cache/rust/');
    expect(source('scripts/check-rust-security.fish')).toContain('/.local/cache/rust/');
  });

  it('검증 캐시는 의존성 폴더나 루트 simulations에 생성하지 않는다', () => {
    for (const file of ['scripts/obsidian-preview.mjs', 'scripts/preview-verify.mjs']) {
      expect(source(file)).toContain('ARTIFACT_PATHS.preview');
    }
    for (const file of ['scripts/search-eval/adapters.mjs', 'scripts/search-eval/run-vault.mjs']) {
      expect(source(file)).toContain('ARTIFACT_PATHS.searchEval');
      expect(source(file)).not.toContain('node_modules/.cache/search-eval');
    }
  });

  it('캐시 전체가 아니라 명시된 생성 파일만 추적할 수 있다', async () => {
    const { spawnSync } = await import('node:child_process');
    const ignored = (file) => spawnSync('git', ['check-ignore', '--no-index', '-q', file]).status === 0;
    for (const file of ['.local/cache/search-eval/result.json', '.local/plugin/data.json', '.local/plugin/embeddinggemma-300m/config.json', '.local/generated/private.json']) {
      expect(ignored(file), file).toBe(true);
    }
    for (const file of ['.local/generated/rag-wasm/rag_wasm.js', '.local/generated/rag-wasm-bytes.ts', '.local/plugin/main.js', '.local/plugin/pdf-worker.js']) {
      expect(ignored(file), file).toBe(false);
    }
  });
});
