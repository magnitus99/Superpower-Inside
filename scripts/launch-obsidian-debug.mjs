#!/usr/bin/env node
import { statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { root, run } from './script-process.mjs';

const mac = process.platform === 'darwin';
const windows = process.platform === 'win32';
const vault = join(root, '.test-vault');
const stat = (path) => statSync(path, { throwIfNoEntry: false });
const isDirectory = (path) => stat(path)?.isDirectory();
const configured = mac ? process.env.OBSIDIAN_APP : process.env.OBSIDIAN_EXE;
const app = configured ? resolve(root, configured) : mac ? '/Applications/Obsidian.app' : windows
  ? [process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs'), process.env.ProgramFiles, process.env['ProgramFiles(x86)']]
      .filter(Boolean).map((dir) => join(dir, 'Obsidian', 'Obsidian.exe')).find((file) => stat(file)?.isFile())
  : 'obsidian';
if (!app || (mac && !isDirectory(app)) || (configured && !mac && !stat(app)?.isFile())) {
  console.error(`ERROR: Obsidian을 찾을 수 없습니다. ${mac ? 'OBSIDIAN_APP' : 'OBSIDIAN_EXE'} 환경변수로 설치 경로를 지정하세요.`);
  process.exit(1);
}
if (!isDirectory(vault)) {
  console.error('ERROR: 테스트 볼트가 없습니다. 먼저 node scripts/setup-dev.mjs를 실행하세요.');
  process.exit(1);
}

console.log(`🚀 Obsidian을 디버그 모드로 실행합니다...
   DevTools: ${mac ? 'Cmd+Option+I' : 'Ctrl+Shift+I'}
   VS Code 디버거: launch.json의 'Attach to Obsidian Renderer' 사용
   테스트 볼트: ${vault}`);
const args = [...(windows ? [`--user-data-dir=${join(vault, '.obsidian-dev-profile')}`] : []),
  '--remote-debugging-port=9222', vault];
if (mac) run('open', ['-a', app, '--args', ...args]);
else run(app, args);
