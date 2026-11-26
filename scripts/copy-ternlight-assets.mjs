import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ARTIFACT_PATHS } from './artifact-paths.mjs';
import { root } from './script-process.mjs';

const source = join(root, 'node_modules/@ternlight/base/pkg-node/tern_engine_bg.wasm');
const target = join(root, ARTIFACT_PATHS.plugin, 'tern_engine_bg.wasm');
const expectedHash = '27819b70b83fb24a493792db7bdf6b9cae4a1531df408809d1e57d580a3e9087';
if (!statSync(source, { throwIfNoEntry: false })?.isFile()) {
  console.error(`ERROR: Ternlight WASM asset is missing: ${source}`);
  process.exit(1);
}

// 검사한 바이트 자체를 기록해 checksum 검사와 복사 사이에 입력이 바뀌지 않게 합니다.
const bytes = readFileSync(source);
const actualHash = createHash('sha256').update(bytes).digest('hex');
if (actualHash !== expectedHash) {
  console.error(`ERROR: Ternlight WASM checksum mismatch: ${actualHash}`);
  process.exit(1);
}

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, bytes);
console.log(`Copied Ternlight WASM asset to ${target}`);
