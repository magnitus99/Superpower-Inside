import { describe, expect, it } from 'vitest';
import { planSourceProcessingRust, type SourceProcessingInput } from './source-processing';

function input(): SourceProcessingInput {
  return {
    files: [
      { filePath: 'a.ts', sourceMtime: 10, sourceSize: 100, readFailed: false, readPending: false },
    ],
    documents: [
      {
        id: 'a.ts::chunk::a::0',
        sourcePath: 'a.ts',
        sourceMtime: 10,
        sourceSize: 100,
        contentHash: 'file',
        chunkHash: 'chunk',
      },
    ],
    bm25: [
      {
        id: 'a.ts::chunk::a::0',
        sourcePath: 'a.ts',
        sourceMtime: 10,
        sourceSize: 100,
        contentHash: 'file',
      },
    ],
    vectors: [],
    failedEmbeddingPaths: [],
    config: {
      bm25Enabled: true,
      embeddingEnabled: false,
      embeddingProvider: '',
      embeddingModel: '',
    },
    limit: 32,
  };
}

describe('파일 기준 공통 처리 상태', () => {
  it('본문과 BM25가 준비되면 임베딩 없이도 처리가 완료된다', () => {
    expect(planSourceProcessingRust(input())).toEqual({
      totalFiles: 1,
      chatReadyFiles: 1,
      completeFiles: 1,
      truncated: false,
      files: [
        { filePath: 'a.ts', source: 'ready', bm25: 'ready', embedding: 'disabled', chat: 'ready' },
      ],
    });
  });

  it('임베딩 실패는 현재 본문을 이용한 채팅을 막지 않는다', () => {
    const snapshot = input();
    snapshot.config.embeddingEnabled = true;
    snapshot.failedEmbeddingPaths = ['a.ts'];
    expect(planSourceProcessingRust(snapshot)).toMatchObject({
      chatReadyFiles: 1,
      completeFiles: 0,
      files: [{ source: 'ready', embedding: 'failed', chat: 'ready' }],
    });
  });

  it('원문 revision이 바뀌면 이전 본문과 BM25를 준비 완료로 표시하지 않는다', () => {
    const snapshot = input();
    const file = snapshot.files[0];
    if (file) file.sourceMtime = 11;
    expect(planSourceProcessingRust(snapshot)).toMatchObject({
      chatReadyFiles: 0,
      completeFiles: 0,
      files: [{ source: 'stale', bm25: 'stale', chat: 'pending' }],
    });
  });

  it('임베딩도 현재 revision·프로바이더·모델·청크 수가 모두 같을 때만 준비 완료다', () => {
    const snapshot = input();
    snapshot.config.embeddingEnabled = true;
    snapshot.config.embeddingProvider = 'openai';
    snapshot.config.embeddingModel = 'embedding-model';
    snapshot.vectors = [
      {
        filePath: 'a.ts',
        sourceMtime: 10,
        sourceSize: 100,
        contentHash: 'file',
        embeddingProvider: 'openai',
        embeddingModel: 'embedding-model',
        vectorCount: 1,
        updated: 1,
      },
    ];
    expect(planSourceProcessingRust(snapshot)?.files[0]?.embedding).toBe('ready');
    const record = snapshot.vectors[0];
    if (record) record.embeddingModel = 'old-model';
    expect(planSourceProcessingRust(snapshot)?.files[0]?.embedding).toBe('pending');
    if (record) {
      record.embeddingModel = 'embedding-model';
      record.vectorCount = 0;
    }
    expect(planSourceProcessingRust(snapshot)?.files[0]?.embedding).toBe('pending');
  });

  it('파일 읽기 실패와 진행 중 상태를 구분하고 전체 집계는 결과 한도와 독립적이다', () => {
    const snapshot = input();
    const file = snapshot.files[0];
    if (file) file.readFailed = true;
    expect(planSourceProcessingRust(snapshot)?.files[0]?.source).toBe('failed');
    if (file) {
      file.readFailed = false;
      file.readPending = true;
    }
    expect(planSourceProcessingRust(snapshot)?.files[0]?.source).toBe('pending');
    snapshot.limit = 0;
    expect(planSourceProcessingRust(snapshot)).toMatchObject({
      totalFiles: 1,
      files: [],
      truncated: true,
    });
  });
});
