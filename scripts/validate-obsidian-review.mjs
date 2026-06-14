#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const args = new Set(process.argv.slice(2));
const tagArg = readOption('--tag');
const built = args.has('--built');
const errors = [];

const root = process.cwd();
const manifest = readJson('manifest.json');
const pkg = readJson('package.json');
const versions = readJson('versions.json');
const readme = readText('README.md');
const styles = readText('styles.css');

validateVersionMetadata();
validateTag();
validateManifestDescription();
validateReadmeEnglishIntro();
validateCss();
validateGeneratedWasmDeclarations();
validateBuiltAssets();

if (errors.length > 0) {
  console.error('Obsidian review gate failed:');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log('Obsidian review gate passed.');

function readOption(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function readText(relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

function validateVersionMetadata() {
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) {
    errors.push(`manifest.json version must be plain SemVer x.y.z: ${manifest.version}`);
  }
  if (pkg.version !== manifest.version) {
    errors.push(`package.json version ${pkg.version} must match manifest version ${manifest.version}`);
  }
  if (versions[manifest.version] !== manifest.minAppVersion) {
    errors.push(
      `versions.json must contain "${manifest.version}": "${manifest.minAppVersion}"`,
    );
  }
}

function validateTag() {
  if (!tagArg) return;
  if (tagArg.startsWith('v')) {
    errors.push(`release tag must not start with "v": ${tagArg}`);
  }
  if (tagArg !== manifest.version) {
    errors.push(`release tag ${tagArg} must exactly match manifest version ${manifest.version}`);
  }
}

function validateManifestDescription() {
  if (typeof manifest.description !== 'string' || manifest.description.trim() === '') {
    errors.push('manifest.json description is required');
    return;
  }
  if (/\bObsidian\b/i.test(manifest.description)) {
    errors.push('manifest.json description must not include the word "Obsidian"');
  }
  if (!/[.!?]$/.test(manifest.description.trim())) {
    errors.push('manifest.json description must end with punctuation');
  }
}

function validateReadmeEnglishIntro() {
  const firstParagraphs = readme
    .split(/\n{2,}/)
    .slice(0, 3)
    .join('\n')
    .replace(/```[\s\S]*?```/g, '');
  const latinWords = firstParagraphs.match(/[A-Za-z]{3,}/g) ?? [];
  const hangulWords = firstParagraphs.match(/[가-힣]+/g) ?? [];
  if (latinWords.length < 20 || latinWords.length <= hangulWords.length) {
    errors.push('README must start with an English description before translated sections');
  }
}

function validateCss() {
  const importantLine = findLine(styles, '!important');
  if (importantLine !== -1) {
    errors.push(`styles.css must not use !important at line ${importantLine}`);
  }

  const seenSelectors = new Map();
  for (const selector of extractTopLevelSelectors(styles)) {
    const previousLine = seenSelectors.get(selector.normalized);
    if (previousLine !== undefined) {
      errors.push(
        `styles.css duplicate selector "${selector.display}" at line ${selector.line}; first used at line ${previousLine}`,
      );
    } else {
      seenSelectors.set(selector.normalized, selector.line);
    }
  }
}

function validateBuiltAssets() {
  if (!built) return;
  for (const asset of ['manifest.json', 'main.js', 'styles.css']) {
    if (!existsSync(path.join(root, asset))) {
      errors.push(`release asset is missing: ${asset}`);
    }
  }
}

function validateGeneratedWasmDeclarations() {
  const declarationPath = 'generated/rag-wasm/rag_wasm.d.ts';
  if (!existsSync(path.join(root, declarationPath))) return;
  const declaration = readText(declarationPath);
  const eslintDisableLine = findLine(declaration, 'eslint-disable');
  if (eslintDisableLine !== -1) {
    errors.push(`${declarationPath} must not include eslint-disable at line ${eslintDisableLine}`);
  }
}

function findLine(content, needle) {
  const lines = content.split('\n');
  const index = lines.findIndex((line) => line.includes(needle));
  return index === -1 ? -1 : index + 1;
}

function extractTopLevelSelectors(css) {
  const selectors = [];
  let depth = 0;
  let prelude = '';
  let preludeLine = 1;
  let line = 1;
  let inComment = false;

  for (let index = 0; index < css.length; index += 1) {
    const char = css[index];
    const next = css[index + 1];

    if (char === '\n') line += 1;

    if (inComment) {
      if (char === '*' && next === '/') {
        inComment = false;
        index += 1;
      }
      continue;
    }

    if (char === '/' && next === '*') {
      inComment = true;
      index += 1;
      continue;
    }

    if (depth === 0 && prelude === '' && !/\s/.test(char)) {
      preludeLine = line;
    }

    if (char === '{') {
      if (depth === 0) {
        const selector = prelude.trim();
        if (selector && !selector.startsWith('@')) {
          selectors.push({
            display: selector.replace(/\s+/g, ' '),
            normalized: selector.replace(/\s+/g, ' ').trim(),
            line: preludeLine,
          });
        }
        prelude = '';
      }
      depth += 1;
      continue;
    }

    if (char === '}') {
      depth = Math.max(0, depth - 1);
      if (depth === 0) prelude = '';
      continue;
    }

    if (depth === 0) {
      prelude += char;
    }
  }

  return selectors;
}
