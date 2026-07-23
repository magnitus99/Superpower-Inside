import { TFile, type App } from 'obsidian';
import type { QueryResult } from '../rag/query';
import {
  createContextPreviewRust,
  planFolderLexicalEvidenceIndicesRust,
  planNativeVaultLinkPathsRust,
  planNativeVaultListRust,
  planNativeVaultReadRangeRust,
  planNativeVaultStatsRust,
  type RustNativeVaultToolRequest,
} from '../rag/rust-core';
import type { SourceCitation } from '../chat/types';
import { t } from '../i18n';
import { isExcludedPath } from '../utils/vault';
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

export class ObsidianNativeVaultToolPort implements NativeVaultToolPort {
  constructor(
    private readonly app: App,
    private readonly getQueryEngine: () => NativeVaultQueryEngineLike | null = () => null,
    private readonly getExcludedPaths: () => readonly string[] = () => [],
  ) {}

  async search(
    request: Extract<RustNativeVaultToolRequest, { action: 'search' }>,
  ): Promise<NativeVaultSearchResult> {
    const lexical = await this.searchLexically(request);
    if (lexical.hits.length >= request.limit) return lexical;

    const indexed = (await this.tryIndexedSearch(request)).filter((result) =>
      this.isVisiblePath(result.sourcePath),
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
      request.match,
      semanticMatchIndices.flatMap((index) => {
        const result = indexed[index];
        return result ? [result] : [];
      }),
    );
    const hits = [...lexical.hits];
    const seen = new Set(hits.map(searchHitKey));
    for (const hit of semantic.hits) {
      if (hits.length >= request.limit) break;
      const key = searchHitKey(hit);
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push(hit);
    }
    return buildSearchResult(request.query, request.match, hits);
  }

  async read(
    request: Extract<RustNativeVaultToolRequest, { action: 'read' }>,
  ): Promise<NativeVaultReadResult> {
    const file = this.resolveMarkdownFile(request.path);
    if (!file) throw new Error(t('nativeVaultFileNotFound', { path: request.path }));
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

  list(
    request: Extract<RustNativeVaultToolRequest, { action: 'list' }>,
  ): Promise<NativeVaultListResult> {
    const files = this.getVisibleMarkdownFiles();
    const plan = planNativeVaultListRust(
      files.map((file) => file.path),
      request.path,
      request.cursor,
      request.limit,
    );
    if (!plan) throw new Error(t('nativeVaultListFailed'));
    const filesByPath = new Map(files.map((file) => [file.path, file]));
    return Promise.resolve({
      action: 'list',
      path: request.path,
      exists:
        this.isVisiblePath(request.path) &&
        (request.path.length === 0 ||
          plan.total > 0 ||
          this.app.vault.getAbstractFileByPath(request.path) !== null),
      files: plan.paths.flatMap((path) => {
        const file = filesByPath.get(path);
        return file ? [{ path: file.path, modifiedAt: file.stat.mtime, size: file.stat.size }] : [];
      }),
      nextCursor: plan.nextCursor,
      total: plan.total,
      citations: [],
    });
  }

  links(
    request: Extract<RustNativeVaultToolRequest, { action: 'links' }>,
  ): Promise<NativeVaultLinksResult> {
    const file = this.resolveMarkdownFile(request.path);
    if (!file) throw new Error(t('nativeVaultFileNotFound', { path: request.path }));
    const resolvedLinks = this.app.metadataCache.resolvedLinks;
    const outgoingCandidates = Object.keys(resolvedLinks[file.path] ?? {}).filter((path) =>
      this.isVisiblePath(path),
    );
    const incomingCandidates = Object.entries(resolvedLinks).flatMap(([sourcePath, targets]) =>
      Object.hasOwn(targets, file.path) && this.isVisiblePath(sourcePath) ? [sourcePath] : [],
    );
    const outgoing =
      request.direction === 'incoming'
        ? []
        : (planNativeVaultLinkPathsRust(outgoingCandidates, request.limit) ?? []);
    const incoming =
      request.direction === 'outgoing'
        ? []
        : (planNativeVaultLinkPathsRust(incomingCandidates, request.limit) ?? []);
    return Promise.resolve({
      action: 'links',
      path: file.path,
      direction: request.direction,
      outgoing,
      incoming,
      citations: [],
    });
  }

  stats(
    _request: Extract<RustNativeVaultToolRequest, { action: 'stats' }>,
  ): Promise<NativeVaultStatsResult> {
    const plan = planNativeVaultStatsRust(
      this.getVisibleMarkdownFiles().map((file) => file.stat.size),
    );
    if (!plan) return Promise.reject(new Error(t('nativeVaultStatsFailed')));
    return Promise.resolve({ action: 'stats', ...plan, citations: [] });
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
  ): Promise<NativeVaultSearchResult> {
    const files = this.getVisibleMarkdownFiles();
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
    const selectedIndices =
      planFolderLexicalEvidenceIndicesRust(
        request.query,
        readable.map(({ file, content }) => `${file.path}\n${content}`),
        request.limit,
        request.match,
      ) ?? [];
    const hits = selectedIndices.flatMap((index) => {
      const entry = readable[index];
      if (!entry) return [];
      return [
        {
          path: entry.file.path,
          startLine: 1,
          preview: createContextPreviewRust(entry.content) ?? '',
        },
      ];
    });
    return buildSearchResult(request.query, request.match, hits);
  }

  private getVisibleMarkdownFiles(): TFile[] {
    const excludedPaths = this.getExcludedPaths();
    return this.app.vault
      .getMarkdownFiles()
      .filter((file) => !isExcludedPath(file.path, excludedPaths));
  }

  private isVisiblePath(path: string): boolean {
    return !isExcludedPath(path, this.getExcludedPaths());
  }

  private resolveMarkdownFile(path: string): TFile | null {
    if (!this.isVisiblePath(path)) return null;
    const candidates = path.endsWith('.md') ? [path] : [path, `${path}.md`];
    for (const candidate of candidates) {
      const file = this.app.vault.getAbstractFileByPath(candidate);
      if (file instanceof TFile && this.isVisiblePath(file.path)) return file;
    }
    const resolved = this.app.metadataCache.getFirstLinkpathDest(path, '');
    return resolved instanceof TFile && this.isVisiblePath(resolved.path) ? resolved : null;
  }
}

function searchHitKey(hit: NativeVaultSearchHit): string {
  return `${hit.path}:${hit.startLine}:${hit.endLine ?? hit.startLine}`;
}

function buildSearchResult(
  query: string,
  match: 'all' | 'any' | 'phrase',
  rawHits: readonly QueryResult[] | readonly NativeVaultSearchHit[],
): NativeVaultSearchResult {
  const hits = rawHits.map((rawHit): NativeVaultSearchHit => {
    if ('entry' in rawHit) {
      return {
        path: rawHit.sourcePath,
        heading: rawHit.entry.metadata.heading,
        startLine: rawHit.chunkRange.startLine,
        endLine: rawHit.chunkRange.endLine,
        preview: createContextPreviewRust(rawHit.entry.metadata.text) ?? '',
        score: rawHit.score,
      };
    }
    return rawHit;
  });
  const citations = hits.map((hit) =>
    createCitation(hit.path, hit.startLine, hit.endLine, hit.preview, hit.heading, hit.score),
  );
  return { action: 'search', query, match, hits, citations };
}

function createCitation(
  filePath: string,
  line: number,
  endLine: number | undefined,
  preview: string,
  heading?: string,
  score?: number,
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
    status: 'verified',
  };
}
