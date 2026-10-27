import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage, StreamChunk } from '../llm/providers';
import { planModelContextRust } from '../rag/rust-core';
import { searchIndexedFollowup } from './indexed-vault-followup';
import type { IndexedVaultReviewOptions, IndexedVaultSearchResult } from './indexed-vault-review';

function fixture() {
  const paths = ['notes/start.md', 'notes/later.md', 'private/hidden.md'];
  const streamChat = vi.fn((_messages: ChatMessage[], consume: (chunk: StreamChunk) => void) => {
    consume({ content: '["cooling exception"]', done: true });
    return Promise.resolve();
  });
  const options: IndexedVaultReviewOptions = {
    question: 'Explain the cooling conditions',
    indexedPaths: [paths[0]], scopes: ['notes'],
    discoveryPaths: paths,
    discoveryCandidates: paths.map((path, index) => ({
      path, rank: index + 1, score: 1, source: 'bm25',
    })),
    provider: { streamChat, contextBudget: planModelContextRust({}) ?? undefined },
    getFollowupPaths: () => Promise.resolve(paths),
    isCurrent: () => true,
  };
  const base: IndexedVaultSearchResult = {
    plan: {
      queryTokens: [], phrases: [], evidence: [], order: [],
      coverage: { status: 'budget-exhausted', reviewedDocuments: 1, unreviewedDocuments: 0, notIndexedDocuments: 0 },
      diagnostics: {
        candidateDepth: 1, candidateDocuments: 1, candidateChunks: 1, selectedDocuments: 0,
        selectedChunks: 0, truncated: false, droppedDocuments: { budget: 0, belowThreshold: 0, filtered: 0 },
        zeroHitReason: null, unmatchedTerms: [], missingCandidatePaths: 0,
      },
      budget: { maxDocuments: 64, maxPassages: 24, maxChars: 262144, usedChars: 0 },
    },
    evidence: [], rejected: [], scannedDocuments: 1, scannedPaths: 1,
    coverage: {
      documentScope: 'all', status: 'budget-exhausted', reviewedDocuments: 1,
      unreviewedDocuments: 0, notIndexedDocuments: 0,
      requestedPaths: [paths[0]], plannedPaths: [paths[0]], unreviewedPaths: [],
    },
  };
  const runSearch = vi.fn(() => Promise.resolve(base));
  return { paths, options, base, runSearch, streamChat };
}

