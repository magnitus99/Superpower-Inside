import type { ToolDefinition } from '../llm/providers';
import { planNativeVaultToolRequestRust, type RustNativeVaultToolRequest } from '../rag/rust-core';
import type { SourceCitation } from '../chat/types';
import { t } from '../i18n';

export const NATIVE_VAULT_TOOL_NAME = 'superpower_inside';
export const NATIVE_VAULT_TOOL_LABEL = 'Superpower Inside';

export interface NativeVaultSearchHit {
  path: string;
  heading?: string;
  startLine: number;
  endLine?: number;
  preview: string;
  score?: number;
  citationStatus?: 'candidate' | 'verified';
}

export interface NativeVaultFileSummary {
  path: string;
  modifiedAt: number;
  size: number;
}

interface NativeVaultResultBase {
  citations: SourceCitation[];
}

export interface NativeVaultSearchResult extends NativeVaultResultBase {
  action: 'search';
  query: string;
  path: string;
  match: 'all' | 'any' | 'phrase';
  hits: NativeVaultSearchHit[];
  scannedFiles: number;
  unreadableFiles: number;
  totalHits: number;
  truncated: boolean;
}

export interface NativeVaultReadResult extends NativeVaultResultBase {
  action: 'read';
  path: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  truncated: boolean;
  content: string;
}

export interface NativeVaultListResult extends NativeVaultResultBase {
  action: 'list';
  path: string;
  exists: boolean;
  files: NativeVaultFileSummary[];
  nextCursor: number | null;
  total: number;
}

export interface NativeVaultLinksResult extends NativeVaultResultBase {
  action: 'links';
  path: string;
  direction: 'incoming' | 'outgoing' | 'both';
  outgoing: string[];
  incoming: string[];
}

export interface NativeVaultStatsResult extends NativeVaultResultBase {
  action: 'stats';
  fileCount: number;
  totalBytes: number;
}

export type NativeVaultToolResult =
  | NativeVaultSearchResult
  | NativeVaultReadResult
  | NativeVaultListResult
  | NativeVaultLinksResult
  | NativeVaultStatsResult;

export interface NativeVaultToolExecutionResult {
  displayText: string;
  modelText: string;
  citations: SourceCitation[];
}

export interface NativeVaultToolPort {
  search(
    request: Extract<RustNativeVaultToolRequest, { action: 'search' }>,
  ): Promise<NativeVaultSearchResult>;
  read(
    request: Extract<RustNativeVaultToolRequest, { action: 'read' }>,
  ): Promise<NativeVaultReadResult>;
  list(
    request: Extract<RustNativeVaultToolRequest, { action: 'list' }>,
  ): Promise<NativeVaultListResult>;
  links(
    request: Extract<RustNativeVaultToolRequest, { action: 'links' }>,
  ): Promise<NativeVaultLinksResult>;
  stats(
    request: Extract<RustNativeVaultToolRequest, { action: 'stats' }>,
  ): Promise<NativeVaultStatsResult>;
}

export interface NativeVaultToolRuntimeLike {
  isNativeTool(name: string): boolean;
  execute(argumentsText: string, signal?: AbortSignal): Promise<NativeVaultToolExecutionResult>;
}

export class NativeVaultToolRuntime implements NativeVaultToolRuntimeLike {
  constructor(private readonly port: NativeVaultToolPort) {}

  isNativeTool(name: string): boolean {
    return name === NATIVE_VAULT_TOOL_NAME;
  }

  async execute(
    argumentsText: string,
    signal?: AbortSignal,
  ): Promise<NativeVaultToolExecutionResult> {
    throwIfAborted(signal);
    const plan = planNativeVaultToolRequestRust(argumentsText);
    if (!plan) {
      throw new Error(t('nativeVaultPlanUnavailable'));
    }
    if (!plan.ok) {
      throw new Error(getRequestErrorMessage(plan.error.code));
    }

    const result = await this.executeRequest(plan.request);
    throwIfAborted(signal);
    return {
      displayText: formatDisplayText(result),
      modelText: JSON.stringify(result),
      citations: result.citations,
    };
  }

