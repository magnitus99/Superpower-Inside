import type { TFile, Vault } from 'obsidian';
import type { RAGConfig, ChatConfig } from '../settings';
import { getRagCandidateFiles } from '../utils/vault';
import type { FileIndexRecord, VectorStore } from './store';

export type RagDocumentStatus = 'healthy' | 'missing' | 'stale' | 'unknown';

export interface RagDocumentUpdate {
  path: string;
  status: Exclude<RagDocumentStatus, 'healthy'>;
  reason: string;
  mtime: number;
  size: number;
}

export interface RagStatusSummary {
  totalDocuments: number;
  healthyDocuments: number;
  missingDocuments: number;
  staleDocuments: number;
  unknownDocuments: number;
  excludedDocuments: number;
  totalVectors: number;
  lastCalculatedAt: number;
  updateRequiredDocuments: RagDocumentUpdate[];
}

interface FileIndexState {
  status: RagDocumentStatus;
  reason: string;
}

export async function getIncludedRagFiles(
  vault: Vault,
  ragConfig: RAGConfig,
  chatConfig: ChatConfig,
): Promise<TFile[]> {
  return getRagCandidateFiles(vault, ragConfig, chatConfig);
}

/** AbortSignal을 받아 취소 가능한 RAG 상태 계산 */
export async function calculateRagStatus(
  vault: Vault,
  vectorStore: VectorStore,
  ragConfig: RAGConfig,
  chatConfig: ChatConfig,
  signal?: AbortSignal,
): Promise<RagStatusSummary> {
  const includedFiles = await getIncludedRagFiles(vault, ragConfig, chatConfig);
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  const allFiles = vault.getFiles();
  const fileIndexRecords = await vectorStore.getFileIndexRecords();
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  const recordsByPath = new Map(fileIndexRecords.map((record) => [record.filePath, record]));

  const updateRequiredDocuments: RagDocumentUpdate[] = [];
  let healthyDocuments = 0;
  let missingDocuments = 0;
  let staleDocuments = 0;
  let unknownDocuments = 0;

  for (const file of includedFiles) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const state = getFileIndexState(
      file,
      recordsByPath.get(file.path) ?? null,
      ragConfig,
      signal,
    );
    if (state.status === 'healthy') {
      healthyDocuments++;
      continue;
    }

    if (state.status === 'missing') missingDocuments++;
    if (state.status === 'stale') staleDocuments++;
    if (state.status === 'unknown') unknownDocuments++;

    updateRequiredDocuments.push({
      path: file.path,
      status: state.status,
      reason: state.reason,
      mtime: file.stat.mtime,
      size: file.stat.size,
    });
  }

  updateRequiredDocuments.sort((a, b) => {
    const statusOrder = statusSortOrder(a.status) - statusSortOrder(b.status);
    if (statusOrder !== 0) return statusOrder;
    return a.path.localeCompare(b.path);
  });

  return {
    totalDocuments: includedFiles.length,
    healthyDocuments,
    missingDocuments,
    staleDocuments,
    unknownDocuments,
    excludedDocuments: Math.max(0, allFiles.length - includedFiles.length),
    totalVectors: fileIndexRecords.reduce((total, record) => total + record.vectorCount, 0),
    lastCalculatedAt: Date.now(),
    updateRequiredDocuments,
  };
}

/**
 * 파일의 인덱스 상태를 확인합니다.
 *
 * 최적화: mtime과 size가 모두 일치하면 파일 내용 해시 확인을 건너뜁니다.
 * mtime/size가 동일한데 내용이 달라진 극히 드문 케이스는 건강한 것으로 간주하며,
 * 다음 인덱싱 시점에 다시 확인합니다.
 */
function getFileIndexState(
  file: TFile,
  record: FileIndexRecord | null,
  ragConfig: RAGConfig,
  signal?: AbortSignal,
): FileIndexState {
  if (!record || record.vectorCount === 0) {
    return { status: 'missing', reason: '아직 인덱싱되지 않았습니다.' };
  }
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  const isLegacyRecord =
    record.hasCompleteMetadata !== true ||
    typeof record.sourceMtime !== 'number' ||
    typeof record.sourceSize !== 'number' ||
    typeof record.contentHash !== 'string' ||
    typeof record.indexedAt !== 'number' ||
    typeof record.embeddingProvider !== 'string' ||
    typeof record.embeddingModel !== 'string';
  if (isLegacyRecord) {
    return {
      status: 'unknown',
      reason: '이전 형식의 벡터라 파일 변경 여부를 확인할 수 없습니다.',
    };
  }
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  // mtime/size가 달라졌으면 stale (내용 읽기 불필요)
  if (record.sourceMtime !== file.stat.mtime || record.sourceSize !== file.stat.size) {
    return { status: 'stale', reason: '파일이 마지막 인덱싱 이후 수정되었습니다.' };
  }
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  // mtime/size가 같으면 내용 해시 확인 생략 (극히 드문 충돌은 건강한 것으로 간주)
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  if (
    record.embeddingProvider !== ragConfig.embeddingProvider ||
    record.embeddingModel !== ragConfig.embeddingModel
  ) {
    return { status: 'stale', reason: '현재 임베딩 설정과 저장된 벡터 설정이 다릅니다.' };
  }

  return { status: 'healthy', reason: '최신 상태입니다.' };
}

function statusSortOrder(status: Exclude<RagDocumentStatus, 'healthy'>): number {
  if (status === 'missing') return 0;
  if (status === 'stale') return 1;
  return 2;
}
