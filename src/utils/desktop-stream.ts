import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';
import { createParser } from 'eventsource-parser';

/** 완료 이벤트 없이 닫힌 스트림을 다른 provider 오류와 구분합니다. */
export class DesktopStreamIncompleteError extends Error {
  constructor() {
    super('HTTP stream ended before completion');
    this.name = 'DesktopStreamIncompleteError';
  }
}

export function streamHeaders(headers: HeadersInit | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  new Headers(headers).forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

/** 데스크톱 스트림 I/O. 쿠키와 리디렉션을 사용하지 않고 취소 시 소켓을 닫는다. */
export async function desktopFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input));
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Invalid HTTP endpoint');
  }
  if (init?.signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
  const headers = streamHeaders(init?.headers);
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
      url,
      { method: init?.method ?? 'GET', headers, signal: init?.signal ?? undefined },
      (incoming) => {
        const status = incoming.statusCode ?? 502;
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (value !== undefined)
            responseHeaders.set(name, Array.isArray(value) ? value.join(', ') : value);
        }
        const empty = [204, 205, 304].includes(status) || init?.method === 'HEAD';
        if (empty) incoming.resume();
        resolve(
          new Response(empty ? null : (Readable.toWeb(incoming) as ReadableStream<Uint8Array>), {
            status,
            headers: responseHeaders,
          }),
        );
      },
    );
    request.on('error', reject);
    request.setTimeout(120_000, () => request.destroy(new Error('HTTP stream timed out')));
    if (init?.body !== undefined && init.body !== null && typeof init.body !== 'string') {
      request.destroy(new Error('HTTP stream requires a string body'));
      return;
    }
    request.end(init?.body ?? undefined);
  });
}

/** SSE/NDJSON 프레임을 수신 즉시 전달하고 완료·오류·취소 시 응답을 해제한다. */
export async function consumeDesktopStream(
  response: Response,
  format: 'sse' | 'ndjson',
  onData: (data: string) => boolean | void,
  signal?: AbortSignal,
): Promise<void> {
  if (!response.body) throw new Error('HTTP stream body missing');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let done = false;
  let pending = '';
  let sseBytes = 0;
  const parser = createParser({
    onEvent: (event) => {
      if (event.data.length > 4 * 1024 * 1024) throw new Error('HTTP stream frame too large');
      sseBytes = 0;
      if (!done) done = onData(event.data) === true;
    },
  });
  const consume = (text: string): void => {
    if (format === 'sse') {
      sseBytes += text.length;
      parser.feed(text);
      if (sseBytes > 4 * 1024 * 1024) throw new Error('HTTP stream frame too large');
      return;
    }
    pending += text;
    let end = pending.indexOf('\n');
    while (!done && end >= 0) {
      const line = pending.slice(0, end).trim();
      if (line.length > 4 * 1024 * 1024) throw new Error('HTTP stream frame too large');
      pending = pending.slice(end + 1);
      if (line) done = onData(line) === true;
      end = pending.indexOf('\n');
    }
    if (!done && pending.length > 4 * 1024 * 1024) throw new Error('HTTP stream frame too large');
  };
  const onAbort = (): void => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    while (!done) {
      if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
      const chunk = await reader.read();
      if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
      if (chunk.done) {
        consume(decoder.decode());
        if (format === 'ndjson' && pending.trim()) done = onData(pending.trim()) === true;
        if (!done) throw new DesktopStreamIncompleteError();
        break;
      }
      consume(decoder.decode(chunk.value, { stream: true }));
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
