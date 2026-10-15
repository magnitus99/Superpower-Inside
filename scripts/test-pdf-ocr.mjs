// 실제 Chromium에서 배포용 PDF worker를 그대로 실행해 OCR까지 포함한 추출을 검사합니다.
// 파일명·본문은 출력하지 않으며 형식별 집계만 남깁니다.
// 사용법: node scripts/test-pdf-ocr.mjs <PDF가 있는 디렉터리> [--timeout-ms 1200000] [--chrome <경로>] [--serve]
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, extname, join } from 'node:path';
import process from 'node:process';

const directoryArg = process.argv[2];
if (!directoryArg || directoryArg.startsWith('--')) {
  console.error('검사할 PDF 예시 디렉터리를 지정하세요.');
  process.exit(1);
}
const directory = resolve(directoryArg);
const option = (name) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
};
const timeoutMs = Number(option('--timeout-ms') ?? 20 * 60_000);
const serveOnly = process.argv.includes('--serve');
const chromeCandidates = [
  option('--chrome'),
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].filter(Boolean);

const entries = await readdir(directory, { withFileTypes: true }).catch(() => null);
if (!entries) {
  console.error('예시 디렉터리를 읽을 수 없습니다.');
  process.exit(1);
}
const pdfFiles = entries.filter(
  (entry) => entry.isFile() && extname(entry.name).toLowerCase() === '.pdf',
);
if (pdfFiles.length === 0) {
  console.error('검사할 PDF 예시 파일이 없습니다.');
  process.exit(1);
}

// 워커 파일은 저장소의 배포 산출물을 그대로 사용합니다.
const [workerSource, ocrSource] = await Promise.all([
  readFile(new URL('../pdf-worker.js', import.meta.url)),
  readFile(new URL('../pdf-ocr-worker.js', import.meta.url)),
]);

const page = `<!doctype html><html lang="ko"><meta charset="utf-8"><title>PDF 런타임 검사</title>
<body style="font:14px system-ui;padding:16px">
<p id="status">검사 준비 중</p><pre id="result"></pre>
<script>
(async () => {
  const files = await (await fetch('/files')).json();
  const results = [];
  for (const file of files) {
    document.querySelector('#status').textContent = '검사 중 ' + (results.length + 1) + '/' + files.length;
    const started = performance.now();
    const bytes = new Uint8Array(await (await fetch('/file/' + file.index)).arrayBuffer());
    const worker = new Worker('/pdf-worker.js');
    let ocrUsed = false;
    const outcome = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ ok: false, reason: 'timeout' }), 300000);
      worker.onerror = () => { clearTimeout(timer); resolve({ ok: false, reason: 'worker-error' }); };
      worker.onmessage = ({ data }) => {
        // pdf.js 내부 핸드셰이크 등 요청 id가 없는 메시지는 결과가 아닙니다.
        if (!data || data.id !== 1) return;
        if (data.kind === 'ocr-assets') {
          ocrUsed = true;
          worker.postMessage({ id: data.id, kind: 'ocr-assets', url: location.origin + '/pdf-ocr-worker.js' });
          return;
        }
        if (data.kind === 'ocr-error') { clearTimeout(timer); resolve({ ok: false, reason: 'ocr-worker-error' }); return; }
        if (data.kind) return;
        clearTimeout(timer);
        resolve({
          ok: data.ok === true,
          reason: typeof data.reason === 'string' ? data.reason : null,
          chars: typeof data.text === 'string' ? data.text.length : 0,
          segments: Array.isArray(data.segments) ? data.segments.length : 0,
        });
      };
      worker.postMessage({ id: 1, bytes }, [bytes.buffer]);
    });
    worker.terminate();
    results.push({ index: file.index, ocrUsed, elapsedMs: Math.round(performance.now() - started), ...outcome });
    void fetch('/progress', { method: 'POST', body: JSON.stringify({ completed: results.length, total: files.length }) });
  }
  document.querySelector('#status').textContent = '검사 완료';
  document.querySelector('#result').textContent = JSON.stringify(results, null, 2);
  await fetch('/result', { method: 'POST', body: JSON.stringify({ results }) });
})().catch((error) => {
  void fetch('/result', { method: 'POST', body: JSON.stringify({ error: String((error && error.message) || error).slice(0, 200) }) });
});
</script></body></html>`;

