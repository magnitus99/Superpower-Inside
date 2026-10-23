import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import type { DataAdapter } from 'obsidian';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IndexedDbBM25Index, getBM25DocumentFields, tokenize, type BM25DocumentInput } from './bm25';
import type {
  BM25WorkerAdapter,
  BM25WorkerFactory,
  BM25WorkerHandle,
  BM25WorkerRequest,
  BM25WorkerResponse,
} from './bm25-worker-runtime';
import { RustBm25RuntimeIndex } from './rust-core';
import { TOKENIZER_VERSION } from './tokenizer-version';

const dbNames = new Set<string>();

afterEach(async () => {
  await Promise.all([...dbNames].map((name) => Dexie.delete(name)));
  dbNames.clear();
});

describe('BM25 문서 필드', () => {
  it('frontmatter 별칭을 문자열과 배열 모두 별칭 필드로 넘긴다', () => {
    const file = { path: 'notes/b-007.md', basename: 'b-007' } as Parameters<
      typeof getBM25DocumentFields
    >[0];

    expect(
      getBM25DocumentFields(file, { frontmatter: { aliases: '시편 51장' } }, '본문'),
    ).toMatchObject({ aliases: ['시편 51장'] });
    expect(
      getBM25DocumentFields(
        file,
        { frontmatter: { aliases: ['시편 51', 51] } },
        '본문',
      ),
    ).toMatchObject({ aliases: ['시편 51', '51'] });
    expect(getBM25DocumentFields(file, null, '본문')).toMatchObject({ aliases: [] });
  });
});

describe('BM25 tokenizer', () => {
  it('영문 camelCase와 구분자 변형을 같은 키워드로 검색할 수 있게 토큰화한다', () => {
    const tokens = tokenize('OpenRouter freeLLMApi open-router');

    expect(tokens).toEqual(
      expect.arrayContaining(['openrouter', 'open', 'router', 'freellmapi', 'free', 'llm', 'api']),
    );
  });

  it('한글과 숫자가 섞인 Obsidian 제목 키워드는 원문과 n-gram을 함께 보존한다', () => {
    const tokens = tokenize('요고49 포인트 페이백');

    expect(tokens).toEqual(
      expect.arrayContaining(['요고49', '요고', '49', '포인트', '포인', '인트', '페이백']),
    );
  });

  it('macOS 한글 입력의 분해형(NFD)도 조합형(NFC)과 같은 토큰을 만든다', () => {
    const composed = '오린 퀼런의 기록';
    const decomposed = composed.normalize('NFD');

    expect(decomposed).not.toBe(composed);
    expect(tokenize(decomposed)).toEqual(tokenize(composed));
  });

  it('조합형 문서 색인을 분해형 질의로도 찾는다', () => {
    const index = RustBm25RuntimeIndex.empty(TOKENIZER_VERSION);
    if (!index) throw new Error("BM25 런타임을 만들지 못했습니다.");
    index.addDocument("a.md::0", "오린 퀼런의 기록은 오래 남는다", "a.md", TOKENIZER_VERSION);

    const hits = index.searchTop("오린 퀼런의 기록".normalize("NFD"), 1);

    expect(hits?.length ?? 0).toBe(1);
  });
});

