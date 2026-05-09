import type { Vault, TFile } from 'obsidian';
import type { ChatMessage, ToolCallInfo, ToolCallRecordInfo } from '../llm/providers';
export type { ChatMessage } from '../llm/providers';

type ToolCallRecord = ToolCallRecordInfo;

export interface ChatMessageWithMeta extends ChatMessage {
  id?: string;
  timestamp?: number;
  reasoning?: string;
  toolCalls?: ChatMessage['toolCalls'];
  model?: string;
}

function formatDateForFilename(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}`;
}

export interface ChatSession {
  systemPrompt?: string;
  messages: ChatMessageWithMeta[];
}

function normalizeToolCall(toolCall: ToolCallInfo | ToolCallRecord): ToolCallRecord {
  if ('function' in toolCall) {
    return {
      id: toolCall.id,
      name: toolCall.function.name,
      arguments: toolCall.function.arguments,
      status: 'success',
    };
  }
  return toolCall;
}

export async function saveChat(
  vault: Vault,
  messages: ChatMessageWithMeta[],
  folderPath: string,
  sessionSystemPrompt?: string,
): Promise<TFile> {
  const folder = folderPath.replace(/\/$/, '');
  if (!(await vault.adapter.exists(folder))) {
    await vault.createFolder(folder);
  }

  const filename = `${folder}/${formatDateForFilename(new Date())}.md`;
  const fmLines = [`created: ${new Date().toISOString()}`, `messages: ${messages.length}`];
  if (sessionSystemPrompt && sessionSystemPrompt.trim()) {
    fmLines.push(`systemPrompt: ${JSON.stringify(sessionSystemPrompt.trim())}`);
  }
  const frontmatter = `---\n${fmLines.join('\n')}\n---\n\n`;

  const body = messages
    .map((m) => {
      const roleTag = m.role === 'system' ? 'System' : m.role === 'user' ? 'User' : m.role === 'tool' ? 'Tool' : 'Assistant';
      let section = `## ${roleTag}\n\n${m.content}`;
      if (m.role === 'assistant') {
        if (m.reasoning) {
          section = `## ${roleTag}\n\n### Thinking\n\n${m.reasoning}\n\n### Answer\n\n${m.content}`;
        }
        if (m.toolCalls && m.toolCalls.length > 0) {
          const toolSections = m.toolCalls
            .map((tc) => {
              const toolCall = normalizeToolCall(tc);
              const argsBlock = toolCall.arguments
                ? `\n\`\`\`json\n${toolCall.arguments}\n\`\`\``
                : '';
              const resultBlock = toolCall.result
                ? `\n\n**Result:**\n\`\`\`\n${toolCall.result}\n\`\`\``
                : '';
              return `#### Tool: ${toolCall.name} [${toolCall.status}]\n${argsBlock}${resultBlock}`;
            })
            .join('\n\n');
          section = `## ${roleTag}\n\n### Thinking\n\n${m.reasoning ?? '*No thinking recorded*'}\n\n### Tool Calls\n\n${toolSections}\n\n### Answer\n\n${m.content}`;
        }
      }
      return section;
    })
    .join('\n\n---\n\n');

  return vault.create(filename, frontmatter + body);
}

export async function loadChat(vault: Vault, filePath: string): Promise<ChatSession> {
  const file = vault.getAbstractFileByPath(filePath);
  if (!file || !('extension' in file)) return { messages: [] };
  const tfile = file as TFile;
  if (tfile.extension !== 'md') return { messages: [] };

  const content = await vault.cachedRead(tfile);

  let sessionSystemPrompt: string | undefined;
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n\n?/);
  if (fmMatch) {
    const spMatch = fmMatch[1].match(/^systemPrompt:\s*(.+)$/m);
    if (spMatch) {
      try {
        sessionSystemPrompt = JSON.parse(spMatch[1].trim()) as string;
      } catch {
        sessionSystemPrompt = spMatch[1].trim();
      }
    }
  }

  const body = content.replace(/^---\n[\s\S]*?\n---\n\n?/, '');
  const sections = body.split(/\n---\n?/);

  const messages: ChatMessageWithMeta[] = [];
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
    const body = match[2];

    let reasoning: string | undefined;
    let answerContent = body;
    let toolCalls: ToolCallRecord[] | undefined;

    if (role === 'assistant') {
      const thinkingMatch = body.match(/^### Thinking\n\n([\s\S]*?)(?=\n### (?:Tool Calls|Answer))/);
      const toolCallsMatch = body.match(/\n### Tool Calls\n\n([\s\S]*?)(?=\n### Answer)/);
      const answerMatch = body.match(/\n### Answer\n\n([\s\S]*)$/);

      if (thinkingMatch) {
        reasoning = thinkingMatch[1].trim();
      }
      if (toolCallsMatch) {
        toolCalls = [];
        const toolBlocks = toolCallsMatch[1].split(/\n#### Tool: /).filter((s) => s.trim());
        for (const tb of toolBlocks) {
          const nameMatch = tb.match(/^([^[]+)\s*\[(running|success|error)\]/);
          const name = nameMatch ? nameMatch[1].trim() : tb.split('\n')[0].trim();
          const status = nameMatch ? (nameMatch[2] as ToolCallRecord['status']) : 'success';
          const argsMatch = tb.match(/```json\n([\s\S]*?)```/);
          const args = argsMatch ? argsMatch[1].trim() : '';
          const resultMatch = tb.match(/\*\*Result:\*\*\n```\n([\s\S]*?)```/);
          const result = resultMatch ? resultMatch[1].trim() : undefined;
          toolCalls.push({
            id: `tc-${messages.length}-${toolCalls.length}`,
            name,
            arguments: args,
            ...(result ? { result } : {}),
            status,
          });
        }
      }
      if (answerMatch) {
        answerContent = answerMatch[1].trim();
      }
    }

    messages.push({
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      role,
      content: answerContent.trim(),
      timestamp: Date.now(),
      ...(reasoning ? { reasoning } : {}),
      ...(toolCalls && toolCalls.length > 0 ? { toolCalls } : {}),
    });
  }

  return { messages, systemPrompt: sessionSystemPrompt };
}

export function listChats(vault: Vault, folderPath: string): TFile[] {
  const folder = folderPath.replace(/\/$/, '');
  return vault.getMarkdownFiles().filter((f) => f.path.startsWith(folder + '/'));
}
