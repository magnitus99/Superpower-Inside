import { TFile, type Vault } from 'obsidian';
import { t } from '../i18n';
import type { ChatMessage } from '../llm/providers';
import type {
  ChatMessageWithMeta,
  ChatSession,
  ChatSessionMeta,
  ContextAttachment,
  SourceCitation,
  SourceValidationWarning,
  AssistantQuestion,
  ToolCallRecord,
} from './types';
import { appLogger } from '../utils/logger';
import {
  planChatMessagesRust,
  planChatMetaRust,
  planChatSaveMetadataRust,
  planFolderMentionFilesRust,
  type RustChatMessagePlan,
} from '../rag/rust-core';
import { selectByRustIndices } from '../utils/rust-index-plan';

export type { ChatMessage } from '../llm/providers';

const MESSAGE_PREFIX = 'superpower-inside';
const MESSAGE_COMMENT_OPEN = `<!-- ${MESSAGE_PREFIX}-message`;
const MESSAGE_COMMENT_CLOSE = `<!-- /${MESSAGE_PREFIX}-message -->`;
const ENCODED_BLOCK_ATTR = 'encoding="base64"';

interface MessagePersistMeta {
  id: string;
  role: ChatMessage['role'];
  timestamp: number;
  createdAt: string;
  updatedAt: string;
  providerKey?: string;
  providerLabel?: string;
  model?: string;
  status: ChatMessageWithMeta['status'];
  errorMessage?: string;
  toolCalls?: ToolCallRecord[];
  citations?: SourceCitation[];
  sourceWarnings?: SourceValidationWarning[];
  contextAttachments?: ContextAttachment[];
  assistantQuestion?: AssistantQuestion;
  branchOf?: string;
  stopReason?: ChatMessageWithMeta['stopReason'];
  originalContent?: string;
}

interface ParsedFrontmatter {
  body: string;
  values: Record<string, string>;
  raw?: string;
}

export interface SaveChatOptions {
  filePath?: string;
  title?: string;
}

export async function saveChat(
  vault: Vault,
  messages: ChatMessageWithMeta[],
  folderPath: string,
  sessionSystemPrompt?: string,
  options?: SaveChatOptions,
): Promise<TFile> {
  const folder = folderPath.replace(/\/$/, '');
  await ensureFolder(vault, folder);

  const existingFile = options?.filePath ? vault.getAbstractFileByPath(options.filePath) : null;
  const existingContent = existingFile instanceof TFile ? await vault.cachedRead(existingFile) : '';
  const existingFrontmatter = parseFrontmatter(existingContent);
  const now = new Date().toISOString();
  const existingCreated = parseFrontmatterString(existingFrontmatter.values.created);
  const metadataPlan = planChatSaveMetadataRust(
    messages,
    existingCreated ? normalizeDateValue(existingCreated) : undefined,
    options?.title,
    now,
  ) ?? {
    title: '',
    created: now,
    sourceCount: 0,
    provider: undefined,
    model: undefined,
    summary: undefined,
  };
  const created = metadataPlan.created;
  const updated = now;
  const { title, sourceCount, summary } = metadataPlan;
  const provider = metadataPlan.provider;
  const model = metadataPlan.model;

  const fmLines = [
    `title: ${formatFrontmatterValue(title || t('defaultChatTitle'))}`,
    `created: ${formatFrontmatterValue(created)}`,
    `updated: ${formatFrontmatterValue(updated)}`,
    `messages: ${messages.length}`,
    'tags: ["superpower-inside-chat"]',
    'pinned: false',
    `sourceCount: ${sourceCount}`,
  ];
  if (provider) {
    fmLines.push(`provider: ${formatFrontmatterValue(provider)}`);
  }
  if (model) {
    fmLines.push(`model: ${formatFrontmatterValue(model)}`);
    fmLines.push(`lastModel: ${formatFrontmatterValue(model)}`);
  }
  if (summary) {
    fmLines.push(`summary: ${formatFrontmatterValue(summary)}`);
  }
  if (sessionSystemPrompt && sessionSystemPrompt.trim()) {
    fmLines.push(`systemPrompt: ${formatFrontmatterValue(sessionSystemPrompt.trim())}`);
  }

  const frontmatter = `---\n${fmLines.join('\n')}\n---\n\n`;
  const body = [
    '# Chat Session',
    '',
    '## Session Metadata',
    '',
    buildMarkdownTable([
      ['Title', title || t('defaultChatTitle')],
      ['Created', formatDisplayDate(created)],
      ['Updated', formatDisplayDate(updated)],
      ['Messages', String(messages.length)],
      ['Sources', String(sourceCount)],
      ['Provider', provider ?? '-'],
      ['Model', model ?? '-'],
      ['System Prompt', sessionSystemPrompt?.trim() ? 'Configured' : '-'],
      ['Summary', summary || '-'],
    ]),
    ...(sessionSystemPrompt?.trim()
      ? ['', '### System Prompt', '', sessionSystemPrompt.trim()]
      : []),
    '',
    '## Messages',
    '',
    messages.map((message, index) => formatMessage(message, index + 1)).join('\n\n---\n\n'),
  ].join('\n');

  // 빈 content를 가진 메시지가 있으면 경고
  for (const message of messages) {
    if (
      message.role === 'assistant' &&
      !message.content?.trim() &&
      !message.originalContent?.trim()
    ) {
      appLogger.warn(t('chatSaveEmptyAssistantWarning', { id: message.id }), {
        source: 'chat.persistence',
        data: { messageId: message.id },
      });
    }
  }
  const content = frontmatter + body.trimEnd() + '\n';

  if (existingFile instanceof TFile) {
    await vault.modify(existingFile, content);
    return existingFile;
  }

  const filename = await buildUniqueFilename(vault, folder, new Date());
  return vault.create(filename, content);
}