describe('IndexedDbBM25Index', () => {
  it('위치 없는 snapshot과 저장 원문이 있으면 비 worker 시작도 원문에서 자동 복구한다', async () => {
    const dbName = createDbName();
    const index = new IndexedDbBM25Index(dbName);
    await index.load();
    index.addCorpusDocument({
      id: 'raw',
      text: 'alpha beta',
      sourcePath: 'ledger.md',
      title: 'Quarterly',
    });
    await index.persist();
    index.close();
    const legacy = {
      tokenizerVersion: 2,
      inverted: { wrong: { stale: 1 } },
      docLengths: { stale: 1 },
      docSources: { stale: 'stale.md' },
      totalDocs: 1,
      avgDocLength: 1,
    };
    const db = new Dexie(dbName);
    await db.open();
    await db
      .table('meta')
      .put({ key: 'bm25-runtime-snapshot:v1', value: JSON.stringify(legacy), updated: Date.now() });
    db.close();
    const restored = new IndexedDbBM25Index(dbName);
    try {
      await restored.load();
      expect(restored.isTokenizerCurrent).toBe(true);
      expect([...restored.search('wrong').keys()]).toEqual([]);
      expect([...restored.search('"alpha beta"').keys()]).toEqual(['raw']);
      expect([...restored.search('title:quarterly').keys()]).toEqual(['raw']);
      expect([...restored.search('path:ledger').keys()]).toEqual(['raw']);
    } finally {
      restored.close();
    }
  });
  it('필드는 저장·재시작 후에도 유지하고 경로 필드는 항상 원본 경로를 사용한다', async () => {
    const dbName = createDbName();
    const index = new IndexedDbBM25Index(dbName);
    await index.load();
    const document = {
      id: 'fielded',
      text: 'alpha beta gamma',
      sourcePath: 'reports/ledger.md',
      title: 'Quarterly Ledger',
      headings: ['Deployment Guide'],
      tags: ['finance'],
    };
    index.addCorpusDocument(document);
    await index.persist();
    expect(await index.getCorpusDocumentsByIds(['fielded'])).toEqual([
      expect.objectContaining(document),
    ]);
    index.close();
    const restored = new IndexedDbBM25Index(dbName);
    try {
      await restored.load();
      expect(await restored.getCorpusDocumentsByIds(['fielded'])).toEqual([
        expect.objectContaining(document),
      ]);
      for (const query of [
        'title:quarterly',
        'heading:deployment',
        'tag:finance',
        'path:ledger',
        '"alpha beta"',
        '"alpha gamma"~1',
        'alph*',
        'alphx',
      ]) {
        expect([...restored.search(query).keys()], query).toEqual(['fielded']);
      }
    } finally {
      restored.close();
    }
  });
  it('sourcePath가 없는 문서는 런타임 path 필드로 id를 사용한다', async () => {
    const bm25 = new IndexedDbBM25Index(createDbName(), createAdapter());
    await bm25.load();
    try {
      bm25.addDocument('standalone::0', 'alpha 베타');

      expect([...bm25.search('path:standalone').keys()]).toEqual(['standalone::0']);
      expect([...bm25.search('alpha').keys()]).toEqual(['standalone::0']);
    } finally {
      bm25.close();
    }
  });
  it('일치 집계는 정확 term·구문만 세고 오타·prefix 확장으로 수치를 부풀리지 않는다', async () => {
    const bm25 = new IndexedDbBM25Index(createDbName(), createAdapter());
    await bm25.load();
    try {
      bm25.addDocument('alpha.md::0', 'alpha beta alpha synthetic', 'alpha.md');
      bm25.addDocument('beta.md::0', 'alpha alpha alpha', 'beta.md');

      expect(await bm25.aggregateMatches('alpha', 10)).toEqual({
        totalDocuments: 2,
        totalChunks: 2,
        totalOccurrences: 5,
        documents: [
          {
            sourcePath: 'beta.md',
            occurrences: 3,
            chunks: [{ docId: 'beta.md::0', occurrences: 3 }],
          },
          {
            sourcePath: 'alpha.md',
            occurrences: 2,
            chunks: [{ docId: 'alpha.md::0', occurrences: 2 }],
          },
        ],
      });
      expect((await bm25.aggregateMatches('"alpha beta"', 10))?.totalOccurrences).toBe(1);
      expect((await bm25.aggregateMatches('alphx', 10))?.totalOccurrences).toBe(0);
      expect((await bm25.aggregateMatches('alph*', 10))?.totalOccurrences).toBe(0);
    } finally {
      bm25.close();
    }
  });
  it('현행 WASM 런타임에서 문서 교체와 원문별 삭제 후 검색·저장을 보존한다', () => {
    const runtime = RustBm25RuntimeIndex.empty(2);
    if (!runtime) throw new Error('WASM 초기화 실패');
    try {
      runtime.addDocument('api.md::0', 'OpenRouter API access key', 'api.md', 2);
      runtime.addDocument('other.md::0', 'Ollama local model', 'other.md', 2);
      expect(runtime.search('open router')?.map((hit) => hit.docId)).toEqual(['api.md::0']);
      runtime.addDocument('api.md::0', 'Ollama remote endpoint', 'api.md', 2);
      expect(runtime.search('open router')).toEqual([]);
      expect(runtime.search('ollama')?.map((hit) => hit.docId)).toEqual([
        'api.md::0',
        'other.md::0',
      ]);
      runtime.removeSource('api.md', 2);
      expect(runtime.search('endpoint')).toEqual([]);
      expect(runtime.sourcePathForDoc('other.md::0')).toBe('other.md');
      const restored = RustBm25RuntimeIndex.fromJson(runtime.toJson(), 2);
      if (!restored) throw new Error('WASM 복원 실패');
      try {
        expect(restored.search('ollama')?.map((hit) => hit.docId)).toEqual(['other.md::0']);
        restored.removeDocument('other.md::0', 2);
        expect(restored.totalDocs()).toBe(0);
        expect(restored.search('ollama')).toEqual([]);
      } finally {
        restored.dispose();
      }
    } finally {
      runtime.dispose();
    }
  });

  it('반복된 질의 토큰으로 같은 문서 점수를 중복 가산하지 않는다', async () => {
    const bm25 = await createBm25([
      ['doc.md::0', 'specialterm 직접 근거'],
      ['other.md::0', '다른 내용'],
    ]);

    expect(bm25.search('specialterm specialterm').get('doc.md::0')).toBe(
      bm25.search('specialterm').get('doc.md::0'),
    );
  });

  it('OpenRouter 문서는 open router처럼 띄어 쓴 질의로도 검색된다', async () => {
    const bm25 = await createBm25([
      ['api.md::0', 'OpenRouter API access key'],
      ['other.md::0', 'Ollama local model'],
    ]);

    expect([...bm25.search('open router').keys()]).toEqual(['api.md::0']);
  });

  it('구버전 BM25 JSON은 토큰화 버전 불일치로 감지하고 재빌드할 수 있다', async () => {
    const adapter = createAdapter(
      JSON.stringify({
        inverted: { openrouter: { 'api.md::0': 1 } },
        docLengths: { 'api.md::0': 1 },
        docSources: { 'api.md::0': 'api.md' },
        totalDocs: 1,
        avgDocLength: 1,
      }),
    );
    const bm25 = new IndexedDbBM25Index(createDbName(), adapter);

    await bm25.load();

    expect(bm25.isTokenizerCurrent).toBe(false);
    expect([...bm25.search('open router').keys()]).toEqual([]);

    await bm25.rebuild([
      {
        id: 'api.md::0',
        text: 'OpenRouter API access key',
        sourcePath: 'api.md',
      },
    ]);

    expect(bm25.isTokenizerCurrent).toBe(true);
    expect([...bm25.search('open router').keys()]).toEqual(['api.md::0']);
  });

  it('legacy BM25 JSON을 읽은 뒤 저장할 때 IndexedDB snapshot으로 마이그레이션한다', async () => {
    const inspectable = createInspectableAdapter(
      JSON.stringify({
        tokenizerVersion: 2,
        inverted: {
          open: { 'api.md::0': 1 },
          router: { 'api.md::0': 1 },
        },
        docLengths: { 'api.md::0': 2 },
        docSources: { 'api.md::0': 'api.md' },
        totalDocs: 1,
        avgDocLength: 2,
      }),
    );
    const dbName = createDbName();
    const bm25 = new IndexedDbBM25Index(dbName, inspectable.adapter);

    await bm25.load();
    expect([...bm25.search('open router').keys()]).toEqual(['api.md::0']);

    bm25.addDocument('new.md::0', 'Retrieval open router evidence', 'new.md');
    await bm25.persist();

    expect(inspectable.writeCount()).toBe(0);
    const reopened = new IndexedDbBM25Index(dbName, inspectable.adapter);
    await reopened.load();
  });

  it('legacy BM25 JSON은 load 직후 IndexedDB snapshot으로 남겨 다음 초기화에서 다시 읽지 않는다', async () => {
    const inspectable = createInspectableAdapter(
      JSON.stringify({
        tokenizerVersion: 2,
        inverted: {
          open: { 'api.md::0': 1 },
          router: { 'api.md::0': 1 },
        },
        docLengths: { 'api.md::0': 2 },
        docSources: { 'api.md::0': 'api.md' },
        totalDocs: 1,
        avgDocLength: 2,
      }),
    );
    const dbName = createDbName();
    const bm25 = new IndexedDbBM25Index(dbName, inspectable.adapter);

    await bm25.load();
    expect(inspectable.readCount()).toBe(1);

    const reopened = new IndexedDbBM25Index(dbName, inspectable.adapter);
    await reopened.load();

    expect(inspectable.readCount()).toBe(1);
    expect([...reopened.search('open router').keys()]).toEqual(['api.md::0']);
  });

  it('증분 persist는 전체 runtime JSON 직렬화를 호출하지 않고 재시작 후 검색을 유지한다', async () => {
    const dbName = createDbName();
    const bm25 = new IndexedDbBM25Index(dbName, createAdapter());
    await bm25.load();
    const toJsonSpy = vi.spyOn(RustBm25RuntimeIndex.prototype, 'toJson');
    try {
      bm25.addDocument('doc.md::0', 'specialterm 직접 근거', 'doc.md');
      await bm25.persist();

      expect(toJsonSpy).not.toHaveBeenCalled();
    } finally {
      toJsonSpy.mockRestore();
    }

    const reopened = new IndexedDbBM25Index(dbName, createAdapter());
    await reopened.load();
    expect([...reopened.search('specialterm').keys()]).toEqual(['doc.md::0']);
  });

  it('큰 legacy BM25 JSON은 시작 경로에서 읽지 않고 빈 runtime으로 시작한다', async () => {
    const inspectable = createInspectableAdapter(
      JSON.stringify({
        tokenizerVersion: 2,
        inverted: { giant: { 'large.md::0': 1 } },
        docLengths: { 'large.md::0': 1 },
        docSources: { 'large.md::0': 'large.md' },
        totalDocs: 1,
        avgDocLength: 1,
      }),
    );
    const bm25 = new IndexedDbBM25Index(
      createDbName(),
      inspectable.adapter,
      '.superpower-inside/bm25-index.json',
      { maxSnapshotBytes: 4 },
    );

    await bm25.load();

    expect(inspectable.readCount()).toBe(0);
    expect(bm25.totalDocs).toBe(0);
    expect(bm25.isTokenizerCurrent).toBe(true);
  });

  it('큰 IndexedDB BM25 snapshot은 시작 경로에서 WASM runtime으로 파싱하지 않는다', async () => {
    const dbName = createDbName();
    await seedBm25Snapshot(dbName, '{"schemaVersion":3,"tokenizerVersion":2,"docs":["large"]}');
    const bm25 = new IndexedDbBM25Index(
      dbName,
      createAdapter(),
      '.superpower-inside/bm25-index.json',
      {
        maxSnapshotBytes: 4,
      },
    );

    await bm25.load();

    expect(bm25.totalDocs).toBe(0);
    expect(bm25.isTokenizerCurrent).toBe(true);
  });

  it('종료된 작업자는 한 번만 복원하고 저장된 원문 코퍼스를 보존한다', async () => {
    let created = 0;
    let fail: ((event: ErrorEvent) => void) | undefined;
    const workerFactory: BM25WorkerFactory = () => {
      created++;
      let respond: ((event: MessageEvent<BM25WorkerResponse>) => void) | undefined;
      return {
        worker: {
          postMessage: (message) =>
            queueMicrotask(() =>
              respond?.({
                data: { id: message.id, ready: true, tokenizerCurrent: true, totalDocs: 1 },
              } as MessageEvent<BM25WorkerResponse>),
            ),
          terminate: vi.fn(),
          setOnMessage: (handler) => {
            respond = handler;
          },
          setOnError: (handler) => {
            fail = handler;
          },
        },
        dispose: vi.fn(),
      };
    };
    const bm25 = new IndexedDbBM25Index(createDbName(), createAdapter(), undefined, {
      workerFactory,
    });
    await bm25.load();
    bm25.addDocument('doc::0', '원문은 보존됩니다.', 'doc.md');
    await bm25.persist();
    await Promise.resolve();
    fail?.({ message: 'worker failed' } as ErrorEvent);
    expect(bm25.isReady).toBe(false);
    await Promise.all([bm25.recoverClosedWorker(), bm25.recoverClosedWorker()]);
    expect(created).toBe(2);
    expect(bm25.isReady).toBe(true);
    expect(await bm25.getCorpusDocumentsByIds(['doc::0'])).toEqual([
      expect.objectContaining({ text: '원문은 보존됩니다.' }),
    ]);
    bm25.close();
  });

  it('작업자 재초기화가 한 번 실패해도 다음 준비에서 저장된 자료로 다시 복구한다', async () => {
    let created = 0;
    let fail: ((event: ErrorEvent) => void) | undefined;
    const workerFactory: BM25WorkerFactory = () => {
      const attempt = ++created;
      let respond: ((event: MessageEvent<BM25WorkerResponse>) => void) | undefined;
      return {
        worker: {
          postMessage: (message) =>
            queueMicrotask(() =>
              respond?.({
                data:
                  attempt === 2
                    ? { id: message.id, error: '합성 재초기화 실패' }
                    : { id: message.id, ready: true, tokenizerCurrent: true, totalDocs: 1 },
              } as MessageEvent<BM25WorkerResponse>),
            ),
          terminate: vi.fn(),
          setOnMessage: (handler) => {
            respond = handler;
          },
          setOnError: (handler) => {
            fail = handler;
          },
        },
        dispose: vi.fn(),
      };
    };
    const bm25 = new IndexedDbBM25Index(createDbName(), createAdapter(), undefined, {
      workerFactory,
    });
    try {
      await bm25.load();
      bm25.addDocument('synthetic::0', '합성 원문 보존', 'synthetic.md');
      await bm25.persist();
      await Promise.resolve();
      fail?.({ message: '합성 작업자 종료' } as ErrorEvent);
      await expect(bm25.recoverClosedWorker()).rejects.toThrow('합성 재초기화 실패');
      await Promise.all([bm25.recoverClosedWorker(), bm25.recoverClosedWorker()]);
      expect(created).toBe(3);
      expect(bm25.isReady).toBe(true);
      expect(await bm25.getCorpusDocumentsByIds(['synthetic::0'])).toEqual([
        expect.objectContaining({ text: '합성 원문 보존' }),
      ]);
    } finally {
      bm25.close();
    }
  });

  it('작업자가 종료되면 이번 세션 색인을 쓸 수 없는 상태로 보고한다', async () => {
    let respond: ((event: MessageEvent<BM25WorkerResponse>) => void) | undefined;
    let fail: ((event: ErrorEvent) => void) | undefined;
    const workerFactory = (): BM25WorkerHandle => ({
      worker: {
        postMessage: (message: BM25WorkerRequest) => {
          window.setTimeout(
            () =>
              respond?.(
                {
                  data: {
                    id: message.id,
                    ready: true,
                    tokenizerCurrent: true,
                    totalDocs: 1,
                  },
                } as MessageEvent<BM25WorkerResponse>,
              ),
            0,
          );
        },
        terminate: vi.fn(),
        setOnMessage: (handler: (event: MessageEvent<BM25WorkerResponse>) => void) => {
          respond = handler;
        },
        setOnError: (handler: (event: ErrorEvent) => void) => {
          fail = handler;
        },
      },
      dispose: vi.fn(),
    });
    const bm25 = new IndexedDbBM25Index(createDbName(), createAdapter(), undefined, {
      workerFactory,
    });
    try {
      await bm25.load();
      expect(bm25.hasFailure).toBe(false);
      fail?.({ message: '합성 작업자 종료' } as ErrorEvent);
      expect(bm25.hasFailure).toBe(true);
    } finally {
      bm25.close();
    }
  });

  it('증분 작업 대기 중 취소한 검색을 worker에 뒤늦게 보내지 않는다', async () => {
    const operations: string[] = [];
    let respond: ((event: MessageEvent<BM25WorkerResponse>) => void) | undefined;
    const workerFactory: BM25WorkerFactory = () => ({
      worker: {
        postMessage: (message) => {
          operations.push(message.operation);
          if (message.operation === 'add') return;
          queueMicrotask(() =>
            respond?.({
              data: {
                id: message.id,
                ready: true,
                tokenizerCurrent: true,
                totalDocs: 0,
              },
            } as unknown as MessageEvent<BM25WorkerResponse>),
          );
        },
        terminate: vi.fn(),
        setOnMessage: (handler) => {
          respond = handler;
        },
        setOnError: vi.fn(),
      },
      dispose: vi.fn(),
    });
    const bm25 = new IndexedDbBM25Index(createDbName(), createAdapter(), undefined, {
      workerFactory,
    });
    try {
      await bm25.load();
      bm25.addDocument('synthetic::0', 'synthetic pending mutation', 'synthetic.md');
      await vi.waitFor(() => expect(operations).toContain('add'));
      const controller = new AbortController();
      let outcome = 'pending';
      const execution = bm25.searchTopWithSources('synthetic', 1, controller.signal).then(
        () => {
          outcome = 'resolved';
        },
        (error: unknown) => {
          outcome = error instanceof DOMException ? error.name : 'other-error';
        },
      );
      controller.abort();
      await vi.waitFor(() => expect(outcome).toBe('AbortError'), { timeout: 100 });
      await execution;
      expect(operations).not.toContain('search-top');
    } finally {
      bm25.close();
    }
  });

  it('worker hydration 중에도 검색을 막지 않고 증분 변경은 순서대로 적용한다', async () => {
    const operations: string[] = [];
    const workerControl: {
      initializeRequestId?: number;
      onMessage?: (event: MessageEvent<BM25WorkerResponse>) => void;
    } = {};
    const workerFactory: BM25WorkerFactory = () => ({
      worker: {
        postMessage: (message) => {
          operations.push(message.operation);
          if (message.operation === 'initialize') {
            workerControl.initializeRequestId = message.id;
            return;
          }
          queueMicrotask(() => {
            workerControl.onMessage?.({
              data: {
                id: message.id,
                ready: true,
                tokenizerCurrent: true,
                totalDocs: 2,
                ...(message.operation === 'search-top'
                  ? {
                      hits: [
                        {
                          docId: 'new.md::0',
                          sourcePath: 'new.md',
                          score: 1,
                        },
                      ],
                    }
                  : {}),
              },
            } as unknown as MessageEvent<BM25WorkerResponse>);
          });
        },
        terminate: vi.fn(),
        setOnMessage: (handler) => {
          workerControl.onMessage = handler;
        },
        setOnError: vi.fn(),
      } satisfies BM25WorkerAdapter,
      dispose: vi.fn(),
    });
    const bm25 = new IndexedDbBM25Index(createDbName(), createAdapter(), undefined, {
      workerFactory,
    });

    const loading = bm25.load();
    await vi.waitFor(() => {
      expect(operations).toEqual(['initialize']);
    });
    bm25.addDocument('new.md::0', 'hydration 이후 반영할 문서', 'new.md');
    await Promise.resolve();
    expect(operations).toEqual(['initialize']);

    // 적재 중 검색은 기다리지 않고 빈 결과로 물러납니다.
    await expect(bm25.searchTopWithSources('hydration', 1)).resolves.toEqual([]);
    // 복구할 작업자가 없으므로 준비 호출도 적재를 기다리지 않습니다.
    await bm25.recoverClosedWorker();
    expect(operations).toEqual(['initialize']);

    const initializeRequestId = workerControl.initializeRequestId;
    const onMessage = workerControl.onMessage;
    if (initializeRequestId === undefined || onMessage === undefined) {
      throw new Error('BM25 worker initialize request was not captured.');
    }
    onMessage({
      data: {
        id: initializeRequestId,
        ready: true,
        tokenizerCurrent: true,
        totalDocs: 1,
      },
    } as unknown as MessageEvent<BM25WorkerResponse>);
    await loading;
    const hits = await bm25.searchTopWithSources('hydration', 1);

    expect(operations).toEqual(['initialize', 'add', 'search-top']);
    expect(hits).toEqual([
      {
        docId: 'new.md::0',
        sourcePath: 'new.md',
        score: 1,
      },
    ]);
  });

  it('전체 재빌드 중 긴 문서 루프는 이벤트 루프에 양보하면서 검색 결과를 유지한다', async () => {
    const dbName = createDbName();
    const bm25 = new IndexedDbBM25Index(dbName, createAdapter());
    await bm25.load();

    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout');
    try {
      const documents = Array.from({ length: 129 }, (_, index) => ({
        id: `doc-${index}.md::0`,
        text: index === 128 ? 'needle final document' : `ordinary document ${index}`,
        sourcePath: `doc-${index}.md`,
      }));

      const rebuildPromise = bm25.rebuild(documents);
      await Promise.resolve();
      await Promise.resolve();

      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 0);

      await vi.runAllTimersAsync();
      await rebuildPromise;

      expect(bm25.totalDocs).toBe(documents.length);
      expect([...bm25.search('needle').keys()]).toEqual(['doc-128.md::0']);
    } finally {
      setTimeoutSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('전체 재빌드에서 같은 doc id가 반복되면 마지막 문서로 교체한다', async () => {
    const bm25 = new IndexedDbBM25Index(createDbName(), createAdapter());
    await bm25.load();

    await bm25.rebuild([
      { id: 'note.md::0', text: 'obsoletealpha', sourcePath: 'note.md' },
      { id: 'note.md::0', text: 'freshbeta', sourcePath: 'note.md' },
    ]);

    expect([...bm25.search('obsoletealpha').keys()]).toEqual([]);
    expect([...bm25.search('freshbeta').keys()]).toEqual(['note.md::0']);
  });

  it('재빌드 corpus를 준비하는 동안 들어온 증분 변경은 bulk 교체 뒤 다시 적용한다', async () => {
    const bm25 = new IndexedDbBM25Index(createDbName(), createAdapter());
    await bm25.load();
    bm25.addDocument('gone.md::0', 'removeme 이전 문서', 'gone.md');
    await bm25.persist();

    let finishCorpus = (_documents: BM25DocumentInput[]): void => undefined;
    const corpus = new Promise<BM25DocumentInput[]>((resolve) => {
      finishCorpus = resolve;
    });
    const rebuilding = bm25.rebuildFrom(() => corpus);
    bm25.removeDocumentsBySource('gone.md');
    bm25.addDocument('new.md::0', 'keepme 최신 문서', 'new.md');
    await bm25.persist();
    finishCorpus([
      {
        id: 'gone.md::0',
        text: 'removeme stale snapshot',
        sourcePath: 'gone.md',
      },
      {
        id: 'baseline.md::0',
        text: 'baseline snapshot',
        sourcePath: 'baseline.md',
      },
    ]);

    await rebuilding;

    expect([...bm25.search('removeme').keys()]).toEqual([]);
    expect([...bm25.search('keepme').keys()]).toEqual(['new.md::0']);
    expect([...bm25.search('baseline').keys()]).toEqual(['baseline.md::0']);
  });

  it('재시작은 스냅샷과 tombstone 델타만으로 런타임을 복구한다', async () => {
    const dbName = createDbName();
    const snapshotRaw = '{"schemaVersion":3,"tokenizerVersion":2,"docs":["canned"]}';
    const first = new IndexedDbBM25Index(dbName, createAdapter(), undefined, {
      workerFactory: createScriptedWorker(snapshotRaw).factory,
      snapshotMinOrders: 1,
      snapshotIntervalMs: 60_000,
    });
    await first.load();
    expect(first.recoveryMode).toBe('full');
    first.addDocument('note.md::0', 'alpha 원문', 'note.md');
    await first.persist();

    const captured = await readSnapshotState(dbName);
    expect(captured.manifest?.tokenizerVersion).toBe(TOKENIZER_VERSION);
    expect(captured.manifest?.docCount).toBe(1);
    expect(captured.manifest?.lastOrder).toBeGreaterThan(0);
    expect(captured.blockCount).toBeGreaterThan(0);
    expect(captured.manifest?.byteLength).toBe(snapshotRaw.length);
    first.removeDocumentsBySource('note.md');
    await first.persist();
    // 두 번째 persist는 캡처 주기 안이라 tombstone 로그를 지우지 않는다.
    const afterRemoval = await readSnapshotState(dbName);
    expect(afterRemoval.manifest?.lastOrder).toBe(captured.manifest?.lastOrder);
    expect(afterRemoval.removals.map((record) => record.kind)).toEqual(['remove-source']);
    expect(afterRemoval.removals[0]?.order).toBeGreaterThan(captured.manifest?.lastOrder ?? 0);

    const secondWorker = createScriptedWorker(snapshotRaw);
    const second = new IndexedDbBM25Index(dbName, createAdapter(), undefined, {
      workerFactory: secondWorker.factory,
      snapshotMinOrders: 1,
      snapshotIntervalMs: 60_000,
    });
    await second.load();

    const initialize = secondWorker.requests.find((request) => request.operation === 'initialize');
    expect(initialize?.snapshot).toBe(snapshotRaw);
    expect(initialize?.sinceOrder).toBe(captured.manifest?.lastOrder);
    expect(initialize?.expectedDocs).toBe(captured.manifest?.docCount);
    expect(second.recoveryMode).toBe('snapshot+delta');
    second.close();
    first.close();
  });

  it('블록이 사라진 스냅샷은 폐기하고 원문에서 전량 복구한다', async () => {
    const dbName = createDbName();
    const first = new IndexedDbBM25Index(dbName, createAdapter(), undefined, {
      workerFactory: createScriptedWorker('{"docs":[]}').factory,
      snapshotMinOrders: 1,
      snapshotIntervalMs: 60_000,
    });
    await first.load();
    first.addDocument('note.md::0', 'alpha 원문', 'note.md');
    await first.persist();
    await deleteSnapshotBlocks(dbName);

    const secondWorker = createScriptedWorker('{"docs":[]}');
    const second = new IndexedDbBM25Index(dbName, createAdapter(), undefined, {
      workerFactory: secondWorker.factory,
      snapshotMinOrders: 1,
      snapshotIntervalMs: 60_000,
    });
    await second.load();

    const initialize = secondWorker.requests.find((request) => request.operation === 'initialize');
    expect(initialize?.snapshot).toBe('');
    expect(initialize?.sinceOrder).toBeUndefined();
    expect(second.recoveryMode).toBe('full');
    expect((await readSnapshotState(dbName)).manifest).toBeNull();
    second.close();
    first.close();
  });

  it('블록 기록이 quota로 실패해도 색인은 계속되고 다음 시작은 전량 복구한다', async () => {
    const dbName = createDbName();
    const failing = new QuotaFailingBm25Index(dbName, createAdapter(), undefined, {
      workerFactory: createScriptedWorker('{"docs":[]}').factory,
      snapshotMinOrders: 1,
      snapshotIntervalMs: 60_000,
    });
    await failing.load();
    failing.addDocument('note.md::0', 'alpha 원문', 'note.md');
    await failing.persist();

    expect(failing.isReady).toBe(true);
    expect(failing.recoveryMode).toBe('full');
    const state = await readSnapshotState(dbName);
    expect(state.manifest).toBeNull();
    expect(state.blockCount).toBe(0);

    const secondWorker = createScriptedWorker('{"docs":[]}');
    const second = new IndexedDbBM25Index(dbName, createAdapter(), undefined, {
      workerFactory: secondWorker.factory,
      snapshotMinOrders: 1,
      snapshotIntervalMs: 60_000,
    });
    await second.load();
    expect(second.recoveryMode).toBe('full');
    expect((await second.getCorpusDocumentsByIds(['note.md::0'])).length).toBe(1);
    second.close();
    failing.close();
  });

  it('스냅샷 직렬화 중 들어온 변경은 다음 델타로 남겨 유실하지 않는다', async () => {
    const dbName = createDbName();
    const gated = createScriptedWorker('{"docs":[]}', { holdSerialize: true });
    const bm25 = new IndexedDbBM25Index(dbName, createAdapter(), undefined, {
      workerFactory: gated.factory,
      snapshotMinOrders: 1,
      snapshotIntervalMs: 60_000,
    });
    await bm25.load();
    bm25.addDocument('early.md::0', 'early 원문', 'early.md');
    const persisting = bm25.persist();
    await waitForRequest(gated.requests, 'serialize');
    bm25.addDocument('late.md::0', 'late 원문', 'late.md');
    gated.releaseSerialize();
    await persisting;
    // 캡처 뒤 들어온 변경은 다음 persist에서 저장되어 델타로 남는다.
    await bm25.persist();

    const state = await readSnapshotState(dbName);
    const late = await readDocumentOrder(dbName, 'late.md::0');
    expect(late).toBeGreaterThan(state.manifest?.lastOrder ?? 0);
    expect(await readDocumentOrder(dbName, 'early.md::0')).toBeLessThanOrEqual(
      state.manifest?.lastOrder ?? 0,
    );
    bm25.close();
  });

  it('토크나이저 계약이 바뀐 스냅샷은 쓰지 않고 폐기한다', async () => {
    const dbName = createDbName();
    await seedSnapshotManifest(dbName, {
      generation: 'legacy-generation',
      tokenizerVersion: 1,
      lastOrder: 100,
      docCount: 1,
      byteLength: 8,
      blockCount: 1,
    });

    const worker = createScriptedWorker('{"docs":[]}');
    const bm25 = new IndexedDbBM25Index(dbName, createAdapter(), undefined, {
      workerFactory: worker.factory,
      snapshotMinOrders: 1,
      snapshotIntervalMs: 60_000,
    });
    await bm25.load();

    const initialize = worker.requests.find((request) => request.operation === 'initialize');
    expect(initialize?.snapshot).toBe('');
    expect(bm25.recoveryMode).toBe('full');
    expect((await readSnapshotState(dbName)).manifest).toBeNull();
    bm25.close();
  });

  it('재시작 sweep은 활성 세대가 아닌 고아 스냅샷 블록만 지운다', async () => {
    const dbName = createDbName();
    const first = new IndexedDbBM25Index(dbName, createAdapter(), undefined, {
      workerFactory: createScriptedWorker('{"docs":[]}').factory,
      snapshotMinOrders: 1,
      snapshotIntervalMs: 60_000,
    });
    await first.load();
    first.addDocument('note.md::0', 'alpha 원문', 'note.md');
    await first.persist();
    const captured = await readSnapshotState(dbName);
    await seedOrphanSnapshotBlock(dbName, 'dead-generation', '{}');

    const secondWorker = createScriptedWorker('{"docs":[]}');
    const second = new IndexedDbBM25Index(dbName, createAdapter(), undefined, {
      workerFactory: secondWorker.factory,
      snapshotMinOrders: 1,
      snapshotIntervalMs: 60_000,
    });
    await second.load();

    expect(second.recoveryMode).toBe('snapshot+delta');
    expect(await readSnapshotBlockKeys(dbName)).toEqual([`${captured.manifest?.generation}:0`]);
    second.close();
    first.close();
  });

  it('deleteDatabase는 BM25 문서와 mutation DB를 통째로 삭제한다', async () => {
    const dbName = createDbName();
    const bm25 = new IndexedDbBM25Index(dbName, createAdapter());
    await bm25.load();
    bm25.addDocument('note.md::0', 'freshbeta', 'note.md');
    await bm25.persist();

    await bm25.deleteDatabase();

    const reopened = new IndexedDbBM25Index(dbName, createAdapter());
    await reopened.load();
    expect(reopened.totalDocs).toBe(0);
    expect([...reopened.search('freshbeta').keys()]).toEqual([]);
  });
  it('materializes removals without retaining an unbounded tombstone log', async () => {
    const dbName = createDbName();
    const bm25 = new IndexedDbBM25Index(dbName, createAdapter());
    await bm25.load();
    bm25.addDocument('obsolete.md::0', 'obsolete text', 'obsolete.md');
    await bm25.persist();

    for (let index = 0; index < 5; index++) {
      bm25.removeDocumentsBySource('obsolete.md');
      await bm25.persist();
    }

    expect(await countBm25Mutations(dbName)).toBe(0);
  });

  it('removes sources for files deleted while the plugin was not running', async () => {
    const bm25 = new IndexedDbBM25Index(createDbName(), createAdapter());
    await bm25.load();
    bm25.addDocument('keep.md::0', 'keep text', 'keep.md');
    bm25.addDocument('gone.md::0', 'gone text', 'gone.md');
    await bm25.persist();

    const result = await bm25.reconcileSourcePaths(['keep.md']);

    expect(result).toEqual({ deletedSourcePaths: ['gone.md'], remainingWork: false });
    await expect(bm25.getSourcePaths()).resolves.toEqual(['keep.md']);
    expect([...bm25.search('gone').keys()]).toEqual([]);
  });
});

async function createBm25(
  documents: readonly (readonly [string, string])[],
): Promise<IndexedDbBM25Index> {
  const bm25 = new IndexedDbBM25Index(createDbName(), createAdapter());
  await bm25.load();
  for (const [id, text] of documents) {
    bm25.addDocument(id, text);
  }
  return bm25;
}

async function countBm25Mutations(dbName: string): Promise<number> {
  const db = new Dexie(dbName);
  db.version(2).stores({
    meta: 'key',
    documents: 'id, sourcePath, updated, order',
    mutations: 'id, kind, target, updated, order',
  });
  const count = await db.table('mutations').count();
  db.close();
  return count;
}

function createDbName(): string {
  const dbName = `SuperpowerInsideBM25IndexTest-${crypto.randomUUID()}`;
  dbNames.add(dbName);
  return dbName;
}

function createAdapter(rawJson?: string): DataAdapter {
  return createInspectableAdapter(rawJson).adapter;
}

async function seedBm25Snapshot(dbName: string, raw: string): Promise<void> {
  const db = new Dexie(dbName);
  db.version(1).stores({
    meta: 'key',
  });
  await db.table('meta').put({
    key: 'bm25-runtime-snapshot:v1',
    value: raw,
    updated: 1000,
  });
  db.close();
}

interface InspectableAdapter {
  adapter: DataAdapter;
  readRaw(path: string): string | undefined;
  readCount(): number;
  writeCount(): number;
}

function createInspectableAdapter(rawJson?: string): InspectableAdapter {
  const files = new Map<string, string>();
  let reads = 0;
  let writes = 0;
  if (rawJson !== undefined) {
    files.set('.superpower-inside/bm25-index.json', rawJson);
  }
  const adapter = {
    exists: (path: string) => Promise.resolve(files.has(path)),
    stat: (path: string) => {
      const data = files.get(path);
      if (data === undefined) return Promise.resolve(null);
      return Promise.resolve({
        type: 'file',
        ctime: 1000,
        mtime: 1000,
        size: data.length,
      });
    },
    read: (path: string) => {
      reads += 1;
      return Promise.resolve(files.get(path) ?? '');
    },
    write: (path: string, data: string) => {
      writes += 1;
      files.set(path, data);
      return Promise.resolve();
    },
    rename: (path: string, newPath: string) => {
      const data = files.get(path);
      if (data !== undefined) {
        files.set(newPath, data);
        files.delete(path);
      }
      return Promise.resolve();
    },
    remove: (path: string) => {
      files.delete(path);
      return Promise.resolve();
    },
    mkdir: () => Promise.resolve(),
  } as unknown as DataAdapter;
  return {
    adapter,
    readRaw: (path: string) => files.get(path),
    readCount: () => reads,
    writeCount: () => writes,
  };
}

class QuotaFailingBm25Index extends IndexedDbBM25Index {
  protected override writeSnapshotBlock(_key: string, _data: string): Promise<void> {
    return Promise.reject(new DOMException('quota exceeded', 'QuotaExceededError'));
  }
}

interface ScriptedWorkerHandle {
  factory: BM25WorkerFactory;
  requests: BM25WorkerRequest[];
  releaseSerialize(): void;
}

function createScriptedWorker(
  snapshot: string,
  options: { holdSerialize?: boolean } = {},
): ScriptedWorkerHandle {
  const requests: BM25WorkerRequest[] = [];
  let respond: ((event: MessageEvent<BM25WorkerResponse>) => void) | undefined;
  let release: (() => void) | undefined;
  const gate = options.holdSerialize
    ? new Promise<void>((resolve) => {
        release = resolve;
      })
    : undefined;
  const factory: BM25WorkerFactory = () => ({
    worker: {
      postMessage: (message) => {
        requests.push(message);
        const deliver = async (): Promise<void> => {
          let response: BM25WorkerResponse = {
            id: message.id,
            ready: true,
            tokenizerCurrent: true,
            totalDocs: message.snapshot ? 1 : 2,
          };
          if (message.operation === 'serialize') {
            await gate;
            response = { ...response, snapshot };
          }
          respond?.({ data: response } as MessageEvent<BM25WorkerResponse>);
        };
        void deliver();
      },
      terminate: vi.fn(),
      setOnMessage: (handler) => {
        respond = handler;
      },
      setOnError: () => undefined,
    },
    dispose: vi.fn(),
  });
  return { factory, requests, releaseSerialize: () => release?.() };
}

async function waitForRequest(
  requests: readonly BM25WorkerRequest[],
  operation: BM25WorkerRequest['operation'],
): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (requests.some((request) => request.operation === operation)) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error(`BM25 worker request ${operation} was not sent.`);
}

interface SnapshotManifestRecord {
  generation: string;
  tokenizerVersion: number;
  lastOrder: number;
  docCount: number;
  byteLength: number;
  blockCount: number;
}

interface SnapshotRemovalRecord {
  order: number;
  kind: string;
  target: string;
}

interface SnapshotState {
  manifest: SnapshotManifestRecord | null;
  blockCount: number;
  removals: SnapshotRemovalRecord[];
}

interface StoredSnapshotMeta {
  key: string;
  value: string;
  updated: number;
}

function openSnapshotDb(dbName: string): Dexie {
  const db = new Dexie(dbName);
  db.version(3).stores({
    meta: 'key',
    documents: 'id, sourcePath, updated, order',
    mutations: 'id, kind, target, updated, order',
    removals: 'order, target',
    snapshotBlocks: 'key',
  });
  return db;
}

async function seedOrphanSnapshotBlock(
  dbName: string,
  generation: string,
  data: string,
): Promise<void> {
  const db = openSnapshotDb(dbName);
  try {
    await db.table('snapshotBlocks').put({ key: `${generation}:0`, data });
  } finally {
    db.close();
  }
}

async function readSnapshotBlockKeys(dbName: string): Promise<string[]> {
  const db = openSnapshotDb(dbName);
  try {
    const keys = await db
      .table<{ key: string }, string>('snapshotBlocks')
      .toCollection()
      .primaryKeys();
    return [...keys].sort((a, b) => a.localeCompare(b));
  } finally {
    db.close();
  }
}

async function readSnapshotState(dbName: string): Promise<SnapshotState> {
  const db = openSnapshotDb(dbName);
  try {
    const stored = await db
      .table<StoredSnapshotMeta, string>('meta')
      .get('bm25-snapshot-manifest:v1');
    const value = stored?.value;
    return {
      manifest: typeof value === 'string' ? (JSON.parse(value) as SnapshotManifestRecord) : null,
      blockCount: await db.table('snapshotBlocks').count(),
      removals: await db.table<SnapshotRemovalRecord, number>('removals').toArray(),
    };
  } finally {
    db.close();
  }
}

async function readDocumentOrder(dbName: string, id: string): Promise<number | undefined> {
  const db = openSnapshotDb(dbName);
  try {
    const record = await db.table<{ id: string; order?: number }, string>('documents').get(id);
    return record?.order;
  } finally {
    db.close();
  }
}

async function deleteSnapshotBlocks(dbName: string): Promise<void> {
  const db = openSnapshotDb(dbName);
  try {
    await db.table('snapshotBlocks').clear();
  } finally {
    db.close();
  }
}

async function seedSnapshotManifest(
  dbName: string,
  manifest: SnapshotManifestRecord,
): Promise<void> {
  const db = openSnapshotDb(dbName);
  try {
    await db.table('meta').put({
      key: 'bm25-snapshot-manifest:v1',
      value: JSON.stringify(manifest),
      updated: 1000,
    });
  } finally {
    db.close();
  }
}
