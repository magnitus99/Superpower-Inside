import { t } from '../i18n';
import type { MCPServerConnectionStatus } from '../mcp/connection-state';
import { getContext7McpServerName } from '../mcp/context7';
import { planPluginAwareIndicesRust, selectPluginContext7LibraryIdRust } from '../rag/rust-core';
import type { MCPServerConfig } from '../settings';
import type { ActivePluginInfo } from '../utils/obsidian-compat';
import { selectByRustIndices } from '../utils/rust-index-plan';
import { truncateUtf8Text } from '../utils/text-budget';
import { appLogger } from '../utils/logger';
import { normalizeToolResult, isMcpToolResultEmpty } from './mcp-tools';
import type { MCPToolClientLike } from './mcp-tool-execution';
import type { ContextAttachment, ToolExecutionPolicy } from './types';

interface PluginDocumentationRegistry {
  getEnabledServers(): Pick<MCPServerConfig, 'name' | 'command' | 'args'>[];
  getConnectionStatus(name: string): MCPServerConnectionStatus;
  getClient(name: string): MCPToolClientLike | undefined;
}

interface PluginDocumentationOptions {
  enabled: boolean;
  question: string;
  previousQuestions: readonly string[];
  plugins: readonly ActivePluginInfo[];
  registry: PluginDocumentationRegistry | null;
  executionMode: ToolExecutionPolicy['mode'];
  approve: () => Promise<boolean>;
  signal?: AbortSignal;
}

export interface PluginDocumentationContext {
  failureMessage?: string;
  prompt: string;
  attachments: ContextAttachment[];
  serverNames: string[];
}

type DocumentationStatus = 'ready' | 'unavailable' | 'unmatched' | 'blocked' | 'failed';

/** 모델의 도구 호출 능력과 무관하게 관련 플러그인의 문서를 먼저 확보합니다. */
export async function buildPluginAwareDocumentation(
  options: PluginDocumentationOptions,
): Promise<PluginDocumentationContext | null> {
  if (!options.enabled) return null;
  const plugins = selectByRustIndices(
    options.plugins,
    planPluginAwareIndicesRust(options.question, options.previousQuestions, options.plugins) ??
      undefined,
  );
  if (plugins.length === 0) return null;
  if (plugins.length > 3) {
    return {
      failureMessage: t('pluginAwareDocumentationLimit'),
      prompt: '',
      attachments: [],
      serverNames: [],
    };
  }
  const serverName = getContext7McpServerName(options.registry?.getEnabledServers() ?? []);
  const client =
    serverName && options.registry?.getConnectionStatus(serverName) === 'connected'
      ? options.registry.getClient(serverName)
      : undefined;
  const records: {
    plugin: ActivePluginInfo;
    status: DocumentationStatus;
    libraryId?: string;
    documentation?: string;
    truncated?: boolean;
    detail?: string;
  }[] = [];
  const serverNames: string[] = [];
  checkAborted(options.signal);
  let allowed = true;
  if (client && options.executionMode === 'always-manual') {
    allowed = await options.approve();
    checkAborted(options.signal);
  }
  for (const plugin of plugins) {
    const record: (typeof records)[number] = { plugin, status: 'unavailable' };
    records.push(record);
    if (!client || !serverName) continue;
    if (!allowed) {
      record.status = 'blocked';
      continue;
    }
    try {
      const tools = await requestDocumentation(
        (signal) => client.listTools(signal),
        options.signal,
      );
      checkAborted(options.signal);
      if (
        !tools.some((tool) => tool.name === 'resolve-library-id') ||
        !tools.some((tool) => tool.name === 'query-docs')
      )
        continue;
      if (!serverNames.includes(serverName)) serverNames.push(serverName);
      const query = `Obsidian plugin ${plugin.name ?? plugin.id} (${plugin.id}), installed version ${plugin.version ?? 'unknown'}. ${options.question}`;
      const resolved = await requestDocumentation(
        (signal) =>
          client.callTool(
            'resolve-library-id',
            { libraryName: plugin.name ?? plugin.id, query },
            signal,
          ),
        options.signal,
      );
      checkAborted(options.signal);
      if (isErrorResult(resolved)) {
        record.status = 'failed';
        continue;
      }
      const libraryId = selectPluginContext7LibraryIdRust(plugin, resolved);
      if (!libraryId) {
        record.status = 'unmatched';
        record.detail = truncateUtf8Text(normalizeToolResult(resolved).modelText, 512).text;
        continue;
      }
      const result = await requestDocumentation(
        (signal) => client.callTool('query-docs', { libraryId, query }, signal),
        options.signal,
      );
      checkAborted(options.signal);
      const normalized = normalizeToolResult(result);
      if (isErrorResult(result) || isMcpToolResultEmpty(result, normalized)) {
        record.status = 'failed';
        continue;
      }
      const documentation = truncateUtf8Text(normalized.modelText, 8 * 1024);
      Object.assign(record, {
        status: 'ready',
        libraryId,
        documentation: documentation.text,
        truncated: documentation.truncated,
      });
    } catch (error) {
      checkAborted(options.signal);
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      record.status = 'failed';
      appLogger.warn('Plugin documentation lookup failed.', {
        source: 'chat.plugin-docs',
        data: { pluginId: plugin.id },
      });
    }
  }
  return {
    failureMessage: records.some((record) => record.status !== 'ready')
      ? t('pluginAwareDocumentationRequired', {
          plugins: records
            .filter((record) => record.status !== 'ready')
            .map((record) => record.plugin.name ?? record.plugin.id)
            .join(', '),
        })
      : undefined,
    prompt: [
      t('llmEvidenceDataBoundary'),
      t('pluginAwarePreparedDocsRule'),
      JSON.stringify(records),
    ].join('\n'),
    serverNames,
    attachments: records.map((record) => ({
      id: `plugin-docs:${record.plugin.id}`,
      type: 'mcp-server',
      name: serverName ?? 'context7',
      label: record.plugin.name ?? record.plugin.id,
      status:
        record.status === 'ready'
          ? record.truncated
            ? 'partial'
            : 'attached'
          : record.status === 'failed' || record.status === 'unavailable'
            ? 'error'
            : 'missing',
      detail: [t('pluginAwareDocumentationStatus', { status: record.status }), record.detail]
        .filter(Boolean)
        .join('\n'),
      actualChars: record.documentation?.length ?? 0,
    })),
  };
}

function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException(t('cancelledLabel'), 'AbortError');
}

function isErrorResult(result: unknown): boolean {
  return (
    typeof result === 'object' && result !== null && 'isError' in result && result.isError === true
  );
}

/** 느리거나 취소를 무시하는 MCP 응답이 현재 채팅 요청을 붙잡지 않게 합니다. */
async function requestDocumentation<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  checkAborted(signal);
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  let timeout: number | undefined;
  try {
    return await Promise.race([
      operation(controller.signal),
      new Promise<never>((_resolve, reject) => {
        timeout = window.setTimeout(() => {
          reject(new Error('Plugin documentation request timed out.'));
          controller.abort();
        }, 10_000);
        controller.signal.addEventListener(
          'abort',
          () => reject(new DOMException(t('cancelledLabel'), 'AbortError')),
          { once: true },
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) window.clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}
