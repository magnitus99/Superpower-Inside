import { ItemView, WorkspaceLeaf, Notice, MarkdownRenderer } from 'obsidian';
import type { PluginLike } from '../settings';
import type { ChatMessage, StreamChunk } from '../llm/providers';
import { t } from '../i18n';

export const CHAT_VIEW_TYPE = 'super-obsidian-chat';

interface ChatMessageWithMeta extends ChatMessage {
  id: string;
  timestamp: number;
}

export class ChatView extends ItemView {
  private plugin: PluginLike;
  private messages: ChatMessageWithMeta[];
  private sessionSystemPrompt: string | null;
  private isStreaming: boolean;
  private autoScroll: boolean;

  private container: HTMLElement | null;
  private headerEl: HTMLElement | null;
  private messagesArea: HTMLElement | null;
  private inputArea: HTMLTextAreaElement | null;
  private sendBtn: HTMLButtonElement | null;
  private mcpBtn: HTMLButtonElement | null;
  private typingIndicator: HTMLElement | null;
  private scrollBtn: HTMLElement | null;
  private sysPromptEditor: HTMLElement | null;

  private messageEls: Map<string, HTMLElement>;

  constructor(leaf: WorkspaceLeaf, plugin: PluginLike) {
    super(leaf);
    this.plugin = plugin;
    this.messages = [];
    this.sessionSystemPrompt = null;
    this.isStreaming = false;
    this.autoScroll = true;
    this.messageEls = new Map();
    this.container = null;
    this.headerEl = null;
    this.messagesArea = null;
    this.inputArea = null;
    this.sendBtn = null;
    this.mcpBtn = null;
    this.typingIndicator = null;
    this.scrollBtn = null;
    this.sysPromptEditor = null;
  }

  getViewType(): string {
    return CHAT_VIEW_TYPE;
  }

  getDisplayText(): string {
    return t('chatTabTitle');
  }

  async onOpen(): Promise<void> {
    await Promise.resolve();
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass('super-obsidian-chat-container');
    this.container = root;

    this.buildHeader(root);

    this.messagesArea = root.createDiv({ cls: 'super-obsidian-chat-messages' });
    this.messagesArea.addEventListener('scroll', () => this.handleScroll());

    this.scrollBtn = root.createDiv({ cls: 'super-obsidian-scroll-to-bottom' });
    this.scrollBtn.style.display = 'none';
    this.scrollBtn.setText(t('chatScrollToBottom'));
    this.scrollBtn.addEventListener('click', () => this.scrollToBottom());

    this.typingIndicator = this.messagesArea.createDiv({
      cls: 'super-obsidian-typing-indicator',
    });
    this.typingIndicator.style.display = 'none';
    this.typingIndicator.innerHTML = `<span class="super-obsidian-typing-dot"></span><span class="super-obsidian-typing-dot"></span><span class="super-obsidian-typing-dot"></span><span class="super-obsidian-typing-text">${t('chatTyping')}</span>`;

    this.buildInputArea(root);
  }

  async onClose(): Promise<void> {
    if (this.messages.length > 0 && this.plugin.settings.chat.saveFolder) {
      const { saveChat } = await import('./persistence');
      await saveChat(
        this.app.vault,
        this.messages,
        this.plugin.settings.chat.saveFolder,
        this.sessionSystemPrompt ?? undefined,
      );
    }
  }

