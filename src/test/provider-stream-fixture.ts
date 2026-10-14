import { requestUrl } from 'obsidian';

/** 기존 wire fixture를 스트림 응답으로 공급한다. 실제 소켓 검증은 별도 통합 테스트에서 수행한다. */
export async function providerStreamFixture(
  input: string | URL,
  init?: RequestInit,
): Promise<Response> {
  const headers: Record<string, string> = {};
  new Headers(init?.headers).forEach((value, key) => {
    headers[key] = value;
  });
  const response = await requestUrl({
    url: String(input),
    method: init?.method,
    headers,
    body: typeof init?.body === 'string' ? init.body : undefined,
    throw: false,
  });
  return new Response(response.text, { status: response.status, headers: response.headers });
}
