import { readFileSync } from 'node:fs';
import { runCommand, scriptMain } from './script-process.mjs';

export function checkRelease(version, run = runCommand) {
  run('npm', ['run', 'security:full']);
  run('npm', ['run', 'build']);
  run('npm', ['run', 'review', '--', '--tag', version, '--built']);
  run('npm', ['run', 'copy:check']);
}

scriptMain(import.meta.url, () =>
  checkRelease(JSON.parse(readFileSync('manifest.json', 'utf8')).version),
);
