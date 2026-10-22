#!/usr/bin/env node
/**
 * 로컬 테스트 볼트의 원문·문서명이 커밋 대상 파일에 섞였는지 검사합니다.
 *
 * 볼트는 Git에서 제외된 로컬 검증 데이터이므로, 이 검사는 볼트가 있는 환경에서만 실행하고
 * 볼트 내용을 출력하지 않습니다. 위반이 있으면 파일 위치와 종류만 알려 줍니다.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const defaultVaultDirectory = '.test-vault';
const scanExtensions = ['.ts', '.rs', '.mjs', '.js', '.json', '.md', '.css', '.yml', '.fish'];
const skippedPrefixes = [
  '.agents/',
  '.test-vault/',
  'generated/',
  'node_modules/',
  'simulations/',
];
const skippedFiles = new Set(['main.js', 'src/rag/rag-wasm-bytes.ts']);
const textDocumentExtensions = ['.md', '.txt'];
const MIN_PHRASE_LENGTH = 20;
const MIN_DOCUMENT_NAME_LENGTH = 8;

/**
 * 검사 대상에서 제외할 파일인지 판정합니다.
 * @param {string} file 저장소 기준 상대 경로
 * @returns {boolean} 제외 여부
 */
export function isScannableFile(file) {
  if (skippedFiles.has(file)) return false;
  if (skippedPrefixes.some((prefix) => file.startsWith(prefix))) return false;
  return scanExtensions.some((extension) => file.endsWith(extension));
}

/**
 * 검사 대상 텍스트에서 비교할 구절 후보를 추출합니다.
 * @param {string} text 파일 본문
 * @returns {Array<{ line: number, value: string }>} 줄 번호와 구절
 */
export function extractPhraseCandidates(text) {
  const candidates = [];
  const pattern = /[\uac00-\ud7a3][^\n]*/g;
  let match = pattern.exec(text);
  while (match !== null) {
    const line = text.slice(0, match.index).split('\n').length;
    for (const segment of match[0].split(/[^\p{L}\p{N}\s]+/u)) {
      const value = segment.trim();
      if (value.length >= MIN_PHRASE_LENGTH) candidates.push({ line, value });
    }
    match = pattern.exec(text);
  }
  return candidates;
}

/**
 * 볼트 문서명 후보를 뽑습니다. 코드에 우연히 등장하는 일반 단어를 피하려고
 * 한글 이름은 그대로, 라틴 문자 이름은 확장자나 경로 형태로만 찾습니다.
 * @param {string[]} paths 볼트 문서 경로(확장자 포함)
 * @returns {string[]} 검색할 문서 표식
 */
export function extractDocumentNames(paths) {
  const probes = new Set();
  for (const path of paths) {
    const base = path.split('/').pop() ?? '';
    const extension = /\.[^.]+$/.exec(base)?.[0] ?? '';
    const name = base.slice(0, base.length - extension.length);
    if (name.length < MIN_DOCUMENT_NAME_LENGTH || /\s/.test(name)) continue;
    if (/[^\u0000-\u007f]/.test(name)) {
      probes.add(name);
      continue;
    }
    if (extension) probes.add(`${name}${extension}`);
  }
  return [...probes];
}

/**
 * 볼트 텍스트를 검색 가능한 형태로 정규화합니다.
 * @param {string} text 볼트 본문
 * @returns {string} 공백이 접힌 본문
 */
export function normalizeVaultText(text) {
  return text.replace(/\s+/g, ' ');
}

/**
 * 파일 목록과 볼트 자료를 비교해 위반 목록을 만듭니다.
 * @param {object} input 검사 입력
 * @param {Record<string, string>} input.files 경로별 파일 본문
 * @param {string} input.vaultText 볼트 문서 본문
 * @param {string[]} input.vaultDocumentNames 볼트 문서명
 * @param {string} [input.productText] 제품 문구 코퍼스(사용자에게 보여 주는 정본 문장)
 * @returns {Array<{ file: string, line: number, kind: string }>} 위반 목록
 */
export function findVaultLeakage({ files, vaultText, vaultDocumentNames, productText = '' }) {
  const normalizedVault = normalizeVaultText(vaultText);
  const normalizedProduct = normalizeVaultText(productText);
  const leakage = [];
  for (const [file, text] of Object.entries(files)) {
    for (const candidate of extractPhraseCandidates(text)) {
      if (normalizedProduct.includes(candidate.value)) continue;
      if (normalizedVault.includes(candidate.value)) {
        leakage.push({ file, line: candidate.line, kind: 'phrase' });
      }
    }
    for (const name of vaultDocumentNames) {
      const boundary = new RegExp(`(^|[^\\w-])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
      const match = boundary.exec(text);
      if (match) {
        const line = text.slice(0, match.index).split('\n').length;
        leakage.push({ file, line, kind: 'document-name' });
      }
    }
  }
  return leakage;
}

/**
 * 디렉터리 아래 텍스트 문서를 수집합니다.
 * @param {string} directory 절대 경로
 * @returns {string[]} 파일 절대 경로
 */
function collectTextDocuments(directory) {
  if (!existsSync(directory)) return [];
  const collected = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      collected.push(...collectTextDocuments(path));
      continue;
    }
    if (textDocumentExtensions.some((extension) => entry.name.endsWith(extension))) {
      collected.push(path);
    }
  }
  return collected;
}

/**
 * 저장소의 추적 파일 본문을 읽습니다.
 * @returns {Record<string, string>} 경로별 본문
 */
function readTrackedFiles() {
  const tracked = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: projectRoot,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean);
  const files = {};
  for (const file of tracked) {
    if (!isScannableFile(file)) continue;
    const path = join(projectRoot, file);
    if (!existsSync(path) || !statSync(path).isFile()) continue;
    files[file] = readFileSync(path, 'utf8');
  }
  return files;
}

function main() {
  const vaultDirectory = resolve(projectRoot, process.env.SUPERPOWER_VAULT_DIR || defaultVaultDirectory);
  if (!existsSync(vaultDirectory)) {
    console.log('vault-leak check skipped: no local test vault');
    return;
  }
  const documents = collectTextDocuments(vaultDirectory);
  const vaultText = documents.map((path) => readFileSync(path, 'utf8')).join('\n');
  const vaultDocumentNames = extractDocumentNames(
    documents.map((path) => relative(vaultDirectory, path).split('\\').join('/')),
  );
  const files = readTrackedFiles();
  const productText = (files['src/i18n.ts'] ?? '').replace(/\\n/g, '\n');
  const leakage = findVaultLeakage({ files, vaultText, vaultDocumentNames, productText });
  if (leakage.length === 0) {
    console.log(`vault-leak check passed: ${documents.length} local documents`);
    return;
  }
  for (const item of leakage) {
    const location = item.line > 0 ? `${item.file}:${item.line}` : item.file;
    console.log(`vault-leak ${item.kind}: ${location}`);
  }
  process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
