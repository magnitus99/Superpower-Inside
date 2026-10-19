import type { NativeVaultQueryEngineLike } from '../agent/obsidian-native-vault-port';
import type { RAGQueryEngine, RAGQueryOptions } from '../rag/query';
import type { RagQueryLike } from './context';
import type { ChatRetrievalRecord } from './types';

/** 쿼리별 콜백을 사용해 병렬 검색의 마지막 전역 진단을 잘못 연결하지 않습니다. */
export function observeChatRetrieval(
  engine: RAGQueryEngine,
  onRecord: (record: ChatRetrievalRecord) => void,
): RagQueryLike & NativeVaultQueryEngineLike {
  return {
    query: (question, topK, minScore?, prefixes?, options?: RAGQueryOptions) =>
      engine
        .query(question, topK, minScore, prefixes, {
          ...options,
          onRetrieved: (results, diagnostics) => {
            options?.onRetrieved?.(results, diagnostics);
            onRecord({
              query: question,
              diagnostics: diagnostics.map(({ error: _error, ...diagnostic }) => diagnostic),
              results: results.map((result) => ({
                filePath: result.sourcePath,
                line: result.chunkRange.startLine + 1,
                endLine:
                  result.chunkRange.endLine === undefined
                    ? undefined
                    : result.chunkRange.endLine + 1,
                bm25Score: result.bm25Score,
                vectorScore: result.vectorScore,
                selectionReason: result.selectionReason,
              })),
            });
          },
        })
        .catch((error: unknown) => {
          onRecord({ query: question, status: 'error', diagnostics: [], results: [] });
          throw error;
        }),
    getLastRetrievalDiagnostics: () => engine.getLastRetrievalDiagnostics(),
    getIndexReadiness: (files) => engine.getIndexReadiness(files),
  };
}