  private buildHeader(container: HTMLElement): void {
    this.headerEl = container.createDiv({ cls: 'super-obsidian-chat-header' });
    this.headerEl.createSpan({ cls: 'super-obsidian-chat-title', text: t('chatTabTitle') });

    const actions = this.headerEl.createDiv({ cls: 'super-obsidian-chat-header-actions' });

    const sysToggle = actions.createEl('button', {
      cls: 'super-obsidian-chat-header-btn',
      text: '⚙️',
      attr: { 'aria-label': '시스템 프롬프트' },
    });
    sysToggle.addEventListener('click', () => this.toggleSystemPromptEditor());

    const clearBtn = actions.createEl('button', {
      cls: 'super-obsidian-chat-header-btn',
      text: t('chatClear'),
    });
    clearBtn.addEventListener('click', () => this.clearMessages());

    this.sysPromptEditor = container.createDiv({ cls: 'super-obsidian-system-prompt-editor' });
    this.sysPromptEditor.style.display = 'none';

    this.sysPromptEditor.createDiv({
      cls: 'super-obsidian-system-prompt-editor-label',
      text: '세션 시스템 프롬프트',
    });
    const ta = this.sysPromptEditor.createEl('textarea', {
      cls: 'super-obsidian-chat-input',
      attr: { rows: '4', placeholder: t('systemPromptPlaceholder') },
    });
    const editorActions = this.sysPromptEditor.createDiv({
      cls: 'super-obsidian-system-prompt-editor-actions',
    });
    const applyBtn = editorActions.createEl('button', {
      cls: 'super-obsidian-chat-send-btn',
      text: '적용',
    });
    applyBtn.addEventListener('click', () => {
      this.sessionSystemPrompt = ta.value.trim() || null;
      this.updateSystemPromptBadge();
      this.sysPromptEditor!.style.display = 'none';
      new Notice('세션 시스템 프롬프트가 적용되었습니다.');
    });
    const cancelBtn = editorActions.createEl('button', {
      cls: 'super-obsidian-chat-header-btn',
      text: t('cancel'),
    });
    cancelBtn.addEventListener('click', () => {
      this.sysPromptEditor!.style.display = 'none';
    });
  }

  private toggleSystemPromptEditor(): void {
    if (!this.sysPromptEditor) return;
    const isVisible = this.sysPromptEditor.style.display !== 'none';
    this.sysPromptEditor.style.display = isVisible ? 'none' : 'block';
    if (!isVisible) {
      const ta = this.sysPromptEditor.querySelector('textarea') as HTMLTextAreaElement;
      if (ta) {
        ta.value = this.sessionSystemPrompt ?? this.plugin.settings.chat.systemPrompt ?? '';
      }
    }
  }

  private updateSystemPromptBadge(): void {}

