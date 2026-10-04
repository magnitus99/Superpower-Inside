import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workers = [
  ['graph/community', 'graph-community', 'GRAPH_COMMUNITY'],
  ['rag/bm25', 'bm25', 'BM25'],
  ['rag/vector-search', 'vector-search', 'VECTOR_SEARCH'],
  ['llm/ternlight', 'ternlight', 'TERNLIGHT'],
];

await mkdir(resolve(root, 'generated'), { recursive: true });
for (const [entry, output, constant] of workers) {
  const result = await build({
    entryPoints: [resolve(root, `src/${entry}-worker-entry.ts`)],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    legalComments: 'none',
  });
  const source = result.outputFiles?.[0]?.text;
  if (!source) throw new Error(`${constant} worker 번들이 생성되지 않았습니다.`);
  await writeFile(
    resolve(root, `generated/${output}-worker-source.ts`),
    `// 이 파일은 scripts/build-workers.mjs가 생성합니다. 직접 수정하지 마세요.\nexport const ${constant}_WORKER_SOURCE = ${JSON.stringify(source)};\n`,
    'utf8',
  );
}