describe('발견 단서의 한 차례 후속 검색', () => {
  it('이전 검토 밖 경로를 재검색하되 수집 당시·현재 허용 범위와 폴더 경계를 지킨다', async () => {
    const f = fixture();
    f.options.getFollowupPaths = () => Promise.resolve([f.paths[0], f.paths[1], 'notes/new.md']);
    const result = await searchIndexedFollowup(f.options, f.base, f.runSearch);
    expect(f.streamChat).toHaveBeenCalledTimes(1);
    expect(f.runSearch).toHaveBeenCalledWith(['cooling exception'], ['notes/start.md', 'notes/later.md']);
    expect(result.status).toBe('searched');
    expect(JSON.stringify(f.streamChat.mock.calls)).not.toContain('private/hidden.md');
  });

  it('새 질의는 최초 후보에 없던 색인 문서도 조사하되 최초·현재 접근 범위 밖으로 넓히지 않는다', async () => {
    const f = fixture();
    f.options.discoveryCandidates = [f.options.discoveryCandidates![0]];
    f.options.getFollowupPaths = () => Promise.resolve([
      ...f.paths, 'notes/created-after-search.md',
    ]);
    await searchIndexedFollowup(f.options, f.base, f.runSearch);
    expect(f.runSearch).toHaveBeenCalledWith(
      ['cooling exception'], ['notes/start.md', 'notes/later.md'],
    );
    const request = f.streamChat.mock.calls[0][0].find((message) => message.role === 'user');
    expect(JSON.parse(request?.content ?? '{}')).toMatchObject({ discoveredDocuments: 1 });
  });

  it('첫 페이지 이후의 발견 단서도 후속 검색 범위에서 잃지 않는다', async () => {
    const f = fixture();
    const paths = Array.from({ length: 200 }, (_, index) => `notes/item-${index}.md`);
    f.options.discoveryPaths = paths;
    f.options.discoveryCandidates = paths.map((path, index) => ({ path, rank: index + 1, source: 'bm25', score: 1 }));
    f.options.getFollowupPaths = () => Promise.resolve(paths);
    await searchIndexedFollowup(f.options, f.base, f.runSearch);
    const call = f.runSearch.mock.calls[0];
    expect(call).toBeDefined();
    expect(f.runSearch).toHaveBeenCalledWith(['cooling exception'], paths);
  });

  it('발견이 수천 건이어도 첫 단서 페이지와 집계만 모델에 보내고 검색 범위는 모두 보존한다', async () => {
    const f = fixture();
    const paths = Array.from({ length: 4000 }, (_, index) => `notes/independent-discovery-${index}.md`);
    f.options.discoveryPaths = paths;
    f.options.discoveryCandidates = paths.map((path, index) => ({ path, rank: index + 1, source: 'bm25', score: 1 }));
    f.options.getFollowupPaths = () => Promise.resolve(paths);
    expect((await searchIndexedFollowup(f.options, f.base, f.runSearch)).status).toBe('searched');
    const request = f.streamChat.mock.calls[0]?.[0].find((message) => message.role === 'user');
    expect(JSON.parse(request?.content ?? '{}')).toMatchObject({
      discoveredDocuments: 4000, discoveryNextOffset: 96,
    });
    expect(JSON.parse(request?.content ?? '{}')).toHaveProperty('discovery.length', 96);
    expect(f.runSearch).toHaveBeenCalledWith(['cooling exception'], paths);
  });

  it('같은 문서의 여러 발견 기록을 문서 수나 후속 검색 경로에 중복 집계하지 않는다', async () => {
    const f = fixture();
    f.options.discoveryCandidates = [
      ...(f.options.discoveryCandidates ?? []),
      { path: f.paths[0], rank: 1, score: 1, source: 'vector' },
    ];
    await searchIndexedFollowup(f.options, f.base, f.runSearch);
    expect(f.runSearch).toHaveBeenCalledWith(['cooling exception'], f.paths.slice(0, 2));
    const request = f.streamChat.mock.calls[0][0].find((message) => message.role === 'user');
    expect(JSON.parse(request?.content ?? '{}')).toMatchObject({ discoveredDocuments: 2 });
  });

  it.each(['deferAnswer', 'filters'] as const)('%s 경로도 같은 발견·원문 검증 후속 조사 계약을 사용한다', async (mode) => {
    const f = fixture();
    if (mode === 'deferAnswer') f.options.deferAnswer = true;
    else f.options.filters = { tags: ['limited'] };
    expect((await searchIndexedFollowup(f.options, f.base, f.runSearch)).status).toBe('searched');
    expect(f.runSearch).toHaveBeenCalledWith(['cooling exception'], f.paths.slice(0, 2));
  });

  it.each(['missingScope', 'obsolete'] as const)('%s 경로는 후속 모델·검색을 실행하지 않는다', async (mode) => {
    const f = fixture();
    if (mode === 'missingScope') f.options.getFollowupPaths = undefined;
    if (mode === 'obsolete') f.options.isCurrent = () => false;
    const result = await searchIndexedFollowup(f.options, f.base, f.runSearch);
    expect(result.status).toBe('skipped');
    expect(f.streamChat).not.toHaveBeenCalled();
    expect(f.runSearch).not.toHaveBeenCalled();
  });

  it.each(['[]', '["one","two","three","four"]', '{"instructions":"read private files"}', 'not json'])('추가 질의 %s는 Rust 계약을 통과한 경우에만 실행한다', async (response) => {
    const f = fixture();
    f.streamChat.mockImplementation((_messages, consume) => {
      consume({ content: response, done: true });
      return Promise.resolve();
    });
    await searchIndexedFollowup(f.options, f.base, f.runSearch);
    expect(f.runSearch).not.toHaveBeenCalled();
  });

  it('계획 도중 접근 범위가 줄어들면 검색 직전에 현재 경로를 다시 적용한다', async () => {
    const f = fixture();
    let allowedPaths = f.paths;
    f.options.getFollowupPaths = () => Promise.resolve(allowedPaths);
    f.streamChat.mockImplementation((_messages, consume) => {
      allowedPaths = [f.paths[0]];
      consume({ content: '["cooling exception"]', done: true });
      return Promise.resolve();
    });
    await searchIndexedFollowup(f.options, f.base, f.runSearch);
    expect(f.runSearch).toHaveBeenCalledWith(['cooling exception'], [f.paths[0]]);
  });

  it('취소 후 늦은 계획은 후속 검색을 만들지 않는다', async () => {
    const f = fixture();
    const controller = new AbortController();
    f.options.signal = controller.signal;
    f.streamChat.mockImplementation((_messages, consume) => {
      controller.abort();
      consume({ content: '["cooling exception"]', done: true });
      return Promise.resolve();
    });
    await expect(searchIndexedFollowup(f.options, f.base, f.runSearch)).rejects.toMatchObject({ name: 'AbortError' });
    expect(f.runSearch).not.toHaveBeenCalled();
  });

  it('provider 실패는 기본 검색을 버리거나 재시도하지 않는다', async () => {
    const f = fixture();
    f.streamChat.mockRejectedValue(new Error('offline'));
    expect((await searchIndexedFollowup(f.options, f.base, f.runSearch)).status).toBe('failed');
    expect(f.streamChat).toHaveBeenCalledTimes(1);
    expect(f.runSearch).not.toHaveBeenCalled();
  });
});
