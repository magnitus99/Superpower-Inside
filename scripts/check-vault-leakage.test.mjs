import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import {
  committedPublicReferences,
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
    expect(isScannableFile('.local/plugin/main.js')).toBe(false);
    expect(isScannableFile('.local/cache/search-eval/result.json')).toBe(false);
    expect(isScannableFile('.local/generated/rag-wasm/rag_wasm.js')).toBe(false);
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
    ].map((path) => resolve(path)));
    expect(selectVaultDirectory(candidates, (path) => path === resolve('/main-repo/.test-vault'))).toBe(
      resolve('/main-repo/.test-vault'),
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

  it('이미 커밋된 공개 고지의 파일명·공통 구절은 유출로 보지 않는다', () => {
    const publicText = '이 문장은 독립적으로 만든 공개 고지 기준선의 합성 문장입니다.';
    expect(findVaultLeakage({
      files: {
        'scripts/release.mjs': "copy('THIRD_PARTY_NOTICES.md');",
        'THIRD_PARTY_NOTICES.md': publicText,
      },
      vaultText: publicText,
      vaultDocumentNames: extractDocumentNames(['THIRD_PARTY_NOTICES.md']),
      publicReferences: { 'THIRD_PARTY_NOTICES.md': publicText },
    })).toEqual([]);
  });

  it('공개 고지와 이름이 같은 문서에서도 새 비공개 구절은 계속 탐지한다', () => {
    const privateText = '공개 기준선에는 존재하지 않는 독립 합성 비공개 문장을 추가합니다.';
    const publicText = '독립 합성 공개 고지 기준선에만 포함된 문장입니다.';
    expect(findVaultLeakage({
      files: { 'THIRD_PARTY_NOTICES.md': `${publicText}\n${privateText}` },
      vaultText: `${publicText}\n${privateText}`,
      vaultDocumentNames: extractDocumentNames(['THIRD_PARTY_NOTICES.md']),
      publicReferences: { 'THIRD_PARTY_NOTICES.md': publicText },
    })).toEqual([{ file: 'THIRD_PARTY_NOTICES.md', line: 2, kind: 'phrase' }]);
  });

  it('공개 기준선은 고정 등록된 커밋 파일만 읽고 부재 시 예외를 만들지 않는다', () => {
    const paths = [];
    const references = committedPublicReferences((file) => {
      paths.push(file);
      return '독립 합성 커밋 고지';
    });
    expect(paths).toEqual(['THIRD_PARTY_NOTICES.md']);
    expect(references).toEqual({ 'THIRD_PARTY_NOTICES.md': '독립 합성 커밋 고지' });
    expect(committedPublicReferences(() => { throw new Error('no baseline'); })).toEqual({});
  });

  it('공개 기준선이 없거나 다른 이름의 문서면 기존 이름 탐지를 유지한다', () => {
    const files = { 'scripts/release.mjs': "copy('THIRD_PARTY_NOTICES.md');" };
    expect(findVaultLeakage({
      files, vaultText: '',
      vaultDocumentNames: extractDocumentNames(['THIRD_PARTY_NOTICES.md']),
      publicReferences: {},
    })).toEqual([{ file: 'scripts/release.mjs', line: 1, kind: 'document-name' }]);
    expect(findVaultLeakage({
      files: { 'src/private.ts': "open('PrivateNoticesDocument.md');" }, vaultText: '',
      vaultDocumentNames: extractDocumentNames(['PrivateNoticesDocument.md']),
      publicReferences: { 'THIRD_PARTY_NOTICES.md': '합성 공개 고지' },
    })).toEqual([{ file: 'src/private.ts', line: 1, kind: 'document-name' }]);
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
