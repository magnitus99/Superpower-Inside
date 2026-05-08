import type { ProviderConfig } from '../settings';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface StreamChunk {
  content: string;
  done: boolean;
}

export interface LLMProvider {
  chat(messages: ChatMessage[], temperature?: number): Promise<string>;
  streamChat(
    messages: ChatMessage[],
    onChunk: (chunk: StreamChunk) => void,
    temperature?: number,
  ): Promise<void>;
}

/* ---------- OpenAI / OpenRouter Compatible ---------- */

class OpenAICompatibleProvider implements LLMProvider {
  protected config: ProviderConfig;
  protected endpoint: string;

  constructor(config: ProviderConfig, endpointOverride?: string) {
    this.config = config;
    this.endpoint = endpointOverride ?? `${config.baseUrl ?? 'https://api.openai.com'}/v1/chat/completions`;
  }

  async chat(messages: ChatMessage[], temperature = 0.7): Promise<string> {
    const body = {
      model: this.config.model,
      messages,
      temperature,
      stream: false,
    };
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`LLM chat failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return data.choices?.[0]?.message?.content ?? '';
  }

  async streamChat(
    messages: ChatMessage[],
    onChunk: (chunk: StreamChunk) => void,
    temperature = 0.7,
  ): Promise<void> {
    const body = {
      model: this.config.model,
      messages,
      temperature,
      stream: true,
    };
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`LLM stream failed: ${res.status} ${await res.text()}`);
    }
    const reader = res.body?.getReader();
    if (!reader) {
      throw new Error('ReadableStream not available');
    }
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') {
          onChunk({ content: '', done: true });
          return;
        }
        if (!data) continue;
        try {
          const chunk = JSON.parse(data) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const content = chunk.choices?.[0]?.delta?.content ?? '';
          onChunk({ content, done: false });
        } catch {
          // 잘못된 SSE 라인 무시
        }
      }
    }
    onChunk({ content: '', done: true });
  }

  protected buildHeaders(): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.config.apiKey) {
      h.Authorization = `Bearer ${this.config.apiKey}`;
    }
    return h;
  }
}

/* ---------- Claude (Anthropic Messages API) ---------- */

class ClaudeProvider implements LLMProvider {
  private config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  async chat(messages: ChatMessage[], temperature = 0.7): Promise<string> {
    const res = await fetch(`${this.config.baseUrl ?? 'https://api.anthropic.com'}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.config.model,
        max_tokens: 4096,
        temperature,
        messages: messages.filter((m) => m.role !== 'system').map((m) => ({
          role: m.role,
          content: m.content,
        })),
        system: messages.find((m) => m.role === 'system')?.content,
      }),
    });
    if (!res.ok) {
      throw new Error(`Claude chat failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    return data.content?.find((c) => c.type === 'text')?.text ?? '';
  }

  async streamChat(
    messages: ChatMessage[],
    onChunk: (chunk: StreamChunk) => void,
    temperature = 0.7,
  ): Promise<void> {
    const res = await fetch(`${this.config.baseUrl ?? 'https://api.anthropic.com'}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.config.model,
        max_tokens: 4096,
        temperature,
        stream: true,
        messages: messages.filter((m) => m.role !== 'system').map((m) => ({
          role: m.role,
          content: m.content,
        })),
        system: messages.find((m) => m.role === 'system')?.content,
      }),
    });
    if (!res.ok) {
      throw new Error(`Claude stream failed: ${res.status} ${await res.text()}`);
    }
    const reader = res.body?.getReader();
    if (!reader) {
      throw new Error('ReadableStream not available');
    }
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (!data) continue;
        try {
          const event = JSON.parse(data) as {
            type: string;
            delta?: { text?: string };
          };
          if (event.type === 'content_block_delta') {
            onChunk({ content: event.delta?.text ?? '', done: false });
          } else if (event.type === 'message_stop') {
            onChunk({ content: '', done: true });
            return;
          }
        } catch {
          // 잘못된 SSE 라인 무시
        }
      }
    }
    onChunk({ content: '', done: true });
  }
}

/* ---------- Ollama (Local) ---------- */

class OllamaProvider implements LLMProvider {
  private config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  private buildHeaders(): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.config.apiKey) {
      h.Authorization = `Bearer ${this.config.apiKey}`;
    }
    return h;
  }

  async chat(messages: ChatMessage[], temperature = 0.7): Promise<string> {
    const res = await fetch(`${this.config.baseUrl ?? 'http://localhost:11434'}/api/chat`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify({
        model: this.config.model,
        messages,
        options: { temperature },
        stream: false,
      }),
    });
    if (!res.ok) {
      throw new Error(`Ollama chat failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as { message?: { content?: string } };
    return data.message?.content ?? '';
  }

  async streamChat(
    messages: ChatMessage[],
    onChunk: (chunk: StreamChunk) => void,
    temperature = 0.7,
  ): Promise<void> {
    const res = await fetch(`${this.config.baseUrl ?? 'http://localhost:11434'}/api/chat`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify({
        model: this.config.model,
        messages,
        options: { temperature },
        stream: true,
      }),
    });
    if (!res.ok) {
      throw new Error(`Ollama stream failed: ${res.status} ${await res.text()}`);
    }
    const reader = res.body?.getReader();
    if (!reader) {
      throw new Error('ReadableStream not available');
    }
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const chunk = JSON.parse(line) as {
            message?: { content?: string };
            done?: boolean;
          };
          const content = chunk.message?.content ?? '';
          const isDone = chunk.done === true;
          onChunk({ content, done: isDone });
          if (isDone) return;
        } catch {
          // 잘못된 JSON 라인 무시
        }
      }
    }
    onChunk({ content: '', done: true });
  }
}

/* ---------- Provider Factory ---------- */

export type ProviderKey = 'openai' | 'claude' | 'ollama' | 'ollamaCloud' | 'openRouter';

export function createProvider(key: ProviderKey, config: ProviderConfig): LLMProvider {
  switch (key) {
    case 'openai':
      return new OpenAICompatibleProvider(config);
    case 'claude':
      return new ClaudeProvider(config);
    case 'ollama':
    case 'ollamaCloud':
      return new OllamaProvider(config);
    case 'openRouter': {
      // OpenRouter는 OpenAI-compatible endpoint
      const url = config.baseUrl ?? 'https://openrouter.ai/api';
      return new OpenAICompatibleProvider(config, `${url}/v1/chat/completions`);
    }
    default:
      throw new Error(`Unknown provider: ${String(key)}`);
  }
}
