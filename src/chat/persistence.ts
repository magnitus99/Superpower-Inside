import { TFile, type Vault } from 'obsidian';
import type { ChatMessage, ToolCallInfo, ToolCallRecordInfo } from '../llm/providers';
import type { ChatSessionMeta, ChatMessageWithMeta as NewChatMessageWithMeta } from './types';

export type { ChatMessage } from '../llm/providers';

type ToolCallRecord = ToolCallRecordInfo;

// legacy compat: persistence 내부 타입
interface PersistenceMessageWithMeta extends ChatMessage {
	id?: string;
	timestamp?: number;
	reasoning?: string;
	toolCalls?: ChatMessage['toolCalls'];
	model?: string;
}

interface PersistenceSession {
	systemPrompt?: string;
	title?: string;
	messages: PersistenceMessageWithMeta[];
}

function formatDateForFilename(date: Date): string {
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}`;
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

export interface SaveChatOptions {
	filePath?: string;
	title?: string;
}

export async function saveChat(
	vault: Vault,
	messages: NewChatMessageWithMeta[],
	folderPath: string,
	sessionSystemPrompt?: string,
	options?: SaveChatOptions,
): Promise<TFile> {
	const folder = folderPath.replace(/\/$/, '');
	if (!(await vault.adapter.exists(folder))) {
		await vault.createFolder(folder);
	}

	const fmLines = [`created: ${new Date().toISOString()}`, `messages: ${messages.length}`];
	if (sessionSystemPrompt && sessionSystemPrompt.trim()) {
		fmLines.push(`systemPrompt: ${JSON.stringify(sessionSystemPrompt.trim())}`);
	}
	const title = options?.title || deriveTitle(messages);
	if (title) {
		fmLines.push(`title: ${JSON.stringify(title)}`);
	}
	const frontmatter = `---\n${fmLines.join('\n')}\n---\n\n`;

	const body = messages
		.map((m) => {
			const roleTag =
				m.role === 'system' ? 'System' : m.role === 'user' ? 'User' : m.role === 'tool' ? 'Tool' : 'Assistant';
			let section = `## ${roleTag}\n\n${m.content}`;
			if (m.role === 'assistant') {
				if (m.reasoning) {
					section = `## ${roleTag}\n\n### Thinking\n\n${m.reasoning}\n\n### Answer\n\n${m.content}`;
				}
				if (m.toolCalls && m.toolCalls.length > 0) {
					const toolSections = m.toolCalls
						.map((tc) => {
							const toolCall = normalizeToolCall(tc);
							const argsBlock = toolCall.arguments ? `\n\`\`\`json\n${toolCall.arguments}\n\`\`\`` : '';
							const resultBlock = toolCall.result ? `\n\n**Result:**\n\`\`\`\n${toolCall.result}\n\`\`\`` : '';
							return `#### Tool: ${toolCall.name} [${toolCall.status}]\n${argsBlock}${resultBlock}`;
						})
						.join('\n\n');
					section = `## ${roleTag}\n\n### Thinking\n\n${m.reasoning ?? '*No thinking recorded*'}\n\n### Tool Calls\n\n${toolSections}\n\n### Answer\n\n${m.content}`;
				}
			}
			return section;
		})
		.join('\n\n---\n\n');

	const content = frontmatter + body;

	if (options?.filePath) {
		const existingFile = vault.getAbstractFileByPath(options.filePath);
		if (existingFile instanceof TFile) {
			await vault.modify(existingFile, content);
			return existingFile;
		}
	}

	const filename = `${folder}/${formatDateForFilename(new Date())}.md`;
	return vault.create(filename, content);
}

function deriveTitle(messages: NewChatMessageWithMeta[]): string {
	const firstUserMsg = messages.find((m) => m.role === 'user');
	if (!firstUserMsg) return '';
	const content = firstUserMsg.content.replace(/\n/g, ' ').trim();
	return content.length > 50 ? content.slice(0, 50) + '…' : content;
}