export async function loadChat(vault: Vault, filePath: string): Promise<ChatSession> {
  const file = vault.getAbstractFileByPath(filePath);
  if (!(file instanceof TFile) || file.extension !== 'md') {
    return { messages: [] };
  }

  const content = await vault.cachedRead(file);
  const parsed = parseFrontmatter(content);
  const messages = loadPersistedMessages(parsed.body);
  if (messages.length > 0) {
    return {
      messages,
      systemPrompt: parseFrontmatterString(parsed.values.systemPrompt),
      title: parseFrontmatterString(parsed.values.title),
    };
  }

  return parseLegacyChat(content);
}

export function listChats(vault: Vault, folderPath: string): TFile[] {
  const folder = folderPath.replace(/\/$/, '');
  const markdownFiles = vault.getMarkdownFiles();
  const filePlan = planFolderMentionFilesRust(
    folder,
    markdownFiles.map((file) => file.path),
    markdownFiles.length,
  );
  const files = selectByRustIndices(markdownFiles, filePlan?.indices, { dedupe: true });
  return files;
}

export function listChatMetas(vault: Vault, folderPath: string): ChatSessionMeta[] {
  const files = listChats(vault, folderPath);
  const metas: ChatSessionMeta[] = [];
  for (const file of files) {
    metas.push({
      filePath: file.path,
      title: file.basename,
      created: new Date(file.stat.mtime).toISOString(),
      messageCount: 0,
    });
  }
  metas.sort((a, b) => b.created.localeCompare(a.created));
  return metas;
}

export async function listChatMetasAsync(
  vault: Vault,
  folderPath: string,
): Promise<ChatSessionMeta[]> {
  const files = listChats(vault, folderPath);
  const metas: ChatSessionMeta[] = [];

  for (const file of files) {
    try {
      const content = await vault.cachedRead(file);
      const metaPlan = planChatMetaRust(content, file.basename, file.stat.mtime);
      if (!metaPlan) {
        throw new Error('Invalid chat metadata plan');
      }

      metas.push({
        filePath: file.path,
        ...metaPlan,
      });
    } catch {
      metas.push({
        filePath: file.path,
        title: file.basename,
        created: new Date(file.stat.mtime).toISOString(),
        messageCount: 0,
      });
    }
  }

  metas.sort((a, b) => {
    const dateA = a.updated ?? a.created;
    const dateB = b.updated ?? b.created;
    return dateB.localeCompare(dateA);
  });
  return metas;
}

