import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = resolve(root, 'generated/graph-community-worker-source.ts');
const result = await build({
  entryPoints: [resolve(root, 'src/graph/community-worker-entry.ts')],
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  legalComments: 'none',
});
const output = result.outputFiles?.[0]?.text;
if (!output) throw new Error('Graph community worker bundle was not generated.');
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(
  outputPath,
  `// 이 파일은 scripts/build-graph-worker.mjs가 생성합니다. 직접 수정하지 마세요.\nexport const GRAPH_COMMUNITY_WORKER_SOURCE = ${JSON.stringify(output)};\n`,
  'utf8',
);
