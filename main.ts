import { Plugin, Notice } from 'obsidian';
import {
  type SuperObsidianSettings,
  DEFAULT_SETTINGS,
  SuperObsidianSettingTab,
} from './src/settings';
import {
  createProvider,
  type ProviderKey,
  type LLMProvider,
} from './src/llm/providers';
import {
  OpenAIEmbeddingProvider,
  OllamaEmbeddingProvider,
  CachedEmbeddingProvider,
  type EmbeddingProvider,
} from './src/llm/embedding';
import { JsonFileVectorStore, type VectorStore } from './src/rag/store';
import { VaultIndexer, registerModifyEvent } from './src/rag/indexer';
import { RAGQueryEngine } from './src/rag/query';
import { CHAT_VIEW_TYPE, ChatView } from './src/chat/view';
import { saveChat, type ChatMessage } from './src/chat/persistence';
import { executeDirective, parseDirective } from './src/chat/commands';
import { MCPClientManager } from './src/mcp/client';
import { MCPRegistry } from './src/mcp/registry';

export default class SuperObsidianPlugin extends Plugin {
  settings!: SuperObsidianSettings;
  private provider: LLMProvider | null = null;
  private vectorStore: VectorStore | null = null;
  private embeddingProvider: EmbeddingProvider | null = null;
  ragEngine: RAGQueryEngine | null = null;
  private vaultIndexer: VaultIndexer | null = null;
  private mcpRegistry: MCPRegistry | null = null;
  private modifyCleanup: (() => void) | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.initProvider();
    this.initRAG();
    this.initMCP();

    // 채팅 뷰 등록
    this.registerView(CHAT_VIEW_TYPE, (leaf) => new ChatView(leaf, this));

    // 리본 아이콘
    this.addRibbonIcon('message-circle', 'Open AI Chat', () => {
      void this.openChatView();
    });

    // 명령어
    this.addCommand({
      id: 'open-ai-chat',
      name: 'Open AI Chat',
      callback: () => this.openChatView(),
    });

    this.addCommand({
      id: 'reindex-vault',
      name: 'Reindex Vault for RAG',
      callback: async () => {
        if (!this.vaultIndexer) {
          new Notice('RAG 인덱서가 초기화되지 않았습니다.');
          return;
        }
        new Notice('볼트 인덱싱 시작...');
        try {
          const count = await this.vaultIndexer.reindexAll();
          new Notice(`${count}개 파일 인덱싱 완료`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          new Notice(`인덱싱 실패: ${msg}`);
        }
      },
    });

    this.addCommand({
      id: 'execute-ai-directive',
      name: 'Execute AI Directive',
      editorCallback: async (editor) => {
        const line = editor.getLine(editor.getCursor().line);
        const directive = parseDirective(line);
        if (!directive) {
          new Notice('현재 줄에서 AI 지시어를 찾을 수 없습니다.');
          return;
        }
        await executeDirective(editor, this, directive);
      },
    });

    // 파일 변경 이벤트
    if (this.vaultIndexer) {
      this.modifyCleanup = registerModifyEvent(
        this.app.vault,
        this.vaultIndexer,
        () => {
          // 자동 재인덱싱 완료 (조용히)
        },
      );
    }

    // 설정 탭
    this.addSettingTab(new SuperObsidianSettingTab(this.app, this));
  }

  onunload(): void {
    if (this.modifyCleanup) {
      this.modifyCleanup();
      this.modifyCleanup = null;
    }
    if (this.mcpRegistry) {
      void this.mcpRegistry.disconnectAll();
    }
  }

