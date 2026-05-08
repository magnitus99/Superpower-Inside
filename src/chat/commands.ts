import { Editor, Notice } from 'obsidian';
import type { PluginLike } from '../settings';
import type { ChatMessage } from '../llm/providers';

export interface Directive {
  command: string;
  args: string;
}

const DIRECTIVE_PATTERN = /^\s*>AI:\s*(\w+)\s*(.*)$/;
const ALT_DIRECTIVE_PATTERN = /^\s*\[!AI\|(\w+)\]\s*(.*)$/;

export function parseDirective(line: string): Directive | null {
  const match = DIRECTIVE_PATTERN.exec(line) ?? ALT_DIRECTIVE_PATTERN.exec(line);
  if (!match) return null;
  return { command: match[1].toLowerCase(), args: match[2].trim() };
}

export interface CommandContext {
  editor: Editor;
  plugin: PluginLike;
  provider: NonNullable<ReturnType<typeof import('../llm/providers').createProvider> extends infer R ? R : never>;
}

export async function executeDirective(
  editor: Editor,
  plugin: PluginLike,
  directive: Directive,
): Promise<void> {
  const cursor = editor.getCursor();
  const line = editor.getLine(cursor.line);
  const endPos = { line: cursor.line, ch: line.length };

  editor.replaceRange('\n', endPos);

  const spinnerLine = cursor.line + 1;
  const spinnerText = '⏳ 생성 중...\n';
  editor.replaceRange(spinnerText, { line: spinnerLine, ch: 0 });

  try {
    let prompt = '';
    const selection = editor.getSelection();
    const content = selection || editor.getValue();

    switch (directive.command) {
      case 'summarize':
      case '요약':
        prompt = `다음 내용을 요약해줘:\n\n${content}`;
        break;
      case 'expand':
      case '확장':
        prompt = `다음 내용을 더 자세히 확장해줘:\n\n${content}`;
        break;
      case 'rewrite':
      case '다시쓰기':
        prompt = `다음 내용을 다시 써줘 (더 명확하고 간결하게):\n\n${content}`;
        break;
      case 'ask':
      case '질문':
        prompt = `${content}\n\n위 내용에 대해 다음 질문에 답해줘: ${directive.args}`;
        break;
      case 'search':
      case '검색': {
        const rag = (plugin as unknown as { ragEngine?: { queryWithContext: (q: string, k: number) => Promise<string> } }).ragEngine;
        const context = rag ? await rag.queryWithContext(directive.args || content, 3) : '';
        prompt = `볼트 내용을 바탕으로 다음 질문에 답해줘:\n\n질문: ${directive.args || content}\n\n컨텍스트:\n${context || '관련 내용을 찾을 수 없습니다.'}`;
        break;
      }
      default:
        prompt = `${content}\n\n${directive.args}`;
    }

    if (plugin.settings.pluginAwareEnabled) {
      const { formatActivePluginsForPrompt } = await import('../utils/obsidian-compat');
      const app = plugin.app;
      const pluginInfo = formatActivePluginsForPrompt(app);
      if (pluginInfo) prompt += pluginInfo;
    }

    const messages: ChatMessage[] = [{ role: 'user', content: prompt }];
    let result = '';

    const { createProvider } = await import('../llm/providers');
    
    const defaultModel = plugin.settings.chat.defaultModel;
    if (!defaultModel) {
      throw new Error('기본 모델이 설정되지 않았습니다.');
    }
    
    const parts = defaultModel.split(':');
    if (parts.length < 2) {
      throw new Error('기본 모델 설정 형식이 잘못되었습니다.');
    }
    
    const key = parts[0] as 'openai' | 'claude' | 'ollama' | 'ollamaCloud' | 'openRouter';
    const modelName = parts.slice(1).join(':');
    const config = plugin.settings[key];
    if (!config.enabled) {
      throw new Error('기본 Provider가 활성화되지 않았습니다.');
    }
    const provider = createProvider(key, config, modelName);

    await provider.streamChat(
      messages,
      (chunk) => {
        if (chunk.content) result += chunk.content;
      },
      0.7,
    );

    // 스피너 제거 후 결과 삽입
    const spinnerLineContent = editor.getLine(spinnerLine);
    editor.replaceRange(
      `\n${result}\n`,
      { line: spinnerLine, ch: 0 },
      { line: spinnerLine, ch: spinnerLineContent.length },
    );
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    new Notice(`명령어 실행 실패: ${errorMsg}`);
    const spinnerLineContent = editor.getLine(spinnerLine);
    editor.replaceRange(
      `❌ 오류: ${errorMsg}\n`,
      { line: spinnerLine, ch: 0 },
      { line: spinnerLine, ch: spinnerLineContent.length },
    );
  }
}
