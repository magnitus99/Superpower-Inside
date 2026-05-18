import { TFile, TFolder, type App } from 'obsidian';
import type { MCPRegistry } from '../mcp/registry';
import type { QueryResult } from '../rag/query';
import { createContentHash } from '../rag/hash';
import type { ContextAttachment, SourceCitation } from './types';
import { parseMentions, shouldUseAutoRagForMentions, type MentionResolver } from './mention-parser';
export {
  parseMentions,
  shouldUseAutoRagForMentions,
  type MentionResolver,
  type ParsedMention,
} from './mention-parser';

export interface RagQueryLike {
  query(question: string, topK: number, minScore?: number): Promise<QueryResult[]>;
}

export interface ContextBuildResult {
  systemPrompt: string | null;
  attachments: ContextAttachment[];
  citations: SourceCitation[];
  warnings: string[];
}

interface BuildContextOptions {
  app: App;
  ragEngine?: RagQueryLike | null;
  mcpRegistry?: MCPRegistry | null;
  maxFolderFiles?: number;
  maxContextChars?: number;
  ragTopK?: number;
  ragMinScore?: number;
}

interface ContextBlock {
  text: string;
  citation?: SourceCitation;
}

const DEFAULT_MAX_FOLDER_FILES = 12;
const DEFAULT_MAX_CONTEXT_CHARS = 24_000;
const DEFAULT_RAG_TOP_K = 5;
const VAULT_CONTEXT_RULES = [
  'Vault Context에 없는 문서명은 출처로 쓰지 마세요.',
  '새 노트 제안은 출처와 분리해 "제안"으로 표시하세요.',
  '근거가 부족하면 관련 문서를 찾지 못했다고 답하세요.',
].join('\n');

export async function buildChatContext(
  question: string,
  options: BuildContextOptions,
): Promise<ContextBuildResult> {
  const maxFolderFiles = options.maxFolderFiles ?? DEFAULT_MAX_FOLDER_FILES;
  const maxContextChars = options.maxContextChars ?? DEFAULT_MAX_CONTEXT_CHARS;
  const ragTopK = options.ragTopK ?? DEFAULT_RAG_TOP_K;
  const blocks: ContextBlock[] = [];
  const attachments: ContextAttachment[] = [];
  const citations: SourceCitation[] = [];
  const warnings: string[] = [];
  let remainingChars = maxContextChars;
  const mentions = parseMentions(
    question,
    createAppMentionResolver(options.app, options.mcpRegistry),
  );
  const shouldUseAutoRag = shouldUseAutoRagForMentions(mentions);

  const appendBlock = (block: ContextBlock): boolean => {
    if (remainingChars <= 0) return false;
    const text =
      block.text.length > remainingChars ? block.text.slice(0, remainingChars) : block.text;
    blocks.push({ ...block, text });
    remainingChars -= text.length;
    if (block.citation) citations.push(block.citation);
    return text.length === block.text.length;
  };

  if (options.ragEngine && shouldUseAutoRag) {
    try {
      const results = await options.ragEngine.query(question, ragTopK, options.ragMinScore);
      const sourceIds: string[] = [];
      let rejectedCount = 0;
      for (const result of results) {
        const verified = await verifyQueryResult(result, options.app);
        const citation = createCitation(
          'rag',
          citations.length + 1,
          result,
          verified.status,
          verified.detail,
        );
        citations.push(citation);
        if (verified.status !== 'verified') {
          rejectedCount++;
          continue;
        }
        sourceIds.push(citation.id);
        appendBlock({
          text: `[Source ${citation.id}: ${citation.filePath}${citation.heading ? ` # ${citation.heading}` : ''}]\n${result.entry.metadata.text}`,
        });
      }
      attachments.push({
        id: 'rag:auto',
        type: 'rag',
        name: 'auto',
        label: `자동 RAG ${sourceIds.length}개`,
        status: sourceIds.length > 0 ? 'attached' : 'low-relevance',
        detail:
          sourceIds.length > 0
            ? rejectedCount > 0
              ? `검증 실패 후보 ${rejectedCount}개는 컨텍스트에서 제외했습니다.`
              : undefined
            : '유사도 임계치를 충족하는 관련 문서가 없습니다.',
        sourceIds,
      });
    } catch (err) {
      warnings.push(`RAG 컨텍스트를 불러오지 못했습니다: ${stringifyError(err)}`);
      attachments.push({
        id: 'rag:auto',
        type: 'rag',
        name: 'auto',
        label: '자동 RAG',
        status: 'error',
        detail: stringifyError(err),
      });
    }
  }

  for (const mention of mentions) {
    if (mention.type === 'file') {
      await appendFileMention(mention.name, options.app, appendBlock, attachments, citations);
    } else if (mention.type === 'folder') {
      await appendFolderMention(
        mention.name,
        options.app,
        appendBlock,
        attachments,
        citations,
        maxFolderFiles,
      );
    } else {
      await appendServerMention(mention.name, options.mcpRegistry, appendBlock, attachments);
    }
  }

  const contextText = blocks
    .map((block) => block.text)
    .filter(Boolean)
    .join('\n\n---\n\n');
  const warningText = warnings.length > 0 ? `\n\n[Context Warnings]\n${warnings.join('\n')}` : '';
  return {
    systemPrompt: contextText
      ? `[Vault Context Rules]\n${VAULT_CONTEXT_RULES}\n\n[Vault Context]\n${contextText}${warningText}`
      : warningText.trim() || null,
    attachments,
    citations,
    warnings,
  };
}