  async loadSettings(): Promise<void> {
    const raw = (await this.loadData()) as Record<string, unknown>;
    const data = raw == null ? {} : { ...raw };

    const providerKeys = ['openai', 'claude', 'ollama', 'ollamaCloud', 'openRouter'] as const;
    for (const pk of providerKeys) {
      const pConf = data[pk] as Record<string, unknown> | undefined;
      if (pConf && 'model' in pConf && Array.isArray(pConf.models) === false) {
        const rawModel = pConf.model;
        const oldModel = typeof rawModel === 'string' ? rawModel : '';
        pConf.models = oldModel ? [oldModel] : [];
      }
      if (pConf && typeof pConf.baseUrl === 'string') {
        let url = pConf.baseUrl.trim();
        if ((pk === 'ollama' || pk === 'ollamaCloud') && url === 'https://api.ollama.com') {
          url = 'https://ollama.com';
        }
        url = url.replace(/\/+$/, '');
        if (url.endsWith('/api')) {
          url = url.slice(0, -4);
        }
        url = url.replace(/\/+$/, '');
        pConf.baseUrl = url;
      }
    }

    const chat = data.chat;
    if (
      chat &&
      typeof chat === 'object' &&
      !Array.isArray(chat) &&
      'defaultProvider' in chat &&
      !('defaultModel' in chat)
    ) {
      const chatObj = chat as Record<string, unknown>;
      const rawProvider = chatObj.defaultProvider;
      const oldProvider = typeof rawProvider === 'string' ? rawProvider : '';
      const oldModel = ((data[oldProvider] as Record<string, unknown> | undefined)?.models as string[] | undefined)?.[0] ?? '';
      if (oldProvider && oldModel) {
        chatObj.defaultModel = `${oldProvider}:${oldModel}`;
      }
    }

    this.settings = Object.assign({}, DEFAULT_SETTINGS, data as Partial<SuperObsidianSettings>);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.initProvider();
    this.initRAG();
    this.initMCP();
  }

  getActiveProvider(): LLMProvider | null {
    if (this.provider) return this.provider;
    this.initProvider();
    return this.provider;
  }

  async saveChat(messages: ChatMessage[]): Promise<void> {
    await saveChat(this.app.vault, messages, this.settings.chat.saveFolder);
  }

  private initProvider(): void {
    const defaultModel = this.settings.chat.defaultModel;
    if (!defaultModel) {
      this.provider = null;
      return;
    }
    const parts = defaultModel.split(':');
    if (parts.length < 2) {
      this.provider = null;
      return;
    }
    const providerKey = parts[0] as ProviderKey;
    const modelName = parts.slice(1).join(':');

    const config = this.settings[providerKey];
    if (!config?.enabled || !config.models.includes(modelName)) {
      this.provider = null;
      return;
    }
    try {
      this.provider = createProvider(providerKey, config, modelName);
    } catch {
      this.provider = null;
    }
  }

  private initRAG(): void {
    const defaultModel = this.settings.chat.defaultModel;
    if (!defaultModel) {
      this.vectorStore = null;
      this.embeddingProvider = null;
      this.ragEngine = null;
      this.vaultIndexer = null;
      return;
    }
    const parts = defaultModel.split(':');
    if (parts.length < 2) {
      this.vectorStore = null;
      this.embeddingProvider = null;
      this.ragEngine = null;
      this.vaultIndexer = null;
      return;
    }
    const activeKey = parts[0] as ProviderKey;
    const config = this.settings[activeKey];
    if (!config?.enabled) {
      this.vectorStore = null;
      this.embeddingProvider = null;
      this.ragEngine = null;
      this.vaultIndexer = null;
      return;
    }

    // Embedding provider 선택
    if (activeKey === 'ollama' || activeKey === 'ollamaCloud') {
      this.embeddingProvider = new CachedEmbeddingProvider(
        new OllamaEmbeddingProvider(config.baseUrl, 'nomic-embed-text', config.apiKey),
      );
    } else {
      this.embeddingProvider = new CachedEmbeddingProvider(
        new OpenAIEmbeddingProvider(config.apiKey, config.baseUrl),
      );
    }

    // Vector store
    this.vectorStore = new JsonFileVectorStore(
      this.app.vault.adapter,
      '.super-obsidian/vectors.json',
    );

    // RAG 엔진
    this.ragEngine = new RAGQueryEngine(this.vectorStore, this.embeddingProvider);

    // Indexer
    this.vaultIndexer = new VaultIndexer(
      this.app.vault,
      this.vectorStore,
      this.embeddingProvider,
      this.settings.rag,
    );
  }

  private initMCP(): void {
    if (!this.mcpRegistry) {
      this.mcpRegistry = new MCPRegistry(this.settings.mcpServers);
    }
    // 활성 stdio 서버에 대해 클라이언트 연결 시도
    for (const server of this.mcpRegistry.getEnabledServers()) {
      if (server.transport === 'stdio' && server.command) {
        const client = new MCPClientManager();
        this.mcpRegistry.setClient(server.name, client);
        void client.connectStdio({ name: server.name, enabled: server.enabled, command: server.command, args: server.args, transport: 'stdio' }).catch(() => {
          // ignore connection failure
        });
      }
    }
  }

  private async openChatView(): Promise<void> {
    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: CHAT_VIEW_TYPE, active: true });
    void this.app.workspace.revealLeaf(leaf);
    return Promise.resolve();
  }
}