export async function loadChat(vault: Vault, filePath: string): Promise<PersistenceSession> {
	const file = vault.getAbstractFileByPath(filePath);
	if (!file || !('extension' in file)) return { messages: [] };
	const tfile = file as TFile;
	if (tfile.extension !== 'md') return { messages: [] };

	const content = await vault.cachedRead(tfile);

	let sessionSystemPrompt: string | undefined;
	let sessionTitle: string | undefined;
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
		const titleMatch = fmMatch[1].match(/^title:\s*(.+)$/m);
		if (titleMatch) {
			try {
				sessionTitle = JSON.parse(titleMatch[1].trim()) as string;
			} catch {
				sessionTitle = titleMatch[1].trim();
			}
		}
	}

	const body = content.replace(/^---\n[\s\S]*?\n---\n\n?/, '');
	const sections = body.split(/\n---\n?/);

	const messages: PersistenceMessageWithMeta[] = [];
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
			const thinkingMatch = sectionBody.match(/^### Thinking\n\n([\s\S]*?)(?=\n### (?:Tool Calls|Answer))/);
			const toolCallsMatch = sectionBody.match(/\n### Tool Calls\n\n([\s\S]*?)(?=\n### Answer)/);
			const answerMatch = sectionBody.match(/\n### Answer\n\n([\s\S]*)$/);

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

	return { messages, systemPrompt: sessionSystemPrompt, title: sessionTitle };
}

export function listChats(vault: Vault, folderPath: string): TFile[] {
	const folder = folderPath.replace(/\/$/, '');
	return vault.getMarkdownFiles().filter((f) => f.path.startsWith(folder + '/'));
}

export function listChatMetas(vault: Vault, folderPath: string): ChatSessionMeta[] {
	const files = listChats(vault, folderPath);
	const metas: ChatSessionMeta[] = [];
	for (const file of files) {
		const basename = file.basename;
		const title = basename;
		metas.push({
			filePath: file.path,
			title,
			created: file.stat.mtime.toString(),
			messageCount: 0,
		});
	}
	metas.sort((a, b) => b.created.localeCompare(a.created));
	return metas;
}

export async function listChatMetasAsync(vault: Vault, folderPath: string): Promise<ChatSessionMeta[]> {
	const files = listChats(vault, folderPath);
	const metas: ChatSessionMeta[] = [];

	for (const file of files) {
		try {
			const content = await vault.cachedRead(file);
			const title = extractTitleFromContent(content) || file.basename;
			const created = extractCreatedFromContent(content) || new Date(file.stat.mtime).toISOString();
			const messageCount = extractMessageCountFromContent(content) || 0;

			metas.push({
				filePath: file.path,
				title,
				created,
				messageCount,
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

	metas.sort((a, b) => b.created.localeCompare(a.created));
	return metas;
}

function extractTitleFromContent(content: string): string | undefined {
	const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n\n?/);
	if (!fmMatch) return undefined;
	const titleMatch = fmMatch[1].match(/^title:\s*(.+)$/m);
	if (!titleMatch) return undefined;
	try {
		return JSON.parse(titleMatch[1].trim()) as string;
	} catch {
		return titleMatch[1].trim();
	}
}

function extractCreatedFromContent(content: string): string | undefined {
	const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n\n?/);
	if (!fmMatch) return undefined;
	const createdMatch = fmMatch[1].match(/^created:\s*(.+)$/m);
	return createdMatch ? createdMatch[1].trim() : undefined;
}

function extractMessageCountFromContent(content: string): number {
	const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n\n?/);
	if (!fmMatch) return 0;
	const countMatch = fmMatch[1].match(/^messages:\s*(\d+)$/m);
	return countMatch ? parseInt(countMatch[1], 10) : 0;
}

export async function renameChat(vault: Vault, oldPath: string, newTitle: string): Promise<string> {
	const file = vault.getAbstractFileByPath(oldPath);
	if (!(file instanceof TFile)) throw new Error(`파일을 찾을 수 없음: ${oldPath}`);

	const content = await vault.cachedRead(file);
	let updatedContent: string;

	const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n\n?/);
	if (fmMatch) {
		let frontmatter = fmMatch[1];
		const titleLine = `title: ${JSON.stringify(newTitle)}`;
		if (/^title:\s*.+$/m.test(frontmatter)) {
			frontmatter = frontmatter.replace(/^title:\s*.+$/m, titleLine);
		} else {
			frontmatter += '\n' + titleLine;
		}
		updatedContent = content.replace(/^---\n[\s\S]*?\n---\n\n?/, `---\n${frontmatter}\n---\n\n`);
	} else {
		const frontmatter = `---\ncreated: ${new Date().toISOString()}\nmessages: 0\ntitle: ${JSON.stringify(newTitle)}\n---\n\n`;
		updatedContent = frontmatter + content;
	}

	await vault.modify(file, updatedContent);

	const folder = oldPath.substring(0, oldPath.lastIndexOf('/') + 1);
	const sanitizedName = newTitle.replace(/[\\/:*?"<>|]/g, '_').slice(0, 100);
	const newPath = `${folder}${sanitizedName}.md`;

	if (newPath !== oldPath) {
		await vault.rename(file, newPath);
		return newPath;
	}

	return oldPath;
}

export async function deleteChat(vault: Vault, filePath: string): Promise<void> {
	const file = vault.getAbstractFileByPath(filePath);
	if (!file) throw new Error(`파일을 찾을 수 없음: ${filePath}`);
	await vault.delete(file);
}

export function convertPersistenceSession(session: PersistenceSession): {
	messages: NewChatMessageWithMeta[];
	systemPrompt?: string;
	title?: string;
} {
	return {
		messages: session.messages.map((m) => ({
			id: m.id ?? `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
			role: m.role,
			content: m.content,
			timestamp: m.timestamp ?? Date.now(),
			reasoning: m.reasoning,
			toolCalls: m.toolCalls
				? m.toolCalls.map((tc) => {
						if ('function' in tc) {
							return {
								id: tc.id ?? '',
								name: tc.function.name,
								arguments: tc.function.arguments,
								status: 'success' as const,
							};
						}
						return { ...tc };
					})
				: undefined,
		})),
		systemPrompt: session.systemPrompt,
		title: session.title,
	};
}
