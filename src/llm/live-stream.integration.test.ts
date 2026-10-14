import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectTestChatGPT, completedChatGPTResponse } from '../test/chatgpt';
import type { ProviderStrategyKey } from '../settings';
import { createProviderForStrategy, type StreamChunk } from './providers';

const route = vi.hoisted(() => ({ url: '' }));
vi.mock('obsidian', () => ({ requestUrl: vi.fn() }));
vi.mock('../utils/desktop-stream', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/desktop-stream')>();
  // API 원점만 로컬 fixture로 바꾸고 실제 provider와 Node 소켓 경로를 모두 실행한다.
  return {
    ...actual,
    desktopFetch: (input: string | URL, init?: RequestInit) =>
      actual.desktopFetch(new URL(new URL(input).pathname, route.url), init),
  };
});
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});
const strategies: ProviderStrategyKey[] = [
  'openai',
  'openRouter',
  'openAICompatible',
  'claude',
  'ollama',
  'ollamaCloud',
  'openAIChatGPT',
];
async function serve(handler: (response: ServerResponse) => void): Promise<void> {
  const server = createServer((request, response) => {
    request.resume();
    handler(response);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  route.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
function provider(strategy: ProviderStrategyKey) {
  connectTestChatGPT();
  return createProviderForStrategy(strategy, {
    id: 'profile',
    name: 'synthetic',
    apiKey: 'synthetic',
    enabled: true,
    models: ['synthetic-model'],
    baseUrl: 'http://localhost/v1',
    capabilityOverrides: { toolCalling: true },
  });
}
function frames(strategy: ProviderStrategyKey): [string, string] {
  if (strategy === 'claude')
    return [
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"한글 😀"}}\n\n',
      'data: {"type":"message_stop"}\n\n',
    ];
  if (strategy === 'ollama' || strategy === 'ollamaCloud')
    return ['{"message":{"content":"한글 😀"},"done":false}\n', '{"done":true}\n'];
  if (strategy === 'openAIChatGPT')
    return [
      'data: {"type":"response.output_text.delta","delta":"한글 😀"}\n\n',
      completedChatGPTResponse([
        { type: 'message', content: [{ type: 'output_text', text: '한글 😀' }] },
      ]),
    ];
  return ['data: {"choices":[{"delta":{"content":"한글 😀"}}]}\n\n', 'data: [DONE]\n\n'];
}

describe('모든 채팅 provider의 실제 스트림 경로', () => {
  it.each(strategies)(
    '%s 잘못된 프레임과 응답 안의 오류를 성공으로 바꾸지 않는다',
    async (strategy) => {
      const ndjson = strategy === 'ollama' || strategy === 'ollamaCloud';
      const chunks: StreamChunk[] = [];
      await serve((response) => response.end(ndjson ? '{broken}\n' : 'data: {broken}\n\n'));
      await expect(
        provider(strategy).streamChat([], (chunk) => chunks.push(chunk)),
      ).rejects.toBeDefined();
      expect(chunks.some((chunk) => chunk.done)).toBe(false);
      const event =
        strategy === 'openAIChatGPT'
          ? { type: 'response.failed' }
          : strategy === 'claude'
            ? { type: 'error', error: { message: 'synthetic failure' } }
            : { error: { message: 'synthetic failure', code: 502 } };
      await serve((response) =>
        response.end(
          ndjson ? '{"error":"synthetic failure"}\n' : `data: ${JSON.stringify(event)}\n\n`,
        ),
      );
      await expect(
        provider(strategy).streamChat([], (chunk) => chunks.push(chunk)),
      ).rejects.toBeDefined();
      expect(chunks.some((chunk) => chunk.done)).toBe(false);
    },
  );
  it.each(strategies)('%s 응답 종료 전 표시·완료 1회·텍스트 중복 없음', async (strategy) => {
    let finish = (): void => {};
    const [first, last] = frames(strategy);
    await serve((response) => {
      response.write(first);
      finish = () => response.end(last);
    });
    const selected = provider(strategy);
    let arrived = (): void => {};
    const firstChunk = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    const chunks: StreamChunk[] = [];
    const pending = selected.streamChat([{ role: 'user', content: 'synthetic query' }], (chunk) => {
      chunks.push(chunk);
      if (chunk.content) arrived();
    });
    await firstChunk;
    expect(chunks.map((chunk) => chunk.content).join('')).toBe('한글 😀');
    expect(chunks.some((chunk) => chunk.done)).toBe(false);
    finish();
    await pending;
    expect(chunks.map((chunk) => chunk.content).join('')).toBe('한글 😀');
    expect(chunks.filter((chunk) => chunk.done)).toHaveLength(1);
    expect(selected.capability).toMatchObject({
      streaming: true,
      transport: 'desktop-stream',
      abort: 'native',
    });
  });

  it.each(strategies)('%s 부분 응답 이후 취소·끊김을 완료로 바꾸지 않는다', async (strategy) => {
    const [first] = frames(strategy);
    await serve((response) => response.write(first));
    const controller = new AbortController();
    const chunks: StreamChunk[] = [];
    await expect(
      provider(strategy).streamChat(
        [],
        (chunk) => {
          chunks.push(chunk);
          controller.abort();
        },
        undefined,
        undefined,
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(chunks.some((chunk) => chunk.done)).toBe(false);
    await serve((response) => response.end(first));
    await expect(provider(strategy).streamChat([], () => {})).rejects.toThrow('before completion');
  });

  it.each(strategies)('%s HTTP 오류와 Retry-After를 보존한다', async (strategy) => {
    await serve((response) => {
      response.writeHead(429, { 'Retry-After': '3' });
      response.end('synthetic overload');
    });
    await expect(provider(strategy).streamChat([], () => {})).rejects.toMatchObject({
      status: 429,
      retryAfterMs: 3000,
    });
  });
});
