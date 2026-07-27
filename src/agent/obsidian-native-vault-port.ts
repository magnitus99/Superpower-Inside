import { TFile, TFolder, type App } from 'obsidian';
import type { QueryResult } from '../rag/query';
import {
  createContextPreviewRust,
  planFolderLexicalEvidenceIndicesRust,
  planNativeVaultLexicalHitRust,
  planNativeVaultLinkPathsRust,
  planNativeVaultListRust,
  planNativeVaultReadRangeRust,
  planNativeVaultStatsRust,
  type RustNativeVaultToolRequest,
} from '../rag/rust-core';
import type { SourceCitation } from '../chat/types';
import { t } from '../i18n';
import type {
  NativeVaultLinksResult,
  NativeVaultListResult,
  NativeVaultReadResult,
  NativeVaultSearchHit,
  NativeVaultSearchResult,
  NativeVaultStatsResult,
  NativeVaultToolPort,
} from './native-vault-tool';

const MAX_READ_LINES = 400;
const LEXICAL_READ_BATCH_SIZE = 8;

export interface NativeVaultQueryEngineLike {
  query(
    question: string,
    topK: number,
    minScore?: number,
    filePathPrefixes?: readonly string[],
  ): Promise<QueryResult[]>;
}

export interface NativeVaultFileScope {
  listCandidateFiles(): Promise<readonly TFile[]>;
  isCandidateFile(file: TFile): Promise<boolean>;
  isPathVisible(path: string): boolean;
}

interface NativeVaultListSnapshot {
  path: string;
  expectedCursor: number;
  files: readonly TFile[];
}

export class ObsidianNativeVaultToolPort implements NativeVaultToolPort {
  private listSnapshot: NativeVaultListSnapshot | null = null;

  constructor(
    private readonly app: App,
    private readonly fileScope: NativeVaultFileScope,
    private readonly getQueryEngine: () => NativeVaultQueryEngineLike | null = () => null,
  ) {}

  async search(
    request: Extract<RustNativeVaultToolRequest, { action: 'search' }>,
  ): Promise<NativeVaultSearchResult> {
    const files = await this.fileScope.listCandidateFiles();
    const candidatePaths = new Set(files.map((file) => file.path));
    const lexical = await this.searchLexically(request, files);
    if (lexical.hits.length >= request.limit) return lexical;

    const indexed = (await this.tryIndexedSearch(request)).filter((result) =>
      candidatePaths.has(result.sourcePath),
    );
    const semanticMatchIndices =
      planFolderLexicalEvidenceIndicesRust(
        request.query,
        indexed.map(
          (result) =>
            `${result.sourcePath}\n${result.entry.metadata.heading ?? ''}\n${result.entry.metadata.text}`,
        ),
        indexed.length,
        request.match,
      ) ?? [];
    const semantic = buildSearchResult(
      request.query,
      request.path,
      request.match,
      semanticMatchIndices.flatMap((index) => {
        const result = indexed[index];
        return result ? [result] : [];
      }),
      {
        scannedFiles: lexical.scannedFiles,
        unreadableFiles: lexical.unreadableFiles,
      },
    );
    const hits = [...lexical.hits];
    const seen = new Set(hits.map(searchHitKey));
    const semanticUniqueHitCount = semantic.hits.filter(
      (hit) => !seen.has(searchHitKey(hit)),
    ).length;
    for (const hit of semantic.hits) {
      if (hits.length >= request.limit) break;
      const key = searchHitKey(hit);
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push(hit);
    }
    const totalHits = lexical.totalHits + semanticUniqueHitCount;
    return buildSearchResult(request.query, request.path, request.match, hits, {
      scannedFiles: lexical.scannedFiles,
      unreadableFiles: lexical.unreadableFiles,
      totalHits,
      truncated:
        lexical.truncated || semantic.hits.length >= request.limit || totalHits > hits.length,
    });
  }

  async read(
    request: Extract<RustNativeVaultToolRequest, { action: 'read' }>,
  ): Promise<NativeVaultReadResult> {
    const file = this.resolveVaultFile(request.path);
    if (!file || !(await this.fileScope.isCandidateFile(file))) {
      throw new Error(t('nativeVaultFileNotFound', { path: request.path }));
    }
    const content = await this.app.vault.cachedRead(file);
    const lines = content.split('\n');
    const range = planNativeVaultReadRangeRust(
      lines.length,
      request.startLine,
      request.endLine,
      MAX_READ_LINES,
    );
    if (!range) throw new Error(t('nativeVaultReadRangeFailed', { path: request.path }));
    const selectedContent = lines.slice(range.startLine - 1, range.endLine).join('\n');
    const citation = createCitation(
      file.path,
      range.startLine,
      range.endLine,
      createContextPreviewRust(selectedContent) ?? '',
    );
    return {
      action: 'read',
      path: file.path,
      startLine: range.startLine,
      endLine: range.endLine,
      totalLines: lines.length,
      truncated: range.truncated,
      content: selectedContent,
      citations: [citation],
    };
  }

