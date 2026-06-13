import type { TFile, Vault } from 'obsidian';
import { t } from '../i18n';
import type { RAGConfig, ChatConfig } from '../settings';
import { getRagCandidateFiles } from '../utils/vault';
import {
  planRagStatusFallback,
  planRagStatusRust,
  type RustRagStatusFileInput,
  type RustRagStatusRecordInput,
} from './rust-core';
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

  const input = {
    includedFiles: includedFiles.map(toRagStatusFileInput),
    records: fileIndexRecords.map(toRagStatusRecordInput),
    totalVaultFiles: allFiles.length,
    embeddingProvider: ragConfig.embeddingProvider,
    embeddingModel: ragConfig.embeddingModel,
    reasons: {
      missing: t('ragStatusMissingReason'),
      legacy: t('ragStatusLegacyReason'),
      staleFile: t('ragStatusStaleFileReason'),
      embeddingChanged: t('ragStatusEmbeddingChangedReason'),
    },
  };
  const plan = planRagStatusRust(input) ?? planRagStatusFallback(input);

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  return {
    ...plan,
    lastCalculatedAt: Date.now(),
  };
}

function toRagStatusFileInput(file: TFile): RustRagStatusFileInput {
  return {
    path: file.path,
    mtime: file.stat.mtime,
    size: file.stat.size,
  };
}

function toRagStatusRecordInput(record: FileIndexRecord): RustRagStatusRecordInput {
  return {
    filePath: record.filePath,
    sourceMtime: record.sourceMtime,
    sourceSize: record.sourceSize,
    contentHash: record.contentHash,
    indexedAt: record.indexedAt,
    embeddingProvider: record.embeddingProvider,
    embeddingModel: record.embeddingModel,
    hasCompleteMetadata: record.hasCompleteMetadata,
    vectorCount: record.vectorCount,
  };
}
