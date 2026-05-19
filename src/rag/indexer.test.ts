import { describe, expect, it } from 'vitest';
import { chunkMarkdown, buildSearchText } from './indexer';
import type { TFile } from 'obsidian';

describe('chunkMarkdown + buildSearchText Ollama context length scenario', () => {
  it('chunkSize 1000으로 큰 파일을 청킹하면 buildSearchText 결과가 Ollama 안전 문자수(3000자)를 초과할 수 있다', () => {
    // 여러 줄로 구성된 큰 콘텐츠 (줄바꿈이 있어야 chunkMarkdown이 분할한다)
    const lines: string[] = [];
    for (let i = 0; i < 100; i++) {
      lines.push('word '.repeat(15).trim());
    }
    const content = lines.join('\n');
    const chunks = chunkMarkdown(content, 1000);

    const mockFile = {
      path: 'test.md',
      basename: 'test',
      stat: { mtime: 0, size: 0 },
    } as unknown as TFile;

    const searchTexts = chunks.map((chunk) => buildSearchText(mockFile, chunk));
    const maxLen = Math.max(...searchTexts.map((s) => s.length));

    // buildSearchText는 File/Title/Heading 메타데이터를 추가하므로
    // chunkSize 1000이어도 실제 임베딩 입력은 1000자를 초과할 수 있음
    expect(maxLen).toBeGreaterThan(1000);

    // Ollama nomic-embed-text-v2-moe의 컨텍스트 상한은 약 2048 tokens.
    // 한국어 혼합 텍스트 기준 안전 문자수는 약 3000자이므로,
    // chunkSize 1000 + 메타데이터 오버헤드 조합이 이 상한을 초과할 가능성을 문서화한다.
    // (이 테스트는 chunkSize를 낮춰야 하는 근거를 제공한다.)
  });

  it('chunkSize를 500으로 낮추면 buildSearchText 결과가 3000자 이하로 제한된다', () => {
    const lines: string[] = [];
    for (let i = 0; i < 100; i++) {
      lines.push('word '.repeat(15).trim());
    }
    const content = lines.join('\n');
    const chunks = chunkMarkdown(content, 500);

    const mockFile = {
      path: 'test.md',
      basename: 'test',
      stat: { mtime: 0, size: 0 },
    } as unknown as TFile;

    const searchTexts = chunks.map((chunk) => buildSearchText(mockFile, chunk));
    const maxLen = Math.max(...searchTexts.map((s) => s.length));

    // chunkSize 500 + 메타데이터 오버헤드(최대 ~200자)면 3000자 상한 내에 안전하다
    expect(maxLen).toBeLessThanOrEqual(3000);
  });
});
