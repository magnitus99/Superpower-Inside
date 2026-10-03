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
    cache: [],
    evidence: [],
    failedEmbeddingPaths: [],
    failedGraphPaths: [],
    config: {
      bm25Enabled: true,
      embeddingEnabled: false,
      graphEnabled: false,
      embeddingProvider: '',
      embeddingModel: '',
      graphModel: '',
      ontologySchemaId: 'knowledge-graph',
      ontologyVersion: 1,
      extractionContractVersion: 2,
    },
    limit: 32,
  };
}

describe('파일 기준 공통 처리 상태', () => {
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
  it('청크 캐시가 남아 있어도 이전 원문 revision의 그래프 근거를 준비 완료로 표시하지 않는다', () => {
    const snapshot = input();
    snapshot.config.graphEnabled = true;
    snapshot.config.graphModel = 'graph-model';
    snapshot.cache = [
      {
        entryId: 'a.ts::chunk::a::0',
        contentHash: 'chunk',
        extractionModelKey: 'graph-model',
        ontologySchemaId: 'knowledge-graph',
        ontologyVersion: 1,
        extractionContractVersion: 2,
        updatedAt: 1,
      },
    ];
    snapshot.evidence = [
      { entryId: 'a.ts::chunk::a::0', filePath: 'a.ts', contentHash: 'old-file' },
    ];
    expect(planSourceProcessingRust(snapshot)?.files[0]).toMatchObject({
      graph: 'stale',
      chat: 'ready',
    });
    const evidence = snapshot.evidence[0];
    if (evidence) evidence.contentHash = 'file';
    expect(planSourceProcessingRust(snapshot)?.files[0]?.graph).toBe('ready');
  });
  it('그래프와 임베딩을 끄면 본문·BM25만으로 채팅 준비와 완료 상태가 된다', () => {
    expect(planSourceProcessingRust(input())).toMatchObject({
      totalFiles: 1,
      chatReadyFiles: 1,
      completeFiles: 1,
      files: [
        {
          filePath: 'a.ts',
          source: 'ready',
          bm25: 'ready',
          embedding: 'disabled',
          graph: 'disabled',
          chat: 'ready',
        },
      ],
    });
  });

  it('그래프 미처리와 임베딩 실패가 현재 본문의 채팅 준비를 막지 않는다', () => {
    const snapshot = input();
    snapshot.config.embeddingEnabled = true;
    snapshot.config.graphEnabled = true;
    snapshot.failedEmbeddingPaths = ['a.ts'];
    expect(planSourceProcessingRust(snapshot)).toMatchObject({
      chatReadyFiles: 1,
      completeFiles: 0,
      files: [{ source: 'ready', embedding: 'failed', graph: 'pending', chat: 'ready' }],
    });
  });

  it('원문 revision이 바뀌면 이전 BM25·벡터·그래프를 준비 완료로 표시하지 않는다', () => {
    const snapshot = input();
    const file = snapshot.files[0];
    if (file) file.sourceMtime = 11;
    expect(planSourceProcessingRust(snapshot)).toMatchObject({
      chatReadyFiles: 0,
      completeFiles: 0,
      files: [{ source: 'stale', bm25: 'stale', chat: 'pending' }],
    });
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
