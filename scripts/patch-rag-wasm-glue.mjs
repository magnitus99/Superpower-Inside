#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [, , gluePathArg] = process.argv;

if (!gluePathArg) {
  console.error('Usage: node scripts/patch-rag-wasm-glue.mjs <rag_wasm.js>');
  process.exit(1);
}

const gluePath = path.resolve(process.cwd(), gluePathArg);
const source = readFileSync(gluePath, 'utf8');
const original = "module_or_path = new URL('rag_wasm_bg.wasm', import.meta.url);";
const replacement = "throw new Error('Embedded WASM requires initSync(bytes).');";
const patched = source.replace(original, replacement);

if (patched === source) {
  console.error(`Unable to patch wasm-bindgen glue: ${gluePath}`);
  process.exit(1);
}

writeFileSync(gluePath, patched);
