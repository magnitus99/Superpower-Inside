import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '..');

describe('릴리스 스크립트 브랜치 안내', () => {
  it('버전 커밋과 태그 푸시의 다음 단계를 안내한다', () => {
    const bump = readFileSync(resolve(root, 'scripts/bump-version.mjs'), 'utf8');
    const tag = readFileSync(resolve(root, 'scripts/tag-release.mjs'), 'utf8');

    expect(bump).toContain('patch|minor|major');
    expect(bump).toContain('npm run release:tag');
    expect(tag).toContain('git push origin ${version}');
  });

  it('릴리스 스크립트는 release-notes 파일 대신 GitHub Release 본문 작성을 안내한다', () => {
    const script = readFileSync(resolve(root, 'scripts/bump-version.mjs'), 'utf8');

    expect(script).toContain('다음: dev를 main으로 squash merge하는 PR을 만들고');
    expect(script).not.toContain('./scripts/release-notes.fish');
    expect(script).not.toContain('--notes-file');
    expect(script).not.toContain("git tag --sort=version:refname --list '[0-9]*'");
  });
});

describe('로컬 배포 경로 검증', () => {
  it('review는 원본 대신 staging 자산과 이동한 생성물의 무결성을 검사한다', () => {
    const review = readFileSync(resolve(root, 'scripts/validate-obsidian-review.mjs'), 'utf8');
    expect(review).toContain("path.join(root, ARTIFACT_PATHS.plugin, 'main.js')");
    expect(review).toContain('`${ARTIFACT_PATHS.generated}/embeddinggemma-assets.ts`');
    expect(review).toContain('`${ARTIFACT_PATHS.generated}/rag-wasm/rag_wasm.d.ts`');
    expect(review).toContain('staged release asset differs from source');
    expect(review).toContain('ARTIFACT_PATHS.plugin, asset.file');
    expect(review).not.toContain("path.join(root, 'main.js')");
  });
});

describe('Windows Obsidian setup scripts', () => {
  it('opens the test vault in an isolated Obsidian profile instead of using URI path lookup', () => {
    const setupScript = readFileSync(resolve(root, 'scripts/setup-dev.ps1'), 'utf8');
    const launchScript = readFileSync(resolve(root, 'scripts/launch-obsidian-debug.ps1'), 'utf8');
    const enableScript = readFileSync(resolve(root, 'scripts/enable-obsidian-dev-plugins.mjs'), 'utf8');

    expect(setupScript).toContain('ExtraObsidianConfigDirs');
    expect(setupScript).toContain('function Write-Utf8NoBom');
    expect(setupScript).toContain('System.Text.UTF8Encoding($false)');
    expect(setupScript).toContain('function Register-ObsidianVault');
    expect(setupScript).toContain('[bool]$Open = $false');
    expect(setupScript).toContain('[bool]$ResetInvalid = $false');
    expect(setupScript).toContain('"obsidian"');
    expect(setupScript).toContain('"obsidian.json"');
    expect(setupScript).toContain('Remove-CommunityPlugin');
    expect(launchScript).toContain('setup-dev.ps1');
    expect(launchScript).toContain('-ExtraObsidianConfigDirs @($profileDir)');
    expect(launchScript).toContain('enable-obsidian-dev-plugins.mjs');
    expect(launchScript).toContain('function Get-AvailablePort');
    expect(launchScript).toContain('.obsidian-dev-profile');
    expect(launchScript).toContain('--user-data-dir=');
    expect(launchScript).not.toContain('obsidian://open?path=');
    expect(enableScript).toContain('localStorage.setItem("enable-plugin-" + app.appId, "true")');
    expect(enableScript).toContain('await app.plugins.setEnable(true)');
    expect(enableScript).toContain('await app.plugins.enablePlugin(id)');
  });
});
