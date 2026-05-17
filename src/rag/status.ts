import type { TFile, Vault } from 'obsidian';
import type { RAGConfig, ChatConfig } from '../settings';
import { getRagCandidateFiles } from '../utils/vault';
import type { VectorEntry, VectorStore } from './store';

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

export async function calculateRagStatus(
  vault: Vault,
  vectorStore: VectorStore,
  ragConfig: RAGConfig,
  chatConfig: ChatConfig,
): Promise<RagStatusSummary> {
  const includedFiles = await getIncludedRagFiles(vault, ragConfig, chatConfig);
  const allFiles = vault.getFiles();
  const entries = await vectorStore.getEntries();
  const entriesByPath = groupEntriesByPath(entries);

  const updateRequiredDocuments: RagDocumentUpdate[] = [];
  let healthyDocuments = 0;
  let missingDocuments = 0;
  let staleDocuments = 0;
  let unknownDocuments = 0;

  for (const file of includedFiles) {
    const state = getFileIndexState(file, entriesByPath.get(file.path) ?? [], ragConfig);
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
    totalVectors: entries.length,
    lastCalculatedAt: Date.now(),
    updateRequiredDocuments,
  };
}

function groupEntriesByPath(entries: VectorEntry[]): Map<string, VectorEntry[]> {
  const grouped = new Map<string, VectorEntry[]>();
  for (const entry of entries) {
    const path = entry.metadata.filePath;
    const existing = grouped.get(path);
    if (existing) {
      existing.push(entry);
    } else {
      grouped.set(path, [entry]);
    }
  }
  return grouped;
}

function getFileIndexState(
  file: TFile,
  entries: VectorEntry[],
  ragConfig: RAGConfig,
): FileIndexState {
  if (entries.length === 0) {
    return { status: 'missing', reason: '아직 인덱싱되지 않았습니다.' };
  }

  const hasLegacyEntry = entries.some(
    (entry) =>
      typeof entry.metadata.sourceMtime !== 'number' ||
      typeof entry.metadata.sourceSize !== 'number' ||
      typeof entry.metadata.embeddingProvider !== 'string' ||
      typeof entry.metadata.embeddingModel !== 'string',
  );
  if (hasLegacyEntry) {
    return {
      status: 'unknown',
      reason: '이전 형식의 벡터라 파일 변경 여부를 확인할 수 없습니다.',
    };
  }

  const hasDifferentSource = entries.some(
    (entry) =>
      entry.metadata.sourceMtime !== file.stat.mtime || entry.metadata.sourceSize !== file.stat.size,
  );
  if (hasDifferentSource) {
    return { status: 'stale', reason: '파일이 마지막 인덱싱 이후 수정되었습니다.' };
  }

  const hasDifferentEmbedding = entries.some(
    (entry) =>
      entry.metadata.embeddingProvider !== ragConfig.embeddingProvider ||
      entry.metadata.embeddingModel !== ragConfig.embeddingModel,
  );
  if (hasDifferentEmbedding) {
    return { status: 'stale', reason: '현재 임베딩 설정과 저장된 벡터 설정이 다릅니다.' };
  }

  return { status: 'healthy', reason: '최신 상태입니다.' };
}

function statusSortOrder(status: Exclude<RagDocumentStatus, 'healthy'>): number {
  if (status === 'missing') return 0;
  if (status === 'stale') return 1;
  return 2;
}
