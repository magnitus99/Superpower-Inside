import { describe, expect, it } from 'vitest';
import {
  extractDocumentNames,
  extractPhraseCandidates,
  findVaultLeakage,
  isScannableFile,
  normalizeVaultText,
  selectVaultDirectory,
  vaultCandidates,
} from './check-vault-leakage.mjs';

const vaultText = normalizeVaultText(
  ['합성 보관 기록 문서입니다.', '두 번째 단락은 다른 문장으로 채웁니다.', 'Synthetic archive note body.'].join(
    '\n',
  ),
);
const vaultDocumentNames = extractDocumentNames(['records/SyntheticArchiveNote.md', 'notes/보관기록문서모음.md']);

describe('check-vault-leakage', () => {
  it('스캔 대상과 제외 대상을 구분한다', () => {
    expect(isScannableFile('src/rag/query.ts')).toBe(true);
    expect(isScannableFile('crates/rag-wasm/src/lib.rs')).toBe(true);
    expect(isScannableFile('main.js')).toBe(false);
    expect(isScannableFile('generated/rag-wasm/rag_wasm.js')).toBe(false);
    expect(isScannableFile('simulations/obsidian-preview/main.js')).toBe(false);
  });

  it('작업 트리와 원본 저장소의 볼트 후보를 찾고 존재하는 경로만 고른다', () => {
    const candidates = vaultCandidates({
      cwd: '/worktree',
      environment: { SUPERPOWER_VAULT_DIR: 'local-vault' },
      mainWorktree: '/main-repo',
    });
    expect(candidates).toEqual([
      '/worktree/local-vault',
      '/worktree/.test-vault',
      '/main-repo/.test-vault',
    ]);
    expect(selectVaultDirectory(candidates, (path) => path === '/main-repo/.test-vault')).toBe(
      '/main-repo/.test-vault',
    );
    expect(selectVaultDirectory(candidates, () => false)).toBeNull();
  });

  it('긴 한글 구절만 후보로 뽑는다', () => {
    const candidates = extractPhraseCandidates('짧음\n테스트 문장 하나를 여기에 두고 길이를 충분히 늘려서 검사합니다');
    expect(candidates.map((candidate) => candidate.line)).toEqual([2]);
  });

  it('한글 문서명은 그대로, 라틴 문서명은 확장자까지 찾는다', () => {
    expect(vaultDocumentNames).toContain('보관기록문서모음');
    expect(vaultDocumentNames).toContain('SyntheticArchiveNote.md');
    expect(extractDocumentNames(['archive/Short.md'])).toEqual([]);
  });

  it('볼트 구절이 코드에 들어가면 위반으로 보고한다', () => {
    const leakage = findVaultLeakage({
      files: { 'src/fixture.test.ts': "const question = '두 번째 단락은 다른 문장으로 채웁니다.';" },
      vaultText,
      vaultDocumentNames: [],
    });
    expect(leakage).toEqual([{ file: 'src/fixture.test.ts', line: 1, kind: 'phrase' }]);
  });

  it('문서명이 경로로 등장하면 위반으로 보고한다', () => {
    const leakage = findVaultLeakage({
      files: { 'src/path.test.ts': "createFile('records/SyntheticArchiveNote.md', 'body');" },
      vaultText,
      vaultDocumentNames,
    });
    expect(leakage).toEqual([{ file: 'src/path.test.ts', line: 1, kind: 'document-name' }]);
  });

  it('문서명 일부가 긴 식별자에 붙어 있으면 위반이 아니다', () => {
    const leakage = findVaultLeakage({
      files: { 'src/name.test.ts': "path.join('tests/fixtures/mcp_SyntheticArchiveNote.md');" },
      vaultText,
      vaultDocumentNames,
    });
    expect(leakage).toEqual([]);
  });

  it('제품 문구에 있는 구절은 위반이 아니다', () => {
    const leakage = findVaultLeakage({
      files: { 'src/copy.test.ts': "const notice = '두 번째 단락은 다른 문장으로 채웁니다.';" },
      vaultText,
      vaultDocumentNames: [],
      productText: '두 번째 단락은 다른 문장으로 채웁니다.',
    });
    expect(leakage).toEqual([]);
  });

  it('합성 데이터만 있으면 통과한다', () => {
    const leakage = findVaultLeakage({
      files: { 'src/clean.test.ts': "const value = 'unrelated synthetic sentence about valves';" },
      vaultText,
      vaultDocumentNames,
    });
    expect(leakage).toEqual([]);
  });
});
