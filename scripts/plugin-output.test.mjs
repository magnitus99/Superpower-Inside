import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (file) => readFileSync(resolve(root, file), 'utf8');
const assets = ['manifest.json', 'main.js', 'styles.css', 'tern_engine_bg.wasm', 'embeddinggemma-worker.js', 'pdf-worker.js', 'pdf-ocr-worker.js', 'embeddinggemma-runtime.wasm', 'embeddinggemma-runtime.mjs', 'THIRD_PARTY_NOTICES.md'];

describe('로컬 플러그인 출력 계약', () => {
  it('번들과 독립 로딩용 원본 복사본을 플러그인 디렉터리에 배치한다', () => {
    const config = read('esbuild.config.mjs');
    expect(JSON.parse(read('package.json')).main).toBe('.local/plugin/main.js');
    expect(config).toContain('ARTIFACT_PATHS.plugin');
    expect(config).toContain('copyFile');
    for (const asset of ['manifest.json', 'styles.css', 'THIRD_PARTY_NOTICES.md']) expect(config).toContain(asset);
    expect(config).not.toContain("outfile: 'main.js'");
    expect(config).not.toContain("outputs['main.js']");
  });

  it('태그 릴리스는 빌드 없이 원본을 staging하고 숨김 디렉터리의 명시 자산을 배포한다', () => {
    const workflow = read('.github/workflows/release.yml');
    expect(workflow).toContain('cp manifest.json styles.css THIRD_PARTY_NOTICES.md .local/plugin/');
    for (const asset of assets) expect(workflow.match(new RegExp(`\\.local/plugin/${asset.replaceAll('.', '\\.')}`, 'g'))?.length).toBe(2);
    expect(workflow).not.toContain('actions/upload-artifact');
    expect(workflow).not.toContain('npm run build');
    expect(workflow).not.toContain('.local/plugin/*');
  });

  it('개발 연결은 새 출력만 가리키고 기존 연결 충돌을 명시적으로 거절한다', () => {
    const fish = read('scripts/setup-dev.fish');
    const ps = read('scripts/setup-dev.ps1');
    expect(fish).toContain('ARTIFACT_PATHS.plugin');
    expect(fish).toContain('readlink');
    expect(fish).toContain('재설정');
    expect(ps).toContain('ARTIFACT_PATHS.plugin');
    expect(ps).toContain('$pluginItem.Target');
    expect(ps).toContain('재설정');
    expect(ps).not.toContain('-Target $repoRoot');
  });

  it('버전 커밋은 이동한 추적 배포자산과 생성물을 포함한다', () => {
    const bump = read('scripts/bump-version.fish');
    expect(bump).toContain('.local/plugin');
    expect(bump).toContain('.local/generated');
    expect(bump).not.toContain('src/rag/rag-wasm-bytes.ts');
  });
});