  private executeRequest(request: RustNativeVaultToolRequest): Promise<NativeVaultToolResult> {
    switch (request.action) {
      case 'search':
        return this.port.search(request);
      case 'read':
        return this.port.read(request);
      case 'list':
        return this.port.list(request);
      case 'links':
        return this.port.links(request);
      case 'stats':
        return this.port.stats(request);
    }
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException(t('cancelledLabel'), 'AbortError');
}

export function createNativeVaultToolDefinition(): ToolDefinition {
  return {
    type: 'function',
    function: {
      name: NATIVE_VAULT_TOOL_NAME,
      description:
        'Explore read-only files selected by the current RAG indexing policy. Search and list results are bounded candidates, not proof of exhaustive coverage. Search defaults to matching all meaningful terms; use match="any" for alternatives instead of writing OR in the query. Follow list nextCursor pages and bounded reads before claiming complete coverage. Configured excluded paths and extensions, the chat save folder when enabled, and files rejected as sensitive, binary, empty, or unreadable are omitted.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['action'],
        properties: {
          action: {
            type: 'string',
            enum: ['search', 'read', 'list', 'links', 'stats'],
            description: 'Read-only action to perform',
          },
          query: {
            type: 'string',
            maxLength: 512,
            description: 'Focused search query for the search action (up to 32 lexical terms)',
          },
          match: {
            type: 'string',
            enum: ['all', 'any', 'phrase'],
            description:
              'Search matching policy. all is the precise default, any is for alternatives, and phrase requires the exact phrase.',
          },
          path: { type: 'string', description: 'Vault-relative file or folder path' },
          start_line: { type: 'integer', minimum: 1, description: 'First line to read' },
          end_line: { type: 'integer', minimum: 1, description: 'Last line to read' },
          cursor: { type: 'integer', minimum: 0, description: 'List page cursor' },
          limit: { type: 'integer', minimum: 1, description: 'Maximum result count' },
          direction: {
            type: 'string',
            enum: ['incoming', 'outgoing', 'both'],
            description: 'Link traversal direction',
          },
        },
      },
    },
  };
}

function getRequestErrorMessage(code: string): string {
  switch (code) {
    case 'invalid_json':
      return t('nativeVaultInvalidJson');
    case 'unsupported_action':
      return t('nativeVaultUnsupportedAction');
    case 'query_required':
      return t('nativeVaultQueryRequired');
    case 'query_too_long':
      return t('nativeVaultQueryTooLong');
    case 'query_too_many_terms':
      return t('nativeVaultQueryTooManyTerms');
    case 'path_required':
      return t('nativeVaultPathRequired');
    case 'invalid_path':
      return t('nativeVaultInvalidPath');
    case 'invalid_line_range':
      return t('nativeVaultInvalidLineRange');
    case 'invalid_direction':
      return t('nativeVaultInvalidDirection');
    case 'invalid_match':
      return t('nativeVaultInvalidMatch');
    default:
      return t('nativeVaultInvalidArguments');
  }
}

function formatDisplayText(result: NativeVaultToolResult): string {
  switch (result.action) {
    case 'search':
      return t('nativeVaultSearchDisplay', { count: String(result.hits.length) });
    case 'read':
      return t('nativeVaultReadDisplay', {
        path: result.path,
        start: String(result.startLine),
        end: String(result.endLine),
      });
    case 'list':
      return result.exists
        ? t('nativeVaultListDisplay', { count: String(result.files.length) })
        : t('nativeVaultListPathMissing', { path: result.path });
    case 'links':
      return t('nativeVaultLinksDisplay', {
        path: result.path,
        count: String(result.outgoing.length + result.incoming.length),
      });
    case 'stats':
      return t('nativeVaultStatsDisplay', { count: String(result.fileCount) });
  }
}