let settle;
const resultPromise = new Promise((resolveResult) => {
  settle = resolveResult;
});
const server = createServer(async (request, response) => {
  const path = request.url ?? '/';
  try {
    if (request.method === 'POST' && path === '/result') {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      response.end('ok');
      settle(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      return;
    }
    if (request.method === 'POST' && path === '/progress') {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const progress = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      console.error(`진행 ${progress.completed}/${progress.total}`);
      response.end('ok');
      return;
    }
    if (path === '/') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(page);
    } else if (path === '/files') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(pdfFiles.map((entry, index) => ({ index }))));
    } else if (path.startsWith('/file/')) {
      const index = Number(path.slice('/file/'.length));
      const entry = pdfFiles[index];
      if (!entry) throw new Error('unknown file');
      response.end(await readFile(join(directory, entry.name)));
    } else if (path === '/pdf-worker.js') {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(workerSource);
    } else if (path === '/pdf-ocr-worker.js') {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(ocrSource);
    } else {
      response.writeHead(404);
      response.end();
    }
  } catch {
    response.writeHead(500);
    response.end();
  }
});

await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
const url = `http://127.0.0.1:${server.address().port}/`;

let chrome = null;
let profileDirectory = null;
const cleanup = async () => {
  server.close();
  if (chrome && chrome.exitCode === null) {
    chrome.kill('SIGTERM');
    await new Promise((resolveExit) => setTimeout(resolveExit, 1500));
    if (chrome.exitCode === null) chrome.kill('SIGKILL');
  }
  if (profileDirectory) await rm(profileDirectory, { recursive: true, force: true }).catch(() => {});
};
process.on('SIGINT', () => {
  void cleanup().then(() => process.exit(130));
});

if (serveOnly) {
  console.error(`수동 검사 페이지: ${url}`);
} else {
  const chromePath = chromeCandidates.find((candidate) => candidate);
  profileDirectory = await mkdtemp(join(tmpdir(), 'pdf-ocr-check-'));
  chrome = spawn(
    chromePath,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=${profileDirectory}`,
      url,
    ],
    { stdio: 'ignore' },
  );
  chrome.on('error', () => {
    console.error(
      'Google Chrome을 찾을 수 없습니다. --chrome <경로> 또는 CHROME_PATH 환경변수를 지정하세요.',
    );
    void cleanup().then(() => process.exit(1));
  });
}

const timeout = serveOnly ? null : setTimeout(() => settle({ error: 'timeout' }), timeoutMs);
const payload = await resultPromise;
if (timeout) clearTimeout(timeout);
// 수동 모드에서는 서버를 유지해 페이지를 다시 열어볼 수 있게 합니다.
if (!serveOnly) await cleanup();

if (payload.error || !Array.isArray(payload.results)) {
  console.error(payload.error === 'timeout' ? '검사 대기 시간이 초과되었습니다.' : '검사 결과를 받지 못했습니다.');
  process.exit(1);
}

// 파일명 없이 형식 집계만 남깁니다. (ocrUsed는 OCR 경로 사용 횟수)
const summary = { pdf: { checked: 0, passed: 0, reasons: {}, ocrUsed: 0 } };
const knownReasons = [
  'too-large',
  'corrupt',
  'empty',
  'encrypted',
  'ocr-low-confidence',
  'timeout',
  'worker-error',
  'ocr-worker-error',
];
let failures = 0;
for (const result of payload.results) {
  const row = summary.pdf;
  row.checked += 1;
  const passed = result.ok === true && result.chars > 0 && result.segments > 0;
  if (passed) {
    row.passed += 1;
    if (result.ocrUsed) row.ocrUsed += 1;
    continue;
  }
  const reason =
    typeof result.reason === 'string' && knownReasons.includes(result.reason)
      ? result.reason
      : 'extraction';
  row.reasons[reason] = (row.reasons[reason] ?? 0) + 1;
  failures += 1;
}
console.log(JSON.stringify(summary, null, 2));
process.exitCode = failures > 0 ? 1 : 0;
if (serveOnly) {
  console.error('다시 검사하려면 페이지를 새로고침하세요. Ctrl+C로 종료합니다.');
  await new Promise(() => {});
}