  private buildInputArea(container: HTMLElement): void {
    const wrapper = container.createDiv({ cls: 'super-obsidian-chat-input-wrapper' });

    const toolbar = wrapper.createDiv({ cls: 'super-obsidian-chat-input-toolbar' });
    this.mcpBtn = toolbar.createEl('button', {
      cls: 'super-obsidian-chat-toolbar-btn',
      text: t('toolbarTools'),
    });
    this.mcpBtn.addEventListener('click', () => void this.openMcpToolPicker());

    const inputRow = wrapper.createDiv({ cls: 'super-obsidian-chat-input-area' });
    this.inputArea = inputRow.createEl('textarea', {
      cls: 'super-obsidian-chat-input',
      attr: { placeholder: '메시지를 입력하세요...', rows: '2' },
    });
    this.inputArea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void this.handleSend();
      }
    });
    this.inputArea.addEventListener('input', () => this.autoResizeInput());

    this.sendBtn = inputRow.createEl('button', {
      cls: 'super-obsidian-chat-send-btn',
      text: t('sendButton'),
    });
    this.sendBtn.addEventListener('click', () => void this.handleSend());
  }

  private autoResizeInput(): void {
    if (!this.inputArea) return;
    this.inputArea.style.height = 'auto';
    this.inputArea.style.height = `${Math.min(this.inputArea.scrollHeight, 200)}px`;
  }

  private handleScroll(): void {
    if (!this.messagesArea) return;
    const { scrollTop, scrollHeight, clientHeight } = this.messagesArea;
    const nearBottom = scrollHeight - scrollTop - clientHeight < 60;
    this.autoScroll = nearBottom;
    if (this.scrollBtn) {
      this.scrollBtn.style.display = nearBottom ? 'none' : 'flex';
    }
  }

  private scrollToBottom(): void {
    if (!this.messagesArea) return;
    this.messagesArea.scrollTo({ top: this.messagesArea.scrollHeight, behavior: 'smooth' });
    this.autoScroll = true;
    if (this.scrollBtn) this.scrollBtn.style.display = 'none';
  }

  addMessage(role: ChatMessage['role'], content: string): string {
    const id = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const msg: ChatMessageWithMeta = { id, role, content, timestamp: Date.now() };
    this.messages.push(msg);

    const wrapper = this.messagesArea!.createDiv({
      cls: `super-obsidian-chat-message-wrapper ${role}`,
    });
    this.messageEls.set(id, wrapper);

    const avatar = wrapper.createDiv({ cls: 'super-obsidian-chat-avatar' });
    avatar.setText(this.getAvatarText(role));

    const bubbleContainer = wrapper.createDiv({ cls: 'super-obsidian-chat-bubble-container' });

    const meta = bubbleContainer.createDiv({ cls: 'super-obsidian-chat-meta' });
    meta.createSpan({ cls: 'super-obsidian-chat-role', text: this.getRoleLabel(role) });
    meta.createSpan({
      cls: 'super-obsidian-chat-timestamp',
      text: this.formatTimestamp(msg.timestamp),
    });

    const bubble = bubbleContainer.createDiv({
      cls: `super-obsidian-chat-bubble ${role}`,
    });
    bubble.setText(content);

    if (this.autoScroll) {
      this.scrollToBottom();
    }
    return id;
  }

  updateMessage(id: string, content: string, isDone: boolean): void {
    const wrapper = this.messageEls.get(id);
    if (!wrapper) return;
    const bubble = wrapper.querySelector('.super-obsidian-chat-bubble');
    if (!(bubble instanceof HTMLElement)) return;

    if (!isDone) {
      bubble.innerHTML = escapeHtml(content).replace(/\n/g, '<br>');
    } else {
      void this.renderMarkdownBubble(bubble, content);
    }

    if (this.autoScroll) {
      this.scrollToBottom();
    }
  }

  private async renderMarkdownBubble(bubble: HTMLElement, content: string): Promise<void> {
    bubble.empty();
    await MarkdownRenderer.renderMarkdown(content, bubble, '', this);
    this.enhanceCodeBlocks(bubble);
  }

  private enhanceCodeBlocks(container: HTMLElement): void {
    const pres = container.querySelectorAll('pre');
    for (const pre of Array.from(pres)) {
      const wrapper = document.createElement('div');
      wrapper.addClass('super-obsidian-code-block-wrapper');
      pre.parentNode!.insertBefore(wrapper, pre);
      wrapper.appendChild(pre);

      const copyBtn = wrapper.createEl('button', {
        cls: 'super-obsidian-code-copy-btn',
        text: t('copyCode'),
      });
      copyBtn.addEventListener('click', () => {
        const code = pre.querySelector('code')?.textContent ?? pre.textContent ?? '';
        void navigator.clipboard.writeText(code).then(() => {
          copyBtn.setText(t('copied'));
          setTimeout(() => copyBtn.setText(t('copyCode')), 2000);
        });
      });
    }
  }

  private getAvatarText(role: string): string {
    switch (role) {
      case 'user':
        return '👤';
      case 'assistant':
        return '🤖';
      case 'system':
        return '⚙️';
      case 'tool':
        return '🔧';
      default:
        return '•';
    }
  }

  private getRoleLabel(role: string): string {
    switch (role) {
      case 'user':
        return t('messageUser');
      case 'assistant':
        return t('messageAssistant');
      case 'system':
        return t('messageSystem');
      case 'tool':
        return t('messageTool');
      default:
        return role;
    }
  }

  private formatTimestamp(ts: number): string {
    const diff = Date.now() - ts;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    if (diff < 60000) return t('timestampJustNow');
    if (minutes < 60) return t('timestampMinutesAgo', { count: minutes });
    if (hours < 24) return t('timestampHoursAgo', { count: hours });
    return new Date(ts).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  }

  clearMessages(): void {
    this.messages = [];
    this.sessionSystemPrompt = null;
    this.messageEls.clear();
    if (this.messagesArea) {
      const children = Array.from(this.messagesArea.children);
      for (const child of children) {
        if (!child.hasClass('super-obsidian-typing-indicator')) {
          child.remove();
        }
      }
    }
  }

  private async handleSend(): Promise<void> {
    const text = this.inputArea?.value.trim();
    if (!text || this.isStreaming) return;

    const { createProvider } = await import('../llm/providers');

    const defaultModel = this.plugin.settings.chat.defaultModel;
    if (!defaultModel) {
      new Notice('기본 모델이 설정되지 않았습니다. 설정 탭에서 모델을 선택하세요.');
      return;
    }

    const parts = defaultModel.split(':');
    if (parts.length < 2) {
      new Notice('기본 모델 설정 형식이 잘못되었습니다.');
      return;
    }

    const key = parts[0] as 'openai' | 'claude' | 'ollama' | 'ollamaCloud' | 'openRouter';
    const modelName = parts.slice(1).join(':');
    const config = this.plugin.settings[key];

    if (!config?.enabled) {
      new Notice('활성화된 LLM Provider가 없습니다. 설정에서 Provider를 활성화하세요.');
      return;
    }

    const provider = createProvider(key, config, modelName);
    if (!provider) {
      new Notice('Provider 생성에 실패했습니다.');
      return;
    }

    this.inputArea!.value = '';
    this.autoResizeInput();
    this.addMessage('user', text);
    this.setLoading(true);

    if (this.typingIndicator) this.typingIndicator.style.display = 'flex';

    try {
      const systemPrompt = await this.buildSystemPrompt();
      const messages: ChatMessage[] = [
        ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
        ...this.messages.slice(-10).map((m) => ({ role: m.role, content: m.content })),
      ];

      if (this.typingIndicator) this.typingIndicator.style.display = 'none';
      const assistantId = this.addMessage('assistant', '');

      let fullText = '';
      await provider.streamChat(
        messages,
        (chunk: StreamChunk) => {
          if (chunk.content) {
            fullText += chunk.content;
            this.updateMessage(assistantId, fullText, chunk.done);
          }
        },
        0.7,
      );
      this.updateMessage(assistantId, fullText, true);
    } catch (err) {
      if (this.typingIndicator) this.typingIndicator.style.display = 'none';
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.addMessage('assistant', `오류: ${errorMsg}`);
    } finally {
      this.setLoading(false);
    }
  }

  private setLoading(loading: boolean): void {
    this.isStreaming = loading;
    if (this.sendBtn) this.sendBtn.disabled = loading;
    if (this.inputArea) this.inputArea.disabled = loading;
    if (this.mcpBtn) this.mcpBtn.disabled = loading;
  }

  private async buildSystemPrompt(): Promise<string | null> {
    const parts: string[] = [];
    const globalPrompt = this.plugin.settings.chat.systemPrompt?.trim();
    const sessionPrompt = this.sessionSystemPrompt ?? globalPrompt;
    if (sessionPrompt) parts.push(sessionPrompt);

    if (this.plugin.settings.pluginAwareEnabled) {
      const { formatActivePluginsForPrompt } = await import('../utils/obsidian-compat');
      const pluginInfo = formatActivePluginsForPrompt(this.app);
      if (pluginInfo) parts.push(pluginInfo);
    }

    const lastUserMsg = this.messages[this.messages.length - 1];
    if (lastUserMsg && lastUserMsg.role === 'user') {
      try {
        const rag = (
          this.plugin as unknown as {
            ragEngine?: { queryWithContext: (q: string, k: number) => Promise<string> };
          }
        ).ragEngine;
        const context = rag ? await rag.queryWithContext(lastUserMsg.content, 3) : '';
        if (context) {
          parts.push(`\n\n[Vault Context]\n${context}`);
        }
      } catch {
        // RAG 실패 시 무시
      }
    }

    return parts.length > 0 ? parts.join('\n') : null;
  }

  private async openMcpToolPicker(): Promise<void> {
    const registry = this.plugin.mcpRegistry;
    if (!registry || registry.getConnectedCount() === 0) {
      new Notice(t('noToolsAvailable'));
      return;
    }

    const overlay = this.container!.createDiv({
      cls: 'super-obsidian-mcp-tool-picker-overlay',
    });
    const panel = overlay.createDiv({ cls: 'super-obsidian-mcp-tool-picker' });

    const title = panel.createDiv({
      cls: 'super-obsidian-mcp-tool-picker-title',
      text: t('selectTool'),
    });
    const closeBtn = title.createEl('button', {
      cls: 'super-obsidian-mcp-tool-picker-close',
      text: '×',
    });
    const close = () => overlay.remove();
    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });

    const list = panel.createDiv({ cls: 'super-obsidian-mcp-tool-list' });

    for (const server of registry.getEnabledServers()) {
      const client = registry.getClient(server.name);
      if (!client) continue;
      try {
        const tools = await client.listTools();
        if (tools.length === 0) continue;
        list.createDiv({
          cls: 'super-obsidian-mcp-tool-server',
          text: server.name,
        });
        for (const tool of tools) {
          const item = list.createDiv({ cls: 'super-obsidian-mcp-tool-item' });
          item.createDiv({ cls: 'super-obsidian-mcp-tool-name', text: tool.name });
          if (tool.description) {
            item.createDiv({
              cls: 'super-obsidian-mcp-tool-desc',
              text: tool.description,
            });
          }
          item.addEventListener('click', () => {
            close();
            void this.openMcpToolForm(server.name, tool.name, tool.inputSchema ?? {});
          });
        }
      } catch {
        // 서버 스킵
      }
    }

    if (list.children.length === 0) {
      list.createDiv({
        cls: 'super-obsidian-mcp-empty-state-desc',
        text: t('noToolsAvailable'),
      });
    }
  }

  private openMcpToolForm(
    serverName: string,
    toolName: string,
    inputSchema: Record<string, unknown>,
  ): void {
    const overlay = this.container!.createDiv({
      cls: 'super-obsidian-mcp-tool-picker-overlay',
    });
    const panel = overlay.createDiv({ cls: 'super-obsidian-mcp-tool-picker' });

    const title = panel.createDiv({
      cls: 'super-obsidian-mcp-tool-picker-title',
      text: toolName,
    });
    const closeBtn = title.createEl('button', {
      cls: 'super-obsidian-mcp-tool-picker-close',
      text: '×',
    });
    const close = () => overlay.remove();
    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });

    const form = panel.createDiv({ cls: 'super-obsidian-mcp-tool-form' });
    const inputs: {
      key: string;
      el: HTMLInputElement | HTMLTextAreaElement;
    }[] = [];

    const schema = inputSchema as {
      properties?: Record<string, { type?: string; description?: string }>;
      required?: string[];
    };
    const properties = schema.properties ?? {};
    const required = new Set(schema.required ?? []);

    for (const [propName, propDef] of Object.entries(properties)) {
      const row = form.createDiv({ cls: 'super-obsidian-mcp-tool-form-row' });
      row.createEl('label', {
        cls: 'super-obsidian-mcp-tool-form-label',
        text: propName,
      });
      if (propDef.description) {
        row.createDiv({
          cls: 'super-obsidian-mcp-tool-form-desc',
          text: propDef.description,
        });
      }

      let inputEl: HTMLInputElement | HTMLTextAreaElement;
      const type = propDef.type ?? 'string';
      if (type === 'boolean') {
        inputEl = row.createEl('input', {
          type: 'checkbox',
          cls: 'super-obsidian-mcp-tool-form-input',
        });
      } else if (type === 'number' || type === 'integer') {
        inputEl = row.createEl('input', {
          type: 'number',
          cls: 'super-obsidian-mcp-tool-form-input',
        });
      } else if (type === 'string') {
        inputEl = row.createEl('input', {
          type: 'text',
          cls: 'super-obsidian-mcp-tool-form-input',
        });
      } else {
        inputEl = row.createEl('textarea', {
          cls: 'super-obsidian-mcp-tool-form-input',
          attr: { rows: '3' },
        });
      }
      if (required.has(propName)) {
        inputEl.required = true;
      }
      inputs.push({ key: propName, el: inputEl });
    }

    const actions = panel.createDiv({
      cls: 'super-obsidian-mcp-tool-form-actions',
    });
    const execBtn = actions.createEl('button', {
      cls: 'super-obsidian-chat-send-btn',
      text: t('executeTool'),
    });
    execBtn.addEventListener('click', () => {
      const values: Record<string, unknown> = {};
      for (const { key, el } of inputs) {
        if (el.type === 'checkbox') {
          values[key] = (el as HTMLInputElement).checked;
        } else if (el.type === 'number') {
          values[key] = parseFloat(el.value);
        } else {
          try {
            const trimmed = el.value.trim();
            if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
              values[key] = JSON.parse(trimmed);
            } else {
              values[key] = trimmed;
            }
          } catch {
            values[key] = el.value.trim();
          }
        }
      }
      close();
      void this.executeMcpTool(serverName, toolName, values);
    });
  }

  private async executeMcpTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<void> {
    const registry = this.plugin.mcpRegistry;
    if (!registry) return;
    const client = registry.getClient(serverName);
    if (!client) return;

    const runId = this.addMessage('tool', `${t('mcpToolRunning')} ${toolName}...`);

    try {
      const result = await client.callTool(toolName, args);
      const formatted = this.formatToolResult(result);
      this.updateMessage(
        runId,
        `**${t('mcpToolSuccess')} — ${toolName}**\n\n${formatted}`,
        true,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.updateMessage(runId, `**${t('mcpToolError')} — ${toolName}**\n\n${msg}`, true);
    }
  }

  private formatToolResult(result: unknown): string {
    if (result === null) return 'null';
    if (typeof result === 'string') return result;
    if (typeof result === 'number' || typeof result === 'boolean') return String(result);
    return '```json\n' + JSON.stringify(result, null, 2) + '\n```';
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
