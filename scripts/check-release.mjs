#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { npm } from './script-process.mjs';

const options = { cwd: process.cwd() };
npm(['run', 'security:full'], options);
npm(['run', 'build'], options);
const { version } = JSON.parse(readFileSync('manifest.json', 'utf8'));
if (typeof version !== 'string' || !version) {
  console.error('ERROR: manifest.json 버전을 확인할 수 없습니다.');
  process.exit(1);
}
npm(['run', 'review', '--', '--tag', version, '--built'], options);
