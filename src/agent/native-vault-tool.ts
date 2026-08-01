import type { ToolDefinition } from '../llm/providers';
import { planNativeVaultToolRequestRust, type RustNativeVaultToolRequest } from '../rag/rust-core';
import type { SourceCitation, SourceSelectionReason } from '../chat/types';
import { t } from '../i18n';
import { truncateUtf8Text } from '../utils/text-budget';

export const NATIVE_VAULT_TOOL_NAME = 'superpower_inside';
export const NATIVE_VAULT_TOOL_LABEL = 'Superpower Inside';
const MAX_NATIVE_MODEL_RESULT_BYTES = 64 * 1024;
export const NATIVE_VAULT_NAMED_TOOL_NAMES = {
  search: 'superpower_inside_search',
  read: 'superpower_inside_read',
  list: 'superpower_inside_list',
  links: 'superpower_inside_links',
  stats: 'superpower_inside_stats',
} as const;

type NativeVaultToolAction = RustNativeVaultToolRequest['action'];
export type NativeVaultNamedToolName =
  (typeof NATIVE_VAULT_NAMED_TOOL_NAMES)[keyof typeof NATIVE_VAULT_NAMED_TOOL_NAMES];

const NATIVE_VAULT_ACTION_BY_TOOL_NAME: Readonly<
  Record<NativeVaultNamedToolName, NativeVaultToolAction>
> = {
  [NATIVE_VAULT_NAMED_TOOL_NAMES.search]: 'search',
  [NATIVE_VAULT_NAMED_TOOL_NAMES.read]: 'read',
  [NATIVE_VAULT_NAMED_TOOL_NAMES.list]: 'list',
  [NATIVE_VAULT_NAMED_TOOL_NAMES.links]: 'links',
  [NATIVE_VAULT_NAMED_TOOL_NAMES.stats]: 'stats',
};

export interface NativeVaultSearchHit {
  path: string;
  heading?: string;
  startLine: number;
  endLine?: number;
  preview: string;
  score?: number;
  retrievalSources?: string[];
  selectionReason?: SourceSelectionReason;
  matchedQueries?: string[];
  recommendedReadRange?: {
    startLine: number;
    endLine: number;
  };
  citationStatus?: 'candidate' | 'verified';
  requiresRead?: true;
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
  queries?: string[];
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
  startOffset?: number;
  nextStartLine?: number | null;
  nextStartOffset?: number | null;
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
  totalOutgoing?: number;
  totalIncoming?: number;
  truncated?: boolean;
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
    signal?: AbortSignal,
  ): Promise<NativeVaultSearchResult>;
  read(
    request: Extract<RustNativeVaultToolRequest, { action: 'read' }>,
    signal?: AbortSignal,
  ): Promise<NativeVaultReadResult>;
  list(
    request: Extract<RustNativeVaultToolRequest, { action: 'list' }>,
    signal?: AbortSignal,
  ): Promise<NativeVaultListResult>;
  links(
    request: Extract<RustNativeVaultToolRequest, { action: 'links' }>,
    signal?: AbortSignal,
  ): Promise<NativeVaultLinksResult>;
  stats(
    request: Extract<RustNativeVaultToolRequest, { action: 'stats' }>,
    signal?: AbortSignal,
  ): Promise<NativeVaultStatsResult>;
}

export interface NativeVaultToolRuntimeLike {
  isNativeTool(name: string): boolean;
  execute(
    argumentsText: string,
    signal?: AbortSignal,
    toolName?: string,
  ): Promise<NativeVaultToolExecutionResult>;
}

export class NativeVaultToolRuntime implements NativeVaultToolRuntimeLike {
  constructor(private readonly port: NativeVaultToolPort) {}

  isNativeTool(name: string): boolean {
    return name === NATIVE_VAULT_TOOL_NAME || resolveNamedNativeVaultAction(name) !== null;
  }

  async execute(
    argumentsText: string,
    signal?: AbortSignal,
    toolName: string = NATIVE_VAULT_TOOL_NAME,
  ): Promise<NativeVaultToolExecutionResult> {
    throwIfAborted(signal);
    const plannedArguments = prepareNativeVaultArguments(toolName, argumentsText);
    if (plannedArguments === null) {
      throw new Error(t('nativeVaultInvalidArguments'));
    }
    const plan = planNativeVaultToolRequestRust(plannedArguments);
    if (!plan) {
      throw new Error(t('nativeVaultPlanUnavailable'));
    }
    if (!plan.ok) {
      throw new Error(getRequestErrorMessage(plan.error.code));
    }

    const result = await this.executeRequest(plan.request, signal);
    throwIfAborted(signal);
    const bounded = boundNativeVaultModelResult(result);
    return {
      displayText: formatDisplayText(bounded.result),
      modelText: bounded.modelText,
      citations: bounded.result.citations,
    };
  }

