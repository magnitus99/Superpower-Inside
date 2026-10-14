import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { consumeDesktopStream, desktopFetch } from './desktop-stream';

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
async function serve(handler: (response: ServerResponse) => void): Promise<string> {
  const server = createServer((_request, response) => handler(response));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe('데스크톱 스트림 I/O 계약', () => {
  it.each(['sse', 'ndjson'] as const)('%s 첫 프레임은 응답 종료 전에 전달된다', async (format) => {
    let release = (): void => {};
    const url = await serve((response) => {
      response.write(format === 'sse' ? 'data: first\n\n' : 'first\n');
      release = () => response.end(format === 'sse' ? 'data: done\n\n' : 'done\n');
    });
    const values: string[] = [];
    let first = (): void => {};
    const arrived = new Promise<void>((resolve) => {
      first = resolve;
    });
    const operation = consumeDesktopStream(await desktopFetch(url), format, (data) => {
      values.push(data);
      first();
      return data === 'done';
    });
    await arrived;
    expect(values).toEqual(['first']);
    release();
    await operation;
    expect(values).toEqual(['first', 'done']);
  });

  it.each(['sse', 'ndjson'] as const)(
    '%s 모든 바이트 경계에서 한국어·이모지·CRLF를 보존한다',
    async (format) => {
      const text =
        format === 'sse'
          ? ': heartbeat\r\ndata: 한글 😀\r\ndata: 두 번째\r\n\r\ndata: done\r\n\r\n'
          : '한글 😀\r\n두 번째\r\ndone';
      const bytes = new TextEncoder().encode(text);
      const values: string[] = [];
      const response = new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
            controller.close();
          },
        }),
      );
      await consumeDesktopStream(response, format, (data) => {
        values.push(data);
        return data === 'done';
      });
      expect(values).toEqual(
        format === 'sse' ? ['한글 😀\n두 번째', 'done'] : ['한글 😀', '두 번째', 'done'],
      );
    },
  );

  it.each(['sse', 'ndjson'] as const)(
    '%s 완료 프레임 없는 EOF를 성공으로 바꾸지 않는다',
    async (format) => {
      await expect(
        consumeDesktopStream(
          new Response(format === 'sse' ? 'data: partial\n\n' : 'partial\n'),
          format,
          () => false,
        ),
      ).rejects.toThrow('before completion');
    },
  );

  it('소비자 예외와 완료 이후 델타는 전달하지 않고 응답을 해제한다', async () => {
    const cancel = vi.fn();
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: first\n\ndata: second\n\n'));
        },
        cancel,
      }),
    );
    await expect(
      consumeDesktopStream(response, 'sse', () => {
        throw new Error('consumer');
      }),
    ).rejects.toThrow('consumer');
    expect(cancel).toHaveBeenCalledOnce();
    const values: string[] = [];
    await consumeDesktopStream(new Response('data: done\n\ndata: late\n\n'), 'sse', (data) => {
      values.push(data);
      return true;
    });
    expect(values).toEqual(['done']);
  });

  it.each(['sse', 'ndjson'] as const)(
    '%s 미완성 프레임의 메모리 한도를 제한한다',
    async (format) => {
      await expect(
        consumeDesktopStream(
          new Response('data: ' + 'x'.repeat(4 * 1024 * 1024)),
          format,
          () => false,
        ),
      ).rejects.toThrow('too large');
    },
  );

  it('요청 전 취소와 헤더 대기 중 취소를 AbortError로 전달한다', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      desktopFetch('http://127.0.0.1', { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    const url = await serve(() => {});
    const pendingController = new AbortController();
    const pending = desktopFetch(url, { signal: pendingController.signal });
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    pendingController.abort();
    await assertion;
  });

  it('진행 중 취소는 서버 소켓까지 닫으며 성공 완료를 보내지 않는다', async () => {
    let closed = (): void => {};
    const closure = new Promise<void>((resolve) => {
      closed = resolve;
    });
    const url = await serve((response) => {
      response.write('data: first\n\n');
      response.on('close', closed);
    });
    const controller = new AbortController();
    const values: string[] = [];
    await expect(
      consumeDesktopStream(
        await desktopFetch(url, { signal: controller.signal }),
        'sse',
        (data) => {
          values.push(data);
          controller.abort();
        },
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    await closure;
    expect(values).toEqual(['first']);
  });

  it('리디렉션을 자동 추적하지 않고 HTTP 상태·헤더를 보존한다', async () => {
    const url = await serve((response) => {
      response.writeHead(302, { Location: 'https://example.com', 'Retry-After': '2' });
      response.end('redirect');
    });
    const response = await desktopFetch(url);
    expect(response.status).toBe(302);
    expect(response.headers.get('retry-after')).toBe('2');
    expect(await response.text()).toBe('redirect');
  });

  it.each(['file:///tmp/a', 'ftp://example.com', 'https://user:password@example.com'])(
    '잘못된 엔드포인트 %s를 네트워크 전에 거부한다',
    async (url) => {
      await expect(desktopFetch(url)).rejects.toThrow('Invalid HTTP endpoint');
    },
  );
});
