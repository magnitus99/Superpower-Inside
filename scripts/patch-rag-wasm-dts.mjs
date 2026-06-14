#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';

const declarationPath = process.argv[2];

if (!declarationPath) {
  console.error('Usage: patch-rag-wasm-dts.mjs <path>');
  process.exit(1);
}

const originalContent = readFileSync(declarationPath, 'utf8');
const patchedContent = originalContent.replace(/^\/\* eslint-disable \*\/\r?\n/m, '');

writeFileSync(declarationPath, patchedContent);
