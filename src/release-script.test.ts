import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '..');

describe('릴리스 스크립트 브랜치 정책', () => {
  it('버전 커밋과 태그 생성은 main 브랜치에서만 허용한다', () => {
    const script = readFileSync(resolve(root, 'scripts/bump-version.fish'), 'utf8');

    expect(script).toContain('set REQUIRED_RELEASE_BRANCH main');
    expect(script).toContain('if test "$CURRENT_BRANCH" != "$REQUIRED_RELEASE_BRANCH"');
    expect(script).not.toContain('main 브랜치에서 직접 릴리스 커밋을 만들 수 없습니다');
  });

  it('릴리스 스크립트는 release-notes 파일 대신 GitHub Release 본문 작성을 안내한다', () => {
    const script = readFileSync(resolve(root, 'scripts/bump-version.fish'), 'utf8');

    expect(script).toContain('release-notes-*.md 문서는 생성하지 않습니다');
    expect(script).toContain('GitHub Release가 생성되면 릴리즈 요약을 본문에 직접 붙여 넣으세요');
    expect(script).not.toContain('./scripts/release-notes.fish');
    expect(script).not.toContain('--notes-file');
    expect(script).not.toContain("git tag --sort=version:refname --list '[0-9]*'");
  });
});

describe('Rust security tool installer portability', () => {
  it('passes cargo install feature flags through for cargo-geiger', () => {
    const script = readFileSync(resolve(root, 'scripts/install-rust-security-tools.fish'), 'utf8');

    expect(script).toContain('set -l install_args $argv[4..-1]');
    expect(script).toContain('cargo install "$package" --version "$tool_version" --locked --force $install_args');
    expect(script).toContain(
      'install_cargo_tool cargo-geiger 0.13.0 cargo-geiger --features vendored-openssl',
    );
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
