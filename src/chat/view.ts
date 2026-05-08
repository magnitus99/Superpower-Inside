import { ItemView, WorkspaceLeaf, Notice } from 'obsidian';
import type { PluginLike } from '../settings';
import type { ChatMessage, StreamChunk } from '../llm/providers';

export const CHAT_VIEW_TYPE = 'super-obsidian-chat';

export class ChatView extends ItemView {
  private plugin: PluginLike;
  private messages: ChatMessage[];
  private isStreaming: boolean;
  private messagesArea: HTMLElement | null;
  private inputArea: HTMLTextAreaElement | null;
  private sendBtn: HTMLButtonElement | null;

  constructor(leaf: WorkspaceLeaf, plugin: PluginLike) {
    super(leaf);
    this.plugin = plugin;
    this.messages = [];
    this.isStreaming = false;
    this.messagesArea = null;
    this.inputArea = null;
    this.sendBtn = null;
  }

  getViewType(): string {
    return CHAT_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'AI Chat';
  }

  async onOpen(): Promise<void> {
    await Promise.resolve();
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass('super-obsidian-chat-container');

    this.messagesArea = container.createDiv({ cls: 'super-obsidian-chat-messages' });

    const inputRow = container.createDiv({ cls: 'super-obsidian-chat-input-area' });
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

    this.sendBtn = inputRow.createEl('button', {
      cls: 'super-obsidian-chat-send-btn',
      text: 'Send',
    });
    this.sendBtn.addEventListener('click', () => void this.handleSend());
  }

  async onClose(): Promise<void> {
    // 뷰 닫힐 때 자동 저장 옵션
    if (this.messages.length > 0 && this.plugin.settings.chat.saveFolder) {
      const { saveChat } = await import('./persistence');
      await saveChat(this.app.vault, this.messages, this.plugin.settings.chat.saveFolder);
    }
  }

  addMessage(role: ChatMessage['role'], content: string): void {
    this.messages.push({ role, content });
    const bubble = this.messagesArea?.createDiv({
      cls: `super-obsidian-chat-message ${role}`,
    });
    if (bubble) {
      bubble.setText(content);
      bubble.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }

  updateLastMessage(content: string): void {
    const last = this.messages[this.messages.length - 1];
    if (last && last.role === 'assistant') {
      last.content = content;
    }
    const bubbles = this.messagesArea?.querySelectorAll('.super-obsidian-chat-message.assistant');
    if (bubbles && bubbles.length > 0) {
      const lastBubble = bubbles[bubbles.length - 1] as HTMLElement;
      lastBubble.setText(content);
      lastBubble.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }

  clearMessages(): void {
    this.messages = [];
    if (this.messagesArea) this.messagesArea.empty();
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
    this.addMessage('user', text);
    this.setLoading(true);

    // 스피너 메시지
    const spinner = this.messagesArea!.createDiv({
      cls: 'super-obsidian-chat-message system',
    });
    spinner.createSpan({ cls: 'super-obsidian-spinner' });
    spinner.appendText(' 생성 중...');

    try {
      // RAG 컨텍스트 주입
      const systemPrompt = await this.buildSystemPrompt();
      const messages: ChatMessage[] = [
        ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
        ...this.messages.slice(-10), // 최근 10개 메시지만 컨텍스트
      ];

      // 스피너 제거
      spinner.remove();

      // 빈 assistant 메시지 추가 (스트리밍용)
      this.messages.push({ role: 'assistant', content: '' });
      const bubble = this.messagesArea!.createDiv({
        cls: 'super-obsidian-chat-message assistant',
      });
      bubble.setText('');

      let fullText = '';
      await provider.streamChat(
        messages,
        (chunk: StreamChunk) => {
          if (chunk.content) {
            fullText += chunk.content;
            this.updateLastMessage(fullText);
          }
        },
        0.7,
      );
    } catch (err) {
      spinner.remove();
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
  }

  private async buildSystemPrompt(): Promise<string | null> {
    const parts: string[] = [];

    // 활성 플러그인 정보
    if (this.plugin.settings.pluginAwareEnabled) {
      const { formatActivePluginsForPrompt } = await import('../utils/obsidian-compat');
      const pluginInfo = formatActivePluginsForPrompt(this.app);
      if (pluginInfo) parts.push(pluginInfo);
    }

    // RAG 컨텍스트
    const lastUserMsg = this.messages[this.messages.length - 1];
    if (lastUserMsg && lastUserMsg.role === 'user') {
      try {
        const rag = (this.plugin as unknown as { ragEngine?: { queryWithContext: (q: string, k: number) => Promise<string> } }).ragEngine;
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
}