export function createAppMentionResolver(app: App, registry?: MCPRegistry | null): MentionResolver {
  return {
    isServer: (name: string) =>
      registry ? registry.getEnabledServers().some((server) => server.name === name) : false,
    isFile: (name: string) => app.vault.getAbstractFileByPath(name) instanceof TFile,
    isFolder: (name: string) => app.vault.getAbstractFileByPath(name) instanceof TFolder,
  };
}

function createCitation(
  prefix: string,
  index: number,
  result: QueryResult,
  status: SourceCitation['status'],
  detail?: string,
): SourceCitation {
  const metadata = result.entry.metadata;
  return {
    id: `${prefix}-${index}`,
    filePath: metadata.filePath,
    heading: metadata.heading,
    line: metadata.startLine,
    endLine: metadata.endLine,
    score: result.score,
    vectorScore: result.vectorScore,
    bm25Score: result.bm25Score,
    status,
    detail,
    preview: createPreview(metadata.text),
  };
}

async function verifyQueryResult(
  result: QueryResult,
  app: App,
): Promise<{ status: SourceCitation['status']; detail?: string }> {
  const metadata = result.entry.metadata;
  const file = app.vault.getAbstractFileByPath(metadata.filePath);
  if (!(file instanceof TFile)) {
    return { status: 'missing', detail: '파일이 vault에 존재하지 않습니다.' };
  }
  if (
    typeof metadata.sourceMtime !== 'number' ||
    typeof metadata.sourceSize !== 'number' ||
    typeof metadata.contentHash !== 'string' ||
    typeof metadata.endLine !== 'number'
  ) {
    return { status: 'stale', detail: '이전 형식의 인덱스라 재인덱싱이 필요합니다.' };
  }
  if (metadata.sourceMtime !== file.stat.mtime || metadata.sourceSize !== file.stat.size) {
    return { status: 'stale', detail: '파일이 마지막 인덱싱 이후 변경되었습니다.' };
  }
  const content = await app.vault.cachedRead(file);
  if (createContentHash(content) !== metadata.contentHash) {
    return { status: 'stale', detail: '파일 내용 해시가 마지막 인덱싱 이후 변경되었습니다.' };
  }
  const lineCount = content.split('\n').length;
  if (
    metadata.startLine < 0 ||
    metadata.endLine < metadata.startLine ||
    metadata.endLine >= lineCount
  ) {
    return { status: 'stale', detail: '청크 라인 범위가 현재 파일과 맞지 않습니다.' };
  }
  return { status: 'verified' };
}

