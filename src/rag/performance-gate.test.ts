import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(__dirname, '..', '..');

describe('RAG performance gate wiring', () => {
  it('security:full은 RAG wrapper benchmark gate를 포함한다', () => {
    const packageJson = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts['rag:perf-gate']).toBe('node scripts/bench-rag-wrapper.mjs');
    expect(packageJson.scripts['security:full']).toContain('npm run rag:perf-gate');
  });

  it('benchmark script는 주요 RAG hot path 예산을 실패 조건으로 갖는다', () => {
    const source = readFileSync(join(REPO_ROOT, 'scripts/bench-rag-wrapper.mjs'), 'utf8');

    expect(source).toContain('PERFORMANCE_BUDGETS_MS');
    expect(source).toContain('vector_exact_query_bridge');
    expect(source).toContain('ivf_query_bridge');
    expect(source).toContain('markdown_chunk_2mb_bridge');
    expect(source).toContain('process.exitCode = 1');
  });
});