  async list(
    request: Extract<RustNativeVaultToolRequest, { action: 'list' }>,
  ): Promise<NativeVaultListResult> {
    const files = await this.getListCandidateFiles(request.path, request.cursor);
    const plan = planNativeVaultListRust(
      files.map((file) => file.path),
      request.path,
      request.cursor,
      request.limit,
    );
    if (!plan) {
      this.listSnapshot = null;
      throw new Error(t('nativeVaultListFailed'));
    }
    this.listSnapshot =
      plan.nextCursor === null
        ? null
        : {
            path: request.path,
            expectedCursor: plan.nextCursor,
            files,
          };
    const filesByPath = new Map(files.map((file) => [file.path, file]));
    const requestedPath = this.app.vault.getAbstractFileByPath(request.path);
    return {
      action: 'list',
      path: request.path,
      exists:
        this.fileScope.isPathVisible(request.path) &&
        (request.path.length === 0 || plan.total > 0 || requestedPath instanceof TFolder),
      files: plan.paths.flatMap((path) => {
        const file = filesByPath.get(path);
        return file ? [{ path: file.path, modifiedAt: file.stat.mtime, size: file.stat.size }] : [];
      }),
      nextCursor: plan.nextCursor,
      total: plan.total,
      citations: [],
    };
  }

  async links(
    request: Extract<RustNativeVaultToolRequest, { action: 'links' }>,
  ): Promise<NativeVaultLinksResult> {
    const files = await this.fileScope.listCandidateFiles();
    const candidatePaths = new Set(files.map((candidate) => candidate.path));
    const file = this.resolveCandidateFile(request.path, files);
    if (!file) throw new Error(t('nativeVaultFileNotFound', { path: request.path }));
    const resolvedLinks = this.app.metadataCache.resolvedLinks;
    const outgoingCandidates = Object.keys(resolvedLinks[file.path] ?? {}).filter((path) =>
      candidatePaths.has(path),
    );
    const incomingCandidates = Object.entries(resolvedLinks).flatMap(([sourcePath, targets]) =>
      Object.hasOwn(targets, file.path) && candidatePaths.has(sourcePath) ? [sourcePath] : [],
    );
    const outgoing =
      request.direction === 'incoming'
        ? []
        : (planNativeVaultLinkPathsRust(outgoingCandidates, request.limit) ?? []);
    const incoming =
      request.direction === 'outgoing'
        ? []
        : (planNativeVaultLinkPathsRust(incomingCandidates, request.limit) ?? []);
    return {
      action: 'links',
      path: file.path,
      direction: request.direction,
      outgoing,
      incoming,
      citations: [],
    };
  }

  async stats(
    _request: Extract<RustNativeVaultToolRequest, { action: 'stats' }>,
  ): Promise<NativeVaultStatsResult> {
    const files = await this.fileScope.listCandidateFiles();
    const plan = planNativeVaultStatsRust(files.map((file) => file.stat.size));
    if (!plan) throw new Error(t('nativeVaultStatsFailed'));
    return { action: 'stats', ...plan, citations: [] };
  }

  private async tryIndexedSearch(
    request: Extract<RustNativeVaultToolRequest, { action: 'search' }>,
  ): Promise<QueryResult[]> {
    const engine = this.getQueryEngine();
    if (!engine) return [];
    try {
      return await engine.query(
        request.query,
        request.limit,
        undefined,
        request.path ? [request.path] : undefined,
      );
    } catch {
      return [];
    }
  }

