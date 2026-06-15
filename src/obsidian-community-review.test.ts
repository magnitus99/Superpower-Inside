import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '..');
const sourceRoots = ['main.ts', 'src'];

function listSourceFiles(path: string): string[] {
  const absolutePath = resolve(root, path);
  const stats = statSync(absolutePath);
  if (stats.isFile()) {
    return absolutePath.endsWith('.ts') && !absolutePath.endsWith('.test.ts')
      ? [absolutePath]
      : [];
  }

  return readdirSync(absolutePath).flatMap((entry) => {
    const child = join(absolutePath, entry);
    const childStats = statSync(child);
    if (childStats.isDirectory()) return listSourceFiles(relative(root, child));
    return child.endsWith('.ts') && !child.endsWith('.test.ts') ? [child] : [];
  });
}

const sources = sourceRoots.flatMap(listSourceFiles).map((file) => ({
  file: relative(root, file),
  source: readFileSync(file, 'utf8'),
}));

describe('Obsidian community static review guards', () => {
  it('does not use direct style property assignments in runtime TypeScript', () => {
    const offenders = sources.flatMap(({ file, source }) =>
      source
        .split('\n')
        .map((line, index) => ({ file, line, index: index + 1 }))
        .filter(({ line }) => /\b[A-Za-z0-9_$)\]]+\.style\./.test(line))
        .map(({ file, line, index }) => `${file}:${index}: ${line.trim()}`),
    );

    expect(offenders).toEqual([]);
  });

  it('does not assign raw HTML strings to DOM properties', () => {
    const offenders = sources.flatMap(({ file, source }) =>
      source
        .split('\n')
        .map((line, index) => ({ file, line, index: index + 1 }))
        .filter(({ line }) => /\b(innerHTML|outerHTML)\s*=/.test(line))
        .map(({ file, line, index }) => `${file}:${index}: ${line.trim()}`),
    );

    expect(offenders).toEqual([]);
  });

  it('does not create heading tags directly with createEl in runtime TypeScript', () => {
    const offenders = sources.flatMap(({ file, source }) =>
      source
        .split('\n')
        .map((line, index) => ({ file, line, index: index + 1 }))
        .filter(({ line }) => /createEl\(\s*['"]h[1-6]['"]/.test(line))
        .map(({ file, line, index }) => `${file}:${index}: ${line.trim()}`),
    );

    expect(offenders).toEqual([]);
  });

  it('does not attach inline style attributes to created DOM nodes', () => {
    const offenders = sources.flatMap(({ file, source }) =>
      source
        .split('\n')
        .map((line, index) => ({ file, line, index: index + 1 }))
        .filter(({ line }) => /\bstyle\s*:/.test(line) && !line.trim().startsWith('//'))
        .map(({ file, line, index }) => `${file}:${index}: ${line.trim()}`),
    );

    expect(offenders).toEqual([]);
  });

  it('uses window timer APIs for popout-compatible runtime scheduling', () => {
    const timerCallPattern =
      /(?:^|[^\w.])(setTimeout|setInterval|clearTimeout|clearInterval)\s*\(/;
    const timerTypePattern = /typeof\s+(setTimeout|setInterval|clearTimeout|clearInterval)\b/;
    const offenders = sources.flatMap(({ file, source }) =>
      source
        .split('\n')
        .map((line, index) => ({ file, line, index: index + 1 }))
        .filter(({ line }) => timerCallPattern.test(line) || timerTypePattern.test(line))
        .map(({ file, line, index }) => `${file}:${index}: ${line.trim()}`),
    );

    expect(offenders).toEqual([]);
  });

  it('uses Vault#configDir instead of hard-coded Obsidian config folders', () => {
    const offenders = sources.flatMap(({ file, source }) =>
      source
        .split('\n')
        .map((line, index) => ({ file, line, index: index + 1 }))
        .filter(({ line }) => /['"]\.obsidian['"]/.test(line))
        .map(({ file, line, index }) => `${file}:${index}: ${line.trim()}`),
    );

    expect(offenders).toEqual([]);
  });

  it('narrows TFile values with instanceof instead of type assertions', () => {
    const offenders = sources.flatMap(({ file, source }) =>
      source
        .split('\n')
        .map((line, index) => ({ file, line, index: index + 1 }))
        .filter(({ line }) => /\bas\s+TFile\b/.test(line))
        .map(({ file, line, index }) => `${file}:${index}: ${line.trim()}`),
    );

    expect(offenders).toEqual([]);
  });

  it('uses FileManager trash handling instead of permanent vault deletion', () => {
    const offenders = sources.flatMap(({ file, source }) =>
      source
        .split('\n')
        .map((line, index) => ({ file, line, index: index + 1 }))
        .filter(({ line }) => /\bvault\.delete\(/.test(line))
        .map(({ file, line, index }) => `${file}:${index}: ${line.trim()}`),
    );

    expect(offenders).toEqual([]);
  });

  it('does not render MCP tool picker choices as clickable divs', () => {
    const offenders = sources.flatMap(({ file, source }) =>
      source
        .split('\n')
        .map((line, index) => ({ file, line, index: index + 1 }))
        .filter(({ line }) => /createDiv\(\{\s*cls:\s*['"]superpower-inside-mcp-tool-item/.test(line))
        .map(({ file, line, index }) => `${file}:${index}: ${line.trim()}`),
    );

    expect(offenders).toEqual([]);
  });
});
