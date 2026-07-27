import { TFile, type App } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import { expandReferencedVaultFiles, extractVaultLinks } from './context-expansion';

vi.mock('obsidian', () => {
  class MockTFile {
    path = '';
    name = '';
    basename = '';
    extension = '';
    stat = { ctime: 0, mtime: 0, size: 0 };
  }
  return { TFile: MockTFile };
});

describe('extractVaultLinks', () => {
  it('wikilink, embed wikilink, vault 내부 Markdown 링크를 추출한다', () => {
    expect(
      extractVaultLinks(
        [
          '[[제품 개념 정리]]',
          '![[Monithub의 가치.md#핵심]]',
          '[기획](../제품 개념 정리.md)',
          '[외부](https://example.com)',
        ].join('\n'),
      ),
    ).toEqual(['제품 개념 정리', 'Monithub의 가치.md', '../제품 개념 정리.md']);
  });
});

describe('expandReferencedVaultFiles', () => {
  it('현재 파일 폴더를 기준으로 파일명 wikilink를 resolve한다', async () => {
    const source = createFile(
      '제품문서/고객 입장에서의 제품/데모 및 제품 기획.md',
      '참고: [[제품 개념 정리]]',
    );
    const reference = createFile('제품문서/고객 입장에서의 제품/제품 개념 정리.md', '참조 내용');
    const app = createApp([source, reference]);

    const result = await expandReferencedVaultFiles(source, source.content, app);

    expect(result.references).toEqual([
      expect.objectContaining({
        file: reference,
        requestedPath: '제품 개념 정리',
        content: '참조 내용',
      }),
    ]);
    expect(result.warnings).toEqual([]);
  });

  it('전체 경로 wikilink를 resolve한다', async () => {
    const source = createFile('제품문서/고객 입장에서의 제품/데모 및 제품 기획.md', '[[Monithub의 가치]]');
    const reference = createFile('제품문서/Monithub의 가치.md', '가치 내용');
    const app = createApp([source, reference]);

    const result = await expandReferencedVaultFiles(source, source.content, app);

    expect(result.references[0]?.file.path).toBe('제품문서/Monithub의 가치.md');
  });

  it('상대 경로 Markdown 링크를 Rust path candidate plan으로 resolve한다', async () => {
    const source = createFile(
      '제품문서/고객 입장에서의 제품/데모 및 제품 기획.md',
      '[기획](../제품 개념 정리.md)',
    );
    const reference = createFile('제품문서/제품 개념 정리.md', '상위 폴더 참조');
    const app = createApp([source, reference]);

    const result = await expandReferencedVaultFiles(source, source.content, app);

    expect(result.references[0]?.file.path).toBe('제품문서/제품 개념 정리.md');
    expect(result.references[0]?.content).toBe('상위 폴더 참조');
  });

  it('metadata/path 후보가 실패하면 Rust basename fallback index로 resolve한다', async () => {
    const source = createFile('제품문서/데모.md', '[[Romans]]');
    const reference = createFile('Archive/Romans.md', 'fallback 참조');
    const app = createApp([source, reference]);

    const result = await expandReferencedVaultFiles(source, source.content, app);

    expect(result.references[0]?.file).toBe(reference);
    expect(result.references[0]?.content).toBe('fallback 참조');
  });

  it('깨진 링크는 warning으로 남긴다', async () => {
    const source = createFile('제품문서/데모 및 제품 기획.md', '[[없는 문서]]');
    const app = createApp([source]);

    const result = await expandReferencedVaultFiles(source, source.content, app);

    expect(result.references).toEqual([]);
    expect(result.warnings).toEqual(['참조 문서를 찾을 수 없습니다: 없는 문서']);
  });

  it('자기 자신과 중복 참조는 Rust selection plan으로 제외한다', async () => {
    const source = createFile(
      '제품문서/데모 및 제품 기획.md',
      ['[[데모 및 제품 기획]]', '[[제품 개념 정리]]', '[[제품 개념 정리]]'].join('\n'),
    );
    const reference = createFile('제품문서/제품 개념 정리.md', '참조 내용');
    const app = createApp([source, reference]);

    const result = await expandReferencedVaultFiles(source, source.content, app);

    expect(result.references).toEqual([
      expect.objectContaining({
        file: reference,
        requestedPath: '제품 개념 정리',
        content: '참조 내용',
      }),
    ]);
    expect(result.warnings).toEqual([]);
  });
});

function createFile(path: string, content: string): TFile & { content: string } {
  return Object.assign(Object.create(TFile.prototype), {
    path,
    name: path.split('/').pop() ?? path,
    basename: path.split('/').pop()?.replace(/\.md$/, '') ?? path,
    extension: 'md',
    content,
    stat: {
      ctime: 1000,
      mtime: 1000,
      size: content.length,
    },
  }) as TFile & { content: string };
}

function createApp(files: (TFile & { content: string })[]): App {
  const byPath = new Map(files.map((file) => [file.path, file]));
  return {
    vault: {
      getAbstractFileByPath: (path: string) => byPath.get(path) ?? null,
      cachedRead: (file: TFile & { content: string }) => Promise.resolve(file.content),
      getMarkdownFiles: () => files,
    },
    metadataCache: {
      getFirstLinkpathDest: (linkpath: string, sourcePath: string) => {
        const sourceFolder = sourcePath.split('/').slice(0, -1).join('/');
        const candidates = [
          linkpath,
          linkpath.endsWith('.md') ? linkpath : `${linkpath}.md`,
          sourceFolder ? `${sourceFolder}/${linkpath}` : linkpath,
          sourceFolder && !linkpath.endsWith('.md') ? `${sourceFolder}/${linkpath}.md` : '',
        ].filter(Boolean);
        for (const candidate of candidates) {
          const file = byPath.get(candidate);
          if (file) return file;
        }
        return null;
      },
    },
  } as unknown as App;
}