export async function renameChat(vault: Vault, oldPath: string, newTitle: string): Promise<string> {
  const file = vault.getAbstractFileByPath(oldPath);
  if (!(file instanceof TFile)) throw new Error(t('fileNotFoundError', { path: oldPath }));

  const content = await vault.cachedRead(file);
  const parsed = parseFrontmatter(content);
  let updatedContent: string;

  if (parsed.raw !== undefined) {
    let frontmatter = parsed.raw;
    const titleLine = `title: ${formatFrontmatterValue(newTitle)}`;
    if (/^title:\s*.+$/m.test(frontmatter)) {
      frontmatter = frontmatter.replace(/^title:\s*.+$/m, titleLine);
    } else {
      frontmatter += '\n' + titleLine;
    }
    updatedContent = content.replace(/^---\n[\s\S]*?\n---\n\n?/, `---\n${frontmatter}\n---\n\n`);
  } else {
    const frontmatter = `---\ncreated: ${formatFrontmatterValue(new Date().toISOString())}\nmessages: 0\ntitle: ${formatFrontmatterValue(newTitle)}\n---\n\n`;
    updatedContent = frontmatter + content;
  }

  await vault.modify(file, updatedContent);

  const folder = oldPath.substring(0, oldPath.lastIndexOf('/') + 1);
  const sanitizedName = sanitizeFilename(newTitle).slice(0, 100);
  const newPath = `${folder}${sanitizedName}.md`;

  if (newPath !== oldPath) {
    await vault.rename(file, newPath);
    return newPath;
  }

  return oldPath;
}

export async function deleteChat(vault: Vault, filePath: string): Promise<void> {
  const file = vault.getAbstractFileByPath(filePath);
  if (!file) throw new Error(t('fileNotFoundError', { path: filePath }));
  await vault.delete(file);
}

function formatMessage(message: ChatMessageWithMeta, index: number): string {
  const meta: MessagePersistMeta = {
    id: message.id,
    role: message.role,
    timestamp: message.timestamp,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
    providerKey: message.providerKey,
    providerLabel: message.providerLabel,
    model: message.model,
    status: message.status,
    toolCalls: message.toolCalls,
    citations: message.citations,
    sourceWarnings: message.sourceWarnings,
    contextAttachments: message.contextAttachments,
    assistantQuestion: message.assistantQuestion,
    branchOf: message.branchOf,
    stopReason: message.stopReason,
  };
  const lines = [
    `${MESSAGE_COMMENT_OPEN}`,
    JSON.stringify(meta, null, 2),
    '-->',
    `### ${index}. ${formatRoleLabel(message.role)}`,
    '',
    '#### Metadata',
    '',
    buildMarkdownTable([
      ['Message ID', message.id],
      ['Role', formatRoleLabel(message.role)],
      ['Created', formatDisplayDate(message.createdAt)],
      ['Updated', formatDisplayDate(message.updatedAt)],
      ['Provider', message.providerLabel ?? message.providerKey ?? '-'],
      ['Model', message.model ?? '-'],
      ['Status', message.status],
      ['Stop Reason', message.stopReason ?? '-'],
      ['Sources', String(message.citations?.length ?? 0)],
      ['Error', message.errorMessage ?? '-'],
    ]),
  ];

  if (message.role === 'assistant') {
    if (message.reasoning) {
      lines.push('', '#### Reasoning', '', ...formatNamedBlock('reasoning', message.reasoning));
    }
    if (message.toolCalls && message.toolCalls.length > 0) {
      lines.push('', '#### Tool Calls', '');
      for (const toolCall of message.toolCalls) {
        lines.push(formatToolCall(toolCall));
      }
    }
    if (message.citations && message.citations.length > 0) {
      lines.push('', '#### Sources', '');
      for (const citation of message.citations) {
        lines.push(formatCitation(citation));
      }
    }
    lines.push('', '#### Answer', '');
  } else if (message.role === 'tool') {
    lines.push('', '#### Tool Result', '');
  } else {
    lines.push('', '#### Content', '');
  }

  // 원본 content 보존: classifyAssistantResponse 등으로 인해 content가 비었을 때 복원
  const contentToSave = message.content || message.originalContent || '';
  lines.push(...formatNamedBlock('content', contentToSave));

  if (message.errorMessage) {
    lines.push('', '#### Error', '', ...formatNamedBlock('error', message.errorMessage));
  }

  lines.push(MESSAGE_COMMENT_CLOSE);
  return lines.join('\n');
}