  private executeRequest(
    request: RustNativeVaultToolRequest,
    signal?: AbortSignal,
  ): Promise<NativeVaultToolResult> {
    switch (request.action) {
      case 'search':
        return signal ? this.port.search(request, signal) : this.port.search(request);
      case 'read':
        return signal ? this.port.read(request, signal) : this.port.read(request);
      case 'list':
        return signal ? this.port.list(request, signal) : this.port.list(request);
      case 'links':
        return signal ? this.port.links(request, signal) : this.port.links(request);
      case 'stats':
        return signal ? this.port.stats(request, signal) : this.port.stats(request);
    }
  }
}

function boundNativeVaultModelResult(result: NativeVaultToolResult): {
  result: NativeVaultToolResult;
  modelText: string;
} {
  switch (result.action) {
    case 'read':
      return boundReadModelResult(result);
    case 'search':
      return boundSearchModelResult(result);
    case 'list':
      return boundListModelResult(result);
    case 'links':
      return boundLinksModelResult(result);
    case 'stats':
      return serializeBoundedNativeResult(result);
  }
}

function boundReadModelResult(result: NativeVaultReadResult): NativeVaultToolExecutionResultShape {
  const sanitized: NativeVaultReadResult = {
    ...result,
    citations: result.citations.slice(0, 1).map(boundCitationText),
  };
  const serialized = serializeNativeResult(sanitized);
  if (fitsNativeModelBudget(serialized)) return { result: sanitized, modelText: serialized };

  let low = 0;
  let high = new TextEncoder().encode(result.content).byteLength;
  let boundedResult = createReadPrefixResult(sanitized, '');
  let boundedText = serializeNativeResult(boundedResult);
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const prefix = truncateUtf8Text(result.content, middle, '').text;
    const candidate = createReadPrefixResult(sanitized, prefix);
    const candidateText = serializeNativeResult(candidate);
    if (fitsNativeModelBudget(candidateText)) {
      boundedResult = candidate;
      boundedText = candidateText;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return ensureBoundedNativeResult(boundedResult, boundedText);
}

function createReadPrefixResult(
  result: NativeVaultReadResult,
  content: string,
): NativeVaultReadResult {
  const startOffset = result.startOffset ?? 0;
  const newlineCount = countNewlines(content);
  const lastNewline = content.lastIndexOf('\n');
  const nextStartLine = result.startLine + newlineCount;
  const nextStartOffset =
    newlineCount === 0 ? startOffset + content.length : content.length - lastNewline - 1;
  const endLine =
    content.endsWith('\n') && nextStartLine > result.startLine
      ? nextStartLine - 1
      : nextStartLine;
  const boundedEndLine = Math.max(result.startLine, endLine);
  return {
    ...result,
    startOffset,
    endLine: boundedEndLine,
    nextStartLine,
    nextStartOffset,
    truncated: true,
    content,
    citations: result.citations.map((citation) => ({
      ...citation,
      id: `vault:${result.path}:${result.startLine}-${boundedEndLine}`,
      line: result.startLine,
      endLine: boundedEndLine,
      preview: truncateUtf8Text(content, 1024, '').text,
    })),
  };
}

function boundSearchModelResult(
  result: NativeVaultSearchResult,
): NativeVaultToolExecutionResultShape {
  const hits = result.hits.map((hit) => ({
    ...hit,
    preview: truncateUtf8Text(hit.preview, 4 * 1024, '').text,
  }));
  const citations = result.citations.map(boundCitationText);
  let keep = hits.length;
  let candidate: NativeVaultSearchResult = { ...result, hits, citations };
  let candidateText = serializeNativeResult(candidate);
  while (!fitsNativeModelBudget(candidateText) && keep > 0) {
    keep -= 1;
    candidate = {
      ...result,
      hits: hits.slice(0, keep),
      citations: citations.slice(0, keep),
      truncated: true,
    };
    candidateText = serializeNativeResult(candidate);
  }
  return ensureBoundedNativeResult(candidate, candidateText);
}

function boundListModelResult(result: NativeVaultListResult): NativeVaultToolExecutionResultShape {
  const originalCount = result.files.length;
  const pageStart =
    result.nextCursor === null
      ? Math.max(0, result.total - originalCount)
      : Math.max(0, result.nextCursor - originalCount);
  let keep = originalCount;
  let candidate: NativeVaultListResult = { ...result, citations: [] };
  let candidateText = serializeNativeResult(candidate);
  while (!fitsNativeModelBudget(candidateText) && keep > 0) {
    keep -= 1;
    candidate = {
      ...result,
      files: result.files.slice(0, keep),
      nextCursor: pageStart + keep,
      citations: [],
    };
    candidateText = serializeNativeResult(candidate);
  }
  return ensureBoundedNativeResult(candidate, candidateText);
}

function boundLinksModelResult(result: NativeVaultLinksResult): NativeVaultToolExecutionResultShape {
  const outgoing = [...result.outgoing];
  const incoming = [...result.incoming];
  let candidate: NativeVaultLinksResult = { ...result, outgoing, incoming, citations: [] };
  let candidateText = serializeNativeResult(candidate);
  while (!fitsNativeModelBudget(candidateText) && (outgoing.length > 0 || incoming.length > 0)) {
    if (outgoing.length >= incoming.length && outgoing.length > 0) outgoing.pop();
    else incoming.pop();
    candidate = {
      ...result,
      outgoing: [...outgoing],
      incoming: [...incoming],
      totalOutgoing: result.totalOutgoing ?? result.outgoing.length,
      totalIncoming: result.totalIncoming ?? result.incoming.length,
      truncated: true,
      citations: [],
    };
    candidateText = serializeNativeResult(candidate);
  }
  return ensureBoundedNativeResult(candidate, candidateText);
}

type NativeVaultToolExecutionResultShape = {
  result: NativeVaultToolResult;
  modelText: string;
};

function serializeBoundedNativeResult(
  result: NativeVaultToolResult,
): NativeVaultToolExecutionResultShape {
  return ensureBoundedNativeResult(result, serializeNativeResult(result));
}

function ensureBoundedNativeResult<T extends NativeVaultToolResult>(
  result: T,
  modelText: string,
): { result: T; modelText: string } {
  if (!fitsNativeModelBudget(modelText)) throw new Error(t('nativeVaultPlanUnavailable'));
  return { result, modelText };
}

function serializeNativeResult(result: NativeVaultToolResult): string {
  return JSON.stringify(result);
}

function fitsNativeModelBudget(value: string): boolean {
  return new TextEncoder().encode(value).byteLength <= MAX_NATIVE_MODEL_RESULT_BYTES;
}

function boundCitationText(citation: SourceCitation): SourceCitation {
  return {
    ...citation,
    preview: truncateUtf8Text(citation.preview, 1024, '').text,
    ...(citation.detail
      ? { detail: truncateUtf8Text(citation.detail, 1024, '').text }
      : {}),
  };
}

function countNewlines(value: string): number {
  let count = 0;
  for (const character of value) {
    if (character === '\n') count += 1;
  }
  return count;
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
          queries: {
            type: 'array',
            maxItems: 3,
            items: { type: 'string', maxLength: 512 },
            description:
              'Optional alternate phrasings. After normalization and de-duplication, query plus variants may contain at most 4 queries, each with at most 32 lexical terms.',
          },
          match: {
            type: 'string',
            enum: ['all', 'any', 'phrase'],
            description:
              'Search matching policy. all is the precise default, any is for alternatives, and phrase requires the exact phrase.',
          },
          path: { type: 'string', description: 'Vault-relative file or folder path' },
          start_line: { type: 'integer', minimum: 1, description: 'First line to read' },
          start_offset: {
            type: 'integer',
            minimum: 0,
            description: 'Opaque continuation offset returned by a previous truncated read',
          },
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

export function createNativeVaultToolDefinitions(): ToolDefinition[] {
  return [
    createActionToolDefinition(
      NATIVE_VAULT_NAMED_TOOL_NAMES.search,
      'Find up to 20 ranked candidate passages in files allowed by the current vault indexing policy. Search hits are locators, not verified evidence: every hit requires a follow-up superpower_inside_read call with its path and line range before it supports an answer. Use focused terms; match defaults to all for the emergency lexical fallback, any accepts alternatives, and phrase requests an exact phrase.',
      {
        required: ['query'],
        properties: {
          query: {
            type: 'string',
            maxLength: 512,
            description: 'Focused search query containing at most 32 lexical terms',
          },
          queries: {
            type: 'array',
            maxItems: 3,
            items: { type: 'string', maxLength: 512 },
            description:
              'Optional alternate phrasings. Query plus de-duplicated variants may contain at most 4 bounded queries.',
          },
          match: {
            type: 'string',
            enum: ['all', 'any', 'phrase'],
            description: 'Fallback lexical matching policy; defaults to all',
          },
          path: {
            type: 'string',
            description: 'Optional vault-relative folder prefix that narrows the search',
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 20,
            description: 'Maximum candidate count; defaults to 8',
          },
        },
      },
    ),
    createActionToolDefinition(
      NATIVE_VAULT_NAMED_TOOL_NAMES.read,
      'Read current vault text from one allowed file. This is the verification step for search or link candidates. At most 400 inclusive lines are returned per call. When truncated is true, copy nextStartLine to start_line and nextStartOffset to start_offset so no content is skipped.',
      {
        required: ['path'],
        properties: {
          path: {
            type: 'string',
            description: 'Vault-relative file path returned by search, list, or links',
          },
          start_line: {
            type: 'integer',
            minimum: 1,
            description: 'First one-based line to read; defaults to 1',
          },
          start_offset: {
            type: 'integer',
            minimum: 0,
            description:
              'Opaque continuation offset returned as nextStartOffset; omit on the first read',
          },
          end_line: {
            type: 'integer',
            minimum: 1,
            description:
              'Optional last one-based line to read; the runtime still caps each call at 400 lines',
          },
        },
      },
    ),
    createActionToolDefinition(
      NATIVE_VAULT_NAMED_TOOL_NAMES.list,
      'List one stable page of up to 100 allowed vault files under a folder. Returned paths are inventory metadata, not content evidence. Follow nextCursor pages until it is null before making an exhaustive inventory claim, and use superpower_inside_read for file contents.',
      {
        required: [],
        properties: {
          path: {
            type: 'string',
            description: 'Optional vault-relative folder path; omit for the vault root',
          },
          cursor: {
            type: 'integer',
            minimum: 0,
            description: 'Page cursor returned as nextCursor by the previous call; defaults to 0',
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 100,
            description: 'Maximum paths in this page; defaults to 50',
          },
        },
      },
    ),
    createActionToolDefinition(
      NATIVE_VAULT_NAMED_TOOL_NAMES.links,
      'Find up to 100 visible incoming or outgoing vault links for one allowed file. Link paths are structural candidates, not content evidence; call superpower_inside_read on the relevant files before using their contents in an answer.',
      {
        required: ['path'],
        properties: {
          path: {
            type: 'string',
            description: 'Vault-relative source file path',
          },
          direction: {
            type: 'string',
            enum: ['incoming', 'outgoing', 'both'],
            description: 'Link direction; defaults to both',
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: 100,
            description: 'Maximum paths returned per direction; defaults to 50',
          },
        },
      },
    ),
    createActionToolDefinition(
      NATIVE_VAULT_NAMED_TOOL_NAMES.stats,
      'Return the file count and total bytes visible to the current vault indexing policy. This aggregate describes scope only and does not verify any file content.',
      {
        required: [],
        properties: {},
      },
    ),
  ];
}

function createActionToolDefinition(
  name: NativeVaultNamedToolName,
  description: string,
  schema: {
    required: readonly string[];
    properties: Record<string, unknown>;
  },
): ToolDefinition {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: [...schema.required],
        properties: schema.properties,
      },
    },
  };
}

export function resolveNamedNativeVaultAction(name: string): NativeVaultToolAction | null {
  return Object.hasOwn(NATIVE_VAULT_ACTION_BY_TOOL_NAME, name)
    ? NATIVE_VAULT_ACTION_BY_TOOL_NAME[name as NativeVaultNamedToolName]
    : null;
}

function prepareNativeVaultArguments(toolName: string, argumentsText: string): string | null {
  if (toolName === NATIVE_VAULT_TOOL_NAME) return argumentsText;
  const action = resolveNamedNativeVaultAction(toolName);
  if (action === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(argumentsText);
  } catch {
    return argumentsText;
  }
  if (!isUnknownRecord(parsed)) return argumentsText;
  return JSON.stringify({ ...parsed, action });
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
    case 'query_variants_too_many':
      return t('nativeVaultQueryVariantsTooMany');
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