async function appendFileMention(
  path: string,
  app: App,
  appendBlock: (block: ContextBlock) => boolean,
  attachments: ContextAttachment[],
  citations: SourceCitation[],
): Promise<void> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) {
    attachments.push({
      id: `file:${path}`,
      type: 'file',
      name: path,
      label: path,
      status: 'missing',
      detail: '파일을 찾을 수 없습니다.',
    });
    return;
  }

  try {
    const content = await app.vault.cachedRead(file);
    const citation: SourceCitation = {
      id: `file-${citations.length + 1}`,
      filePath: file.path,
      status: 'verified',
      preview: createPreview(content),
    };
    const attachedFully = appendBlock({
      citation,
      text: `[File: ${file.path}]\n${content}`,
    });
    attachments.push({
      id: `file:${file.path}`,
      type: 'file',
      name: file.path,
      label: file.path,
      status: attachedFully ? 'attached' : 'partial',
      detail: attachedFully ? undefined : '컨텍스트 예산 때문에 일부만 첨부했습니다.',
      sourceIds: [citation.id],
    });
  } catch (err) {
    attachments.push({
      id: `file:${path}`,
      type: 'file',
      name: path,
      label: path,
      status: 'error',
      detail: stringifyError(err),
    });
  }
}

async function appendFolderMention(
  path: string,
  app: App,
  appendBlock: (block: ContextBlock) => boolean,
  attachments: ContextAttachment[],
  citations: SourceCitation[],
  maxFolderFiles: number,
): Promise<void> {
  const folder = app.vault.getAbstractFileByPath(path);
  if (!(folder instanceof TFolder)) {
    attachments.push({
      id: `folder:${path}`,
      type: 'folder',
      name: path,
      label: path,
      status: 'missing',
      detail: '폴더를 찾을 수 없습니다.',
    });
    return;
  }

  const files = app.vault
    .getMarkdownFiles()
    .filter((file) => file.path.startsWith(`${path}/`))
    .slice(0, maxFolderFiles);
  const sourceIds: string[] = [];
  let partial =
    app.vault.getMarkdownFiles().filter((file) => file.path.startsWith(`${path}/`)).length >
    files.length;

  for (const file of files) {
    try {
      const content = await app.vault.cachedRead(file);
      const citation: SourceCitation = {
        id: `folder-${citations.length + 1}`,
        filePath: file.path,
        status: 'verified',
        preview: createPreview(content),
      };
      sourceIds.push(citation.id);
      const attachedFully = appendBlock({
        citation,
        text: `[Folder File: ${file.path}]\n${content}`,
      });
      if (!attachedFully) {
        partial = true;
        break;
      }
    } catch {
      partial = true;
    }
  }

  attachments.push({
    id: `folder:${path}`,
    type: 'folder',
    name: path,
    label: path,
    status: sourceIds.length === 0 ? 'missing' : partial ? 'partial' : 'attached',
    detail: partial
      ? `최대 ${maxFolderFiles}개 파일 및 컨텍스트 예산 안에서 첨부했습니다.`
      : undefined,
    sourceIds,
  });
}

async function appendServerMention(
  name: string,
  registry: MCPRegistry | null | undefined,
  appendBlock: (block: ContextBlock) => boolean,
  attachments: ContextAttachment[],
): Promise<void> {
  const client = registry?.getClient(name);
  if (!client) {
    attachments.push({
      id: `mcp:${name}`,
      type: 'mcp-server',
      name,
      label: name,
      status: 'missing',
      detail: '연결되지 않은 MCP 서버입니다.',
    });
    return;
  }

  try {
    const tools = await client.listTools();
    const toolList = tools
      .map((tool) => {
        const schemaJson = JSON.stringify(tool.inputSchema ?? {});
        return `- ${tool.name}: ${tool.description ?? ''}\n  Parameters schema: ${schemaJson}`;
      })
      .join('\n');
    const attachedFully = appendBlock({
      text: `[MCP Server: ${name}]
Available tools:
${toolList || '(사용 가능한 툴 없음)'}

Instruction: 사용자가 이 서버를 @${name}로 명시했습니다. 질문 해결에 최신 정보, 검색, 외부 데이터가 필요하면 위 도구를 호출하고, 도구 결과를 근거로 최종 답변을 작성하세요. 검색 결과 기반 답변에는 가능한 출처 링크를 포함하세요.`,
    });
    attachments.push({
      id: `mcp:${name}`,
      type: 'mcp-server',
      name,
      label: name,
      status: attachedFully ? 'attached' : 'partial',
      detail: attachedFully ? undefined : '컨텍스트 예산 때문에 일부만 첨부했습니다.',
    });
  } catch (err) {
    attachments.push({
      id: `mcp:${name}`,
      type: 'mcp-server',
      name,
      label: name,
      status: 'error',
      detail: stringifyError(err),
    });
  }
}

function createPreview(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 220);
}

function stringifyError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
