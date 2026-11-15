import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

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
    expect(config).toContain('watchFiles:');
    expect(config).toContain('onEnd');
  });

  it.each(['dev', 'production'])('%s 빌드가 독립적인 플러그인 디렉터리를 실제로 생성한다', (mode) => {
    const fixtures = resolve(root, '.thinkrail/context/plugin-output-tests');
    mkdirSync(fixtures, { recursive: true });
    const fixture = mkdtempSync(resolve(fixtures, 'fixture-'));
    mkdirSync(resolve(fixture, 'scripts'));
    for (const file of ['esbuild.config.mjs', 'scripts/artifact-paths.mjs', 'scripts/mcp-stdio-build.mjs', 'scripts/bundle-size-policy.mjs']) {
      copyFileSync(resolve(root, file), resolve(fixture, file));
    }
    symlinkSync(resolve(root, 'node_modules'), resolve(fixture, 'node_modules'), 'junction');
    writeFileSync(resolve(fixture, 'main.ts'), 'export const fixture = `value\n    \nend`;');
    for (const file of ['manifest.json', 'styles.css', 'THIRD_PARTY_NOTICES.md']) {
      writeFileSync(resolve(fixture, file), `fixture ${file}`);
    }
    execFileSync(process.execPath, ['esbuild.config.mjs', mode], { cwd: fixture });
    expect(existsSync(resolve(fixture, '.local/plugin/main.js'))).toBe(true);
    expect(readFileSync(resolve(fixture, '.local/plugin/main.js'), 'utf8')).not.toMatch(/[ \t]+$/m);
    expect(createRequire(import.meta.url)(resolve(fixture, '.local/plugin/main.js')).fixture).toBe('value\n    \nend');
    expect(existsSync(resolve(fixture, 'main.js'))).toBe(false);
    for (const file of ['manifest.json', 'styles.css', 'THIRD_PARTY_NOTICES.md']) {
      expect(readFileSync(resolve(fixture, `.local/plugin/${file}`), 'utf8')).toBe(`fixture ${file}`);
      expect(readFileSync(resolve(fixture, file), 'utf8')).toBe(`fixture ${file}`);
    }
    // 합성 빌드 결과는 Artifacts에서 확인하도록 보존합니다.
  });

  it('watch 중 CSS·manifest 변경도 출력 복사본에 반영한다', async () => {
    const fixtures = resolve(root, '.thinkrail/context/plugin-output-tests');
    mkdirSync(fixtures, { recursive: true });
    const fixture = mkdtempSync(resolve(fixtures, 'watch-'));
    mkdirSync(resolve(fixture, 'scripts'));
    for (const file of ['esbuild.config.mjs', 'scripts/artifact-paths.mjs', 'scripts/mcp-stdio-build.mjs', 'scripts/bundle-size-policy.mjs']) {
      copyFileSync(resolve(root, file), resolve(fixture, file));
    }
    symlinkSync(resolve(root, 'node_modules'), resolve(fixture, 'node_modules'), 'junction');
    writeFileSync(resolve(fixture, 'main.ts'), 'export const fixture = true;');
    for (const file of ['manifest.json', 'styles.css', 'THIRD_PARTY_NOTICES.md']) {
      writeFileSync(resolve(fixture, file), `before ${file}`);
    }
    const child = spawn(process.execPath, ['esbuild.config.mjs'], { cwd: fixture, stdio: 'ignore' });
    try {
      await vi.waitFor(() => {
        expect(existsSync(resolve(fixture, '.local/plugin/main.js'))).toBe(true);
        for (const file of ['styles.css', 'manifest.json', 'THIRD_PARTY_NOTICES.md']) {
          expect(readFileSync(resolve(fixture, `.local/plugin/${file}`), 'utf8')).toBe(`before ${file}`);
        }
      }, { timeout: 10000 });
      for (const file of ['styles.css', 'manifest.json', 'THIRD_PARTY_NOTICES.md']) {
        writeFileSync(resolve(fixture, file), `after ${file}`);
      }
      await vi.waitFor(() => {
        for (const file of ['styles.css', 'manifest.json', 'THIRD_PARTY_NOTICES.md']) {
          expect(readFileSync(resolve(fixture, `.local/plugin/${file}`), 'utf8')).toBe(`after ${file}`);
        }
      }, { timeout: 10000 });
    } finally {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
  }, 25000);

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
