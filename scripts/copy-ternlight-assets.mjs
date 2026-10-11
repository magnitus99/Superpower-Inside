import { createHash } from 'node:crypto';
import { copyFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot, scriptMain } from './script-process.mjs';

export function copyVerifiedAsset(source, target, expected) {
  const actual = createHash('sha256').update(readFileSync(source)).digest('hex');
  if (actual !== expected) throw new Error(`Ternlight WASM 체크섬 불일치: ${actual}`);
  copyFileSync(source, target);
}

scriptMain(import.meta.url, () => {
  copyVerifiedAsset(
    join(repoRoot, 'node_modules/@ternlight/base/pkg-node/tern_engine_bg.wasm'),
    join(repoRoot, 'tern_engine_bg.wasm'),
    '27819b70b83fb24a493792db7bdf6b9cae4a1531df408809d1e57d580a3e9087',
  );
  console.log('Ternlight WASM 자산을 복사했습니다.');
});