function formatToolCall(toolCall: ToolCallRecord): string {
  const MAX_RESULT_SIZE = 10_000;
  const argsBlock = toolCall.arguments
    ? `\n\n**Arguments**\n\n\`\`\`json\n${toolCall.arguments}\n\`\`\``
    : '';
  const rawResult = toolCall.resultSummary ?? toolCall.result ?? null;
  let resultBlock = null;
  if (rawResult !== null) {
    if (rawResult.length > MAX_RESULT_SIZE) {
      resultBlock = `\n\n**Result** (${t('toolResultTruncatedLabel')})\n\n\`\`\`markdown\n${rawResult.slice(0, MAX_RESULT_SIZE)}...\n\`\`\``;
    } else {
      resultBlock = `\n\n**Result**\n\n\`\`\`markdown\n${rawResult}\n\`\`\``;
    }
  }
  const approval = toolCall.approved === false ? t('toolApprovalPendingSuffix') : '';
  const server = toolCall.serverName ? ` @ ${toolCall.serverName}` : '';
  return `##### Tool: ${toolCall.name}${server} [${toolCall.status}]${approval}${argsBlock}${resultBlock ?? ''}\n`;
}

function formatCitation(citation: SourceCitation): string {
  const location = [
    citation.filePath,
    citation.heading ? `# ${citation.heading}` : '',
    citation.line !== undefined ? `line ${citation.line}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const score = citation.score !== undefined ? ` — score ${citation.score.toFixed(3)}` : '';
  const status = citation.status ? ` — ${citation.status}` : '';
  const detail = citation.detail ? ` — ${citation.detail}` : '';
  return `- **${citation.id}** ${location}${score}${status}${detail}\n  ${citation.preview.replace(/\n/g, ' ')}`;
}

function loadPersistedMessages(body: string): ChatMessageWithMeta[] {
  const now = new Date();
  const plans =
    planChatMessagesRust(body, now.getTime(), now.toISOString(), '[decoding failed]') ?? [];
  return plans.map(chatMessageFromRustPlan);
}

function chatMessageFromRustPlan(plan: RustChatMessagePlan): ChatMessageWithMeta {
  return {
    id: plan.id,
    role: plan.role,
    content: plan.content,
    timestamp: plan.timestamp,
    createdAt: normalizeDateValue(plan.createdAt),
    updatedAt: normalizeDateValue(plan.updatedAt),
    providerKey: plan.providerKey,
    providerLabel: plan.providerLabel,
    model: plan.model,
    status: plan.status,
    errorMessage: plan.errorMessage,
    reasoning: plan.reasoning,
    toolCalls: plan.toolCalls as ToolCallRecord[] | undefined,
    citations: plan.citations as SourceCitation[] | undefined,
    sourceWarnings: plan.sourceWarnings as SourceValidationWarning[] | undefined,
    contextAttachments: plan.contextAttachments as ContextAttachment[] | undefined,
    assistantQuestion: plan.assistantQuestion as AssistantQuestion | undefined,
    branchOf: plan.branchOf,
    stopReason: plan.stopReason as ChatMessageWithMeta['stopReason'],
  };
}

function parseLegacyChat(content: string): ChatSession {
  const parsed = parseFrontmatter(content);
  const body = parsed.body;
  const sections = body.split(/\n---\n?/);
  const messages: ChatMessageWithMeta[] = [];
  const now = new Date().toISOString();

  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^##\s*(User|Assistant|System|Tool)\n\n?([\s\S]*)$/);
    if (!match) continue;

    const roleMap: Record<string, ChatMessage['role']> = {
      User: 'user',
      Assistant: 'assistant',
      System: 'system',
      Tool: 'tool',
    };
    const role = roleMap[match[1]] ?? 'assistant';
    const sectionBody = match[2];
    let reasoning: string | undefined;
    let answerContent = sectionBody;
    let toolCalls: ToolCallRecord[] | undefined;

    if (role === 'assistant') {
      const thinkingMatch = sectionBody.match(
        /^### Thinking\n\n([\s\S]*?)(?=\n### (?:Tool Calls|Answer))/,
      );
      const toolCallsMatch = sectionBody.match(/\n### Tool Calls\n\n([\s\S]*?)(?=\n### Answer)/);
      const answerMatch = sectionBody.match(/\n### Answer\n\n([\s\S]*)$/);
      if (thinkingMatch) reasoning = thinkingMatch[1].trim();
      if (toolCallsMatch) toolCalls = parseLegacyToolCalls(toolCallsMatch[1], messages.length);
      if (answerMatch) answerContent = answerMatch[1].trim();
    }

    messages.push({
      id: `msg-${Date.now()}-${messages.length}`,
      role,
      content: answerContent.trim(),
      timestamp: Date.now(),
      createdAt: now,
      updatedAt: now,
      status: 'complete',
      reasoning,
      toolCalls,
    });
  }

  return {
    messages,
    systemPrompt: parseFrontmatterString(parsed.values.systemPrompt),
    title: parseFrontmatterString(parsed.values.title),
  };
}

function parseLegacyToolCalls(raw: string, messageIndex: number): ToolCallRecord[] {
  const toolCalls: ToolCallRecord[] = [];
  const toolBlocks = raw.split(/\n#### Tool: /).filter((section) => section.trim());
  for (const toolBlock of toolBlocks) {
    const nameMatch = toolBlock.match(/^([^[]+)\s*\[(running|success|error)\]/);
    const name = nameMatch ? nameMatch[1].trim() : toolBlock.split('\n')[0].trim();
    const status = nameMatch ? (nameMatch[2] as ToolCallRecord['status']) : 'success';
    const argsMatch = toolBlock.match(/```json\n([\s\S]*?)```/);
    const resultMatch = toolBlock.match(/\*\*Result:\*\*\n```\n([\s\S]*?)```/);
    toolCalls.push({
      id: `tc-${messageIndex}-${toolCalls.length}`,
      name,
      arguments: argsMatch ? argsMatch[1].trim() : '',
      result: resultMatch ? resultMatch[1].trim() : undefined,
      status,
    });
  }
  return toolCalls;
}

function parseFrontmatter(content: string): ParsedFrontmatter {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n\n?/);
  if (!fmMatch) return { body: content, values: {} };

  const values: Record<string, string> = {};
  for (const line of fmMatch[1].split('\n')) {
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (!match) continue;
    values[match[1].trim()] = match[2].trim();
  }
  return {
    raw: fmMatch[1],
    values,
    body: content.replace(/^---\n[\s\S]*?\n---\n\n?/, ''),
  };
}

function parseFrontmatterString(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === 'string' ? parsed : String(parsed);
  } catch {
    return value.trim();
  }
}

function formatNamedBlock(name: string, value: string): string[] {
  return [
    `<!-- ${MESSAGE_PREFIX}-${name}-start ${ENCODED_BLOCK_ATTR} -->`,
    encodeTextBlock(value),
    `<!-- ${MESSAGE_PREFIX}-${name}-end -->`,
  ];
}

function encodeTextBlock(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function formatRoleLabel(role: ChatMessage['role']): string {
  const labels: Record<ChatMessage['role'], string> = {
    system: 'System',
    user: 'User',
    assistant: 'Assistant',
    tool: 'Tool',
  };
  return labels[role];
}

function buildMarkdownTable(rows: Array<[string, string]>): string {
  return [
    '| Field | Value |',
    '| --- | --- |',
    ...rows.map(([field, value]) => `| ${escapeTableCell(field)} | ${escapeTableCell(value)} |`),
  ].join('\n');
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}

function formatFrontmatterValue(value: string): string {
  return JSON.stringify(value);
}

function formatDateForFilename(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}`;
}

async function buildUniqueFilename(vault: Vault, folder: string, date: Date): Promise<string> {
  const baseName = formatDateForFilename(date);
  let candidate = `${folder}/${baseName}.md`;
  let index = 2;
  while (await vault.adapter.exists(candidate)) {
    candidate = `${folder}/${baseName}-${index}.md`;
    index++;
  }
  return candidate;
}

async function ensureFolder(vault: Vault, folder: string): Promise<void> {
  if (!folder || (await vault.adapter.exists(folder))) return;
  const parts = folder.split('/').filter(Boolean);
  let current = '';
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (!(await vault.adapter.exists(current))) {
      await vault.createFolder(current);
    }
  }
}

function sanitizeFilename(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, '_') || 'chat-session';
}

function normalizeDateValue(value: string): string {
  const numeric = Number(value);
  if (!Number.isNaN(numeric) && value.trim() !== '') {
    return new Date(numeric).toISOString();
  }
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) {
    return date.toISOString();
  }
  return value;
}

function formatDisplayDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}