  private async searchLexically(
    request: Extract<RustNativeVaultToolRequest, { action: 'search' }>,
    files: readonly TFile[],
  ): Promise<NativeVaultSearchResult> {
    const scope = planNativeVaultListRust(
      files.map((file) => file.path),
      request.path,
      0,
      files.length,
    );
    if (!scope) throw new Error(t('nativeVaultSearchScopeFailed'));
    const filesByPath = new Map(files.map((file) => [file.path, file]));
    const readable: Array<{ file: TFile; content: string }> = [];
    for (let offset = 0; offset < scope.paths.length; offset += LEXICAL_READ_BATCH_SIZE) {
      const batch = scope.paths.slice(offset, offset + LEXICAL_READ_BATCH_SIZE);
      const entries = await Promise.all(
        batch.map(async (path) => {
          const file = filesByPath.get(path);
          if (!file) return null;
          try {
            return { file, content: await this.app.vault.cachedRead(file) };
          } catch {
            return null;
          }
        }),
      );
      readable.push(
        ...entries.filter((entry): entry is { file: TFile; content: string } => entry !== null),
      );
    }
    const matchingIndices =
      planFolderLexicalEvidenceIndicesRust(
        request.query,
        readable.map(({ file, content }) => `${file.path}\n${content}`),
        readable.length,
        request.match,
      ) ?? [];
    const hits = matchingIndices.slice(0, request.limit).flatMap((index) => {
      const entry = readable[index];
      if (!entry) return [];
      const evidence = planNativeVaultLexicalHitRust(request.query, entry.content, request.match);
      return [
        {
          path: entry.file.path,
          startLine: evidence?.startLine ?? 1,
          endLine: evidence?.endLine,
          preview: evidence?.preview ?? createContextPreviewRust(entry.content) ?? '',
          citationStatus: evidence?.status ?? 'candidate',
        },
      ];
    });
    return buildSearchResult(request.query, request.path, request.match, hits, {
      scannedFiles: scope.paths.length,
      unreadableFiles: scope.paths.length - readable.length,
      totalHits: matchingIndices.length,
      truncated: matchingIndices.length > hits.length,
    });
  }

  private async getListCandidateFiles(path: string, cursor: number): Promise<readonly TFile[]> {
    const snapshot = this.listSnapshot;
    if (cursor > 0 && snapshot?.path === path && snapshot.expectedCursor === cursor) {
      return snapshot.files;
    }
    this.listSnapshot = null;
    return this.fileScope.listCandidateFiles();
  }

  private resolveCandidateFile(path: string, files: readonly TFile[]): TFile | null {
    const filesByPath = new Map(files.map((file) => [file.path, file]));
    const resolved = this.resolveVaultFile(path);
    return resolved ? (filesByPath.get(resolved.path) ?? null) : null;
  }

  private resolveVaultFile(path: string): TFile | null {
    const candidates = path.endsWith('.md') ? [path] : [path, `${path}.md`];
    for (const candidate of candidates) {
      const file = this.app.vault.getAbstractFileByPath(candidate);
      if (file instanceof TFile) return file;
    }
    const resolved = this.app.metadataCache.getFirstLinkpathDest(path, '');
    return resolved instanceof TFile ? resolved : null;
  }
}

function searchHitKey(hit: NativeVaultSearchHit): string {
  return `${hit.path}:${hit.startLine}:${hit.endLine ?? hit.startLine}`;
}

function buildSearchResult(
  query: string,
  path: string,
  match: 'all' | 'any' | 'phrase',
  rawHits: readonly QueryResult[] | readonly NativeVaultSearchHit[],
  coverage: {
    scannedFiles?: number;
    unreadableFiles?: number;
    totalHits?: number;
    truncated?: boolean;
  } = {},
): NativeVaultSearchResult {
  const hits = rawHits.map((rawHit): NativeVaultSearchHit => {
    if ('entry' in rawHit) {
      const evidence = planNativeVaultLexicalHitRust(query, rawHit.entry.metadata.text, match);
      const startLine =
        evidence === null
          ? rawHit.chunkRange.startLine
          : rawHit.chunkRange.startLine + evidence.startLine - 1;
      const endLine =
        evidence === null
          ? rawHit.chunkRange.endLine
          : rawHit.chunkRange.startLine + evidence.endLine - 1;
      return {
        path: rawHit.sourcePath,
        heading: rawHit.entry.metadata.heading,
        startLine,
        endLine,
        preview: evidence?.preview ?? createContextPreviewRust(rawHit.entry.metadata.text) ?? '',
        score: rawHit.score,
        // 인덱스 내용은 현재 Vault 본문과 다를 수 있으므로 live read 전에는 검증하지 않습니다.
        citationStatus: 'candidate',
      };
    }
    return rawHit;
  });
  const citations = hits.map((hit) =>
    createCitation(
      hit.path,
      hit.startLine,
      hit.endLine,
      hit.preview,
      hit.heading,
      hit.score,
      hit.citationStatus,
    ),
  );
  const totalHits = coverage.totalHits ?? hits.length;
  return {
    action: 'search',
    query,
    path,
    match,
    hits,
    scannedFiles: coverage.scannedFiles ?? 0,
    unreadableFiles: coverage.unreadableFiles ?? 0,
    totalHits,
    truncated: coverage.truncated ?? totalHits > hits.length,
    citations,
  };
}

function createCitation(
  filePath: string,
  line: number,
  endLine: number | undefined,
  preview: string,
  heading?: string,
  score?: number,
  status: SourceCitation['status'] = 'verified',
): SourceCitation {
  const range = `${line}-${endLine ?? line}`;
  return {
    id: `vault:${filePath}:${range}`,
    filePath,
    heading,
    line,
    endLine,
    score,
    preview,
    status,
  };
}
