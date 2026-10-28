#!/usr/bin/env node
import { execFile, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { prepare, serve } from './obsidian-preview.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const cache = resolve(root, 'simulations/obsidian-preview');
const screens = resolve(cache, 'screens');
const execFileAsync = promisify(execFile);

export const PREVIEW_CASES = [
  { name: 'chat-light-narrow', query: 'check&theme=light&width=360', width: 360, height: 720 },
  { name: 'chat-dark-medium', query: 'check&theme=dark&width=520', width: 520, height: 800 },
  { name: 'chat-empty-light', query: 'check&state=empty&theme=light&width=360', width: 360, height: 720 },
  { name: 'chat-error-dark', query: 'check&state=error&theme=dark&width=520', width: 520, height: 800 },
  { name: 'search-light-narrow', query: 'check&state=search&theme=light&width=360', width: 360, height: 720 },
  { name: 'search-dark-medium', query: 'check&state=search&theme=dark&width=520', width: 520, height: 800 },
  { name: 'search-empty-dark', query: 'check&state=search&empty&theme=dark&width=360', width: 360, height: 720 },
];

/**
 * 플랫폼별 Chrome 실행 후보를 만듭니다. Playwright를 거치지 않고 설치된
 * Chrome을 직접 헤드리스로 실행해 고정 뷰포트 결과를 남깁니다.
 * @param {{ platform?: NodeJS.Platform, environment?: NodeJS.ProcessEnv }} [input]
 * @returns {string[]} 실행 후보
 */
export function chromeCandidates({ platform = process.platform, environment = process.env } = {}) {
  const candidates = [];
  if (environment.CHROME_PATH) candidates.push(environment.CHROME_PATH);
  if (platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    );
  } else if (platform === 'win32') {
    const programFiles = environment.PROGRAMFILES ?? 'C:\\Program Files';
    const localAppData = environment.LOCALAPPDATA ?? '';
    candidates.push(
      join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    );
  } else {
    candidates.push('google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser');
  }
  return [...new Set(candidates)];
}

/**
 * 후보 중 실제로 실행 가능한 Chrome을 고릅니다.
 * @param {string[]} candidates 후보
 * @param {{ exists?: (path: string) => boolean, which?: (command: string) => boolean }} [tools]
 * @returns {string | null} 선택된 실행 파일
 */
export function findChrome(
  candidates,
  {
    exists = (path) => existsSync(path),
    which = (command) => spawnSync('which', [command], { stdio: 'ignore' }).status === 0,
  } = {},
) {
  return (
    candidates.find((candidate) =>
      candidate.includes('/') || candidate.includes('\\') ? exists(candidate) : which(candidate),
    ) ?? null
  );
}

/**
 * Chrome --dump-dom 결과에서 제품 계약 검사 상태를 읽습니다.
 * @param {string} html DOM 문자열
 * @returns {{ failed: boolean, text: string }} 검사 결과
 */
export function parsePreviewResult(html) {
  const tag = /<[^>]*id="preview-result"[^>]*>/i.exec(html);
  if (!tag) return { failed: true, text: '검수 결과 요소를 찾지 못했습니다.' };
  const failedAttribute = /data-failed="(true|false)"/i.exec(tag[0]);
  const start = (tag.index ?? 0) + tag[0].length;
  const end = html.indexOf('</div>', start);
  const raw = end < 0 ? '' : html.slice(start, end);
  return {
    failed: failedAttribute?.[1] !== 'false',
    text: decodeHtml(stripTags(raw)).trim(),
  };
}

function stripTags(value) {
  return value.replace(/<[^>]*>/g, '');
}

function decodeHtml(value) {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function chromeArguments(scenario, profile, output) {
  // Chrome headless는 창 너비를 500px 아래로 줄이지 않습니다. 좁은 패널은
  // 500px 창 가운데에 360px 패널로 배치해 잘림 없이 캡처합니다.
  const windowWidth = Math.max(scenario.width, 500);
  return [
    '--headless=new',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${profile}`,
    `--window-size=${windowWidth},${scenario.height}`,
    '--force-device-scale-factor=1',
    '--virtual-time-budget=10000',
    ...(output ? [`--screenshot=${output}`] : ['--dump-dom']),
  ];
}

async function runChrome(chrome, scenario, url, output) {
  const profile = mkdtempSync(join(tmpdir(), 'superpower-preview-'));
  try {
    return await execFileAsync(chrome, [...chromeArguments(scenario, profile, output), url], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      timeout: 60000,
    });
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
}

async function runCase(chrome, baseUrl, scenario) {
  const output = resolve(screens, `${scenario.name}.png`);
  const url = `${baseUrl}/?${scenario.query}`;
  // Chrome은 --screenshot와 --dump-dom을 한 실행에 함께 주면 가상 시간 뒤에도
  // 종료하지 않는 경우가 있어, 같은 페이지를 두 번 실행해 DOM과 픽셀을 따로 받습니다.
  try {
    const dom = await runChrome(chrome, scenario, url);
    await runChrome(chrome, scenario, url, output);
    return { name: scenario.name, ...parsePreviewResult(dom.stdout), screenshot: output };
  } catch (error) {
    return {
      name: scenario.name,
      failed: true,
      text: error instanceof Error ? error.message : String(error),
      screenshot: output,
    };
  }
}

async function main() {
  if (!existsSync(resolve(cache, 'reference.json'))) {
    console.log('Obsidian 기본 CSS 캐시가 없어 새로 준비합니다.');
    prepare();
  }
  if (!existsSync(resolve(cache, 'reference.json'))) {
    throw new Error('`npm run preview:prepare`로 Obsidian 기본 CSS·자산을 먼저 준비하세요.');
  }
  const chrome = findChrome(chromeCandidates());
  if (!chrome) {
    throw new Error(
      'Chrome을 찾지 못했습니다. CHROME_PATH를 지정하거나 Chrome을 설치한 뒤 다시 실행하세요.',
    );
  }
  mkdirSync(screens, { recursive: true });
  const server = await serve(0);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const results = [];
  try {
    for (const scenario of PREVIEW_CASES) {
      console.log(`preview:verify ${scenario.name} (${scenario.width}x${scenario.height})`);
      results.push(await runCase(chrome, baseUrl, scenario));
    }
  } finally {
    await new Promise((done) => server.close(done));
  }
  console.log(JSON.stringify({ reference: readReference(), results }, null, 2));
  if (results.some((result) => result.failed)) {
    console.error('preview:verify 실패: DOM 계약 검사 또는 스크린샷 생성이 실패했습니다.');
    process.exitCode = 1;
  }
}

function readReference() {
  try {
    const reference = JSON.parse(readFileSync(resolve(cache, 'reference.json'), 'utf8'));
    return { version: reference.version, cssSha256: reference.cssSha256 };
  } catch {
    return null;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
