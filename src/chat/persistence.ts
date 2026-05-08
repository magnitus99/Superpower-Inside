import type { Vault, TFile } from 'obsidian';
import type { ChatMessage } from '../llm/providers';

function formatDateForFilename(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}`;
}

/** 대화를 마크다운 파일로 저장합니다. */
export type { ChatMessage } from '../llm/providers';

export async function saveChat(
  vault: Vault,
  messages: ChatMessage[],
  folderPath: string,
): Promise<TFile> {
  const folder = folderPath.replace(/\/$/, '');
  if (!(await vault.adapter.exists(folder))) {
    await vault.createFolder(folder);
  }

  const filename = `${folder}/${formatDateForFilename(new Date())}.md`;
  const frontmatter = `---\ncreated: ${new Date().toISOString()}\nmessages: ${messages.length}\n---\n\n`;

  const body = messages
    .map((m) => {
      const roleTag = m.role === 'system' ? 'System' : m.role === 'user' ? 'User' : 'Assistant';
      return `## ${roleTag}\n\n${m.content}\n`;
    })
    .join('\n---\n\n');

  return vault.create(filename, frontmatter + body);
}

/** 저장된 대화 파일에서 메시지를 복원합니다. */
export async function loadChat(vault: Vault, filePath: string): Promise<ChatMessage[]> {
  const file = vault.getAbstractFileByPath(filePath);
  if (!file || !('extension' in file)) return [];
  const tfile = file as TFile;
  if (tfile.extension !== 'md') return [];

  const content = await vault.cachedRead(tfile);
  const messages: ChatMessage[] = [];

  // YAML frontmatter 제거
  const body = content.replace(/^---\n[\s\S]*?\n---\n\n?/, '');
  const sections = body.split(/\n---\n?/);

  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^##\s*(User|Assistant|System)\n\n?([\s\S]*)$/);
    if (match) {
      const roleMap: Record<string, ChatMessage['role']> = {
        User: 'user',
        Assistant: 'assistant',
        System: 'system',
      };
      const role = roleMap[match[1]] ?? 'assistant';
      messages.push({ role, content: match[2].trim() });
    }
  }

  return messages;
}

/** 채팅 저장 폴더의 파일 목록을 반환합니다. */
export function listChats(vault: Vault, folderPath: string): TFile[] {
  const folder = folderPath.replace(/\/$/, '');
  return vault
    .getMarkdownFiles()
    .filter((f) => f.path.startsWith(folder + '/'));
}
