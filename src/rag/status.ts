import type { TFile, Vault } from 'obsidian';
import { t } from '../i18n';
import type { RAGConfig, ChatConfig } from '../settings';
import { getRagCandidateFiles, getRagFileInventory, type RagFileInventory } from '../utils/vault';
import {
  planRagStatusRust,
  type RustRagStatusFileInput,
  type RustRagStatusRecordInput,
} from './rust-core';
import type { FileIndexReadOptions, FileIndexRecord, VectorStore } from './store';

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
  /** unknownDocuments 중 현재 원문 읽기·디코딩 실패 수. 기존 공개 요약과 호환한다. */
  failedDocuments?: number;
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
  inventory?: RagFileInventory,
  options?: FileIndexReadOptions,
): Promise<RagStatusSummary> {
  const manifest = inventory ?? await getRagFileInventory(vault, ragConfig, chatConfig);
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  const fileIndexRecords = await vectorStore.getFileIndexRecords(options);
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  const input = {
    includedFiles: [
      ...manifest.candidates.map(toRagStatusFileInput),
      ...manifest.failures.map(({ file, reason }) => ({ ...toRagStatusFileInput(file), failureReason: reason })),
    ],
    records: fileIndexRecords.map(toRagStatusRecordInput),
    totalVaultFiles: manifest.totalVaultFiles,
    embeddingProvider: ragConfig.embeddingProvider,
    embeddingModel: ragConfig.embeddingModel,
    reasons: {
      missing: t('ragStatusMissingReason'),
      legacy: t('ragStatusLegacyReason'),
      staleFile: t('ragStatusStaleFileReason'),
      embeddingChanged: t('ragStatusEmbeddingChangedReason'),
    },
  };
  const plan = planRagStatusRust(input);
  if (!plan) throw new Error('Rust RAG status planning failed');

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
    ...(record.sourceMetadata?.completeness?.status === 'partial' ? { sourceIncomplete: true } : {}),
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
