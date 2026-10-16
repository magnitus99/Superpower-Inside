import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { captureReference } from './obsidian-preview/reference.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const cache = resolve(root, 'simulations/obsidian-preview');
const source = resolve(root, 'scripts/obsidian-preview');

export function parseCliJson(output) {
  const text = output.trim();
  if (!text.startsWith('=> ')) throw new Error('Obsidian CLI가 JSON 결과를 반환하지 않았습니다.');
  return JSON.parse(text.slice(3));
}

export function assetPaths(css) {
  return [...new Set(Array.from(css.matchAll(/url\(\s*["']?([^\s"')]+)["']?\s*\)/gu), (m) => m[1]))]
    .filter((path) => !path.startsWith('data:'))
    .map((path) => {
      if (!/^public\/[\w/.-]+$/u.test(path) || path.split('/').includes('..')) {
        throw new Error('기본 CSS에 지원하지 않는 자산 주소가 있습니다.');
      }
      return path;
    });
}

export function resolvePreviewFile(path, directory = cache, repo = root) {
  if (path === '/styles.css') return resolve(repo, 'styles.css');
  const files = {
    '/': resolve(source, 'index.html'),
    '/preview.css': resolve(source, 'preview.css'),
    '/bundle.js': resolve(directory, 'bundle.js'),
    '/reference.json': resolve(directory, 'reference.json'),
    '/app.css': resolve(directory, 'app.css'),
  };
  if (Object.hasOwn(files, path)) return files[path];
  if (!/^\/public\/[\w/.-]+$/u.test(path) || path.split('/').includes('..')) return null;
  const file = resolve(directory, path.slice(1));
  return file.startsWith(`${resolve(directory)}${sep}public${sep}`) ? file : null;
}

function evaluate(code) {
  return parseCliJson(
    execFileSync('obsidian', ['eval', `code=${code}`], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      timeout: 60000,
    }),
  );
}

export function prepare() {
  // 앱 자산은 로컬 검수 캐시에만 보관하며 제품 번들·Git에는 포함하지 않습니다.
  execFileSync('git', ['check-ignore', cache], { cwd: root, stdio: 'pipe' });
  mkdirSync(cache, { recursive: true });
  const reference = evaluate(`(${captureReference.toString()})()`);
  const paths = assetPaths(reference.css);
  for (const path of paths) {
    const asset = evaluate(
      `(async()=>{const response=await fetch(new URL(${JSON.stringify(path)},document.baseURI));if(!response.ok)throw Error('기본 자산 읽기 실패');return JSON.stringify({data:Buffer.from(await response.arrayBuffer()).toString('base64')})})()`,
    );
    const destination = resolve(cache, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, Buffer.from(asset.data, 'base64'));
  }
  const css = reference.css;
  delete reference.css;
  reference.cssSha256 = createHash('sha256').update(css).digest('hex');
  reference.assets = paths.map((path) => ({
    path,
    sha256: createHash('sha256')
      .update(readFileSync(resolve(cache, path)))
      .digest('hex'),
  }));
  writeFileSync(resolve(cache, 'app.css'), css);
  writeFileSync(resolve(cache, 'reference.json'), JSON.stringify(reference));
  console.log(
    `Obsidian ${reference.version}: 기본 CSS·자산 ${paths.length}개·한영 Markdown 준비 완료`,
  );
}

export async function buildPreview() {
  await build({
    entryPoints: [resolve(source, 'entry.mjs')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    outfile: resolve(cache, 'bundle.js'),
    alias: { obsidian: resolve(source, 'host.mjs') },
    packages: 'bundle',
    external: [
      'node:*',
      'electron',
      'child_process',
      'fs',
      'path',
      'os',
      'crypto',
      'stream',
      'util',
      'events',
      'net',
      'tls',
      'http',
      'https',
      'url',
      'buffer',
      'zlib',
      'string_decoder',
    ],
    banner: {
      js: 'var require = name => { const denied = new Proxy(function(){throw Error("검수에서 Node 모듈을 지원하지 않습니다: " + name);}, {get:(_target,key)=>key === "__esModule" ? false : denied}); return denied; };',
    },
  });
}

export async function serve(port = 4318) {
  const reference = JSON.parse(readFileSync(resolve(cache, 'reference.json'), 'utf8'));
  const cssHash = createHash('sha256')
    .update(readFileSync(resolve(cache, 'app.css')))
    .digest('hex');
  if (cssHash !== reference.cssSha256)
    throw new Error('기본 CSS 캐시가 변경됐습니다. 다시 준비하세요.');
  for (const asset of reference.assets) {
    const hash = createHash('sha256')
      .update(readFileSync(resolve(cache, asset.path)))
      .digest('hex');
    if (hash !== asset.sha256) throw new Error('기본 자산 캐시가 변경됐습니다. 다시 준비하세요.');
  }
  await buildPreview();
  const server = createServer((request, response) => {
    // URL 정규화 전에 검사하여 경로 탈출 요청을 거부합니다.
    const path = request.url.split('?')[0];
    const file = resolvePreviewFile(path);
    if (!file || request.method !== 'GET') {
      response.writeHead(404).end();
      return;
    }
    try {
      const ext = file.split('.').pop();
      response.setHeader(
        'Content-Type',
        {
          html: 'text/html; charset=utf-8',
          css: 'text/css',
          js: 'text/javascript',
          json: 'application/json',
          svg: 'image/svg+xml',
          woff2: 'font/woff2',
          ttf: 'font/ttf',
        }[ext] ?? 'application/octet-stream',
      );
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      );
      response.end(readFileSync(file));
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((done, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', done);
  });
  console.log(`검수: http://127.0.0.1:${server.address().port}/ (Obsidian ${reference.version})`);
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const command = process.argv[2] ?? 'serve';
    if (command === 'prepare') prepare();
    else if (command === 'build') await buildPreview();
    else if (command === 'serve') await serve();
    else throw new Error('사용법: node scripts/obsidian-preview.mjs prepare|build|serve');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
