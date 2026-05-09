import type { Vault, TFile } from 'obsidian';
import type { ChatMessage } from '../llm/providers';
export type { ChatMessage } from '../llm/providers';

function formatDateForFilename(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}`;
}

/** 대화를 마크다운 파일로 저장합니다. */
export interface ChatSession {
  systemPrompt?: string;
  messages: ChatMessage[];
}

export async function saveChat(
  vault: Vault,
  messages: ChatMessage[],
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
      const roleTag = m.role === 'system' ? 'System' : m.role === 'user' ? 'User' : 'Assistant';
      return `## ${roleTag}\n\n${m.content}\n`;
    })
    .join('\n---\n\n');

  return vault.create(filename, frontmatter + body);
}

/** 저장된 대화 파일에서 메시지를 복원합니다. */
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

  const messages: ChatMessage[] = [];
  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^##\s*(User|Assistant|System|Tool)\n\n?([\s\S]*)$/);
    if (match) {
      const roleMap: Record<string, ChatMessage['role']> = {
        User: 'user',
        Assistant: 'assistant',
        System: 'system',
        Tool: 'tool',
      };
      const role = roleMap[match[1]] ?? 'assistant';
      messages.push({ role, content: match[2].trim() });
    }
  }

  return { messages, systemPrompt: sessionSystemPrompt };
}

/** 채팅 저장 폴더의 파일 목록을 반환합니다. */
export function listChats(vault: Vault, folderPath: string): TFile[] {
  const folder = folderPath.replace(/\/$/, '');
  return vault
    .getMarkdownFiles()
    .filter((f) => f.path.startsWith(folder + '/'));
}
