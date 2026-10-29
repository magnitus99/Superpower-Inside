import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderProfileConfig } from '../settings';
import type { ProviderQuotaResult } from './provider-quota-api';
vi.mock('./provider-quota-api', () => ({
  fetchProviderQuota: vi.fn(),
  getProviderQuotaIdentity: (profile: ProviderProfileConfig) =>
    JSON.stringify([profile.apiKey, profile.enabled, profile.strategy]),
}));
import { ProviderQuotaService } from './provider-quota-service';

function profile(id = 'one'): ProviderProfileConfig {
  return {
    id,
    strategy: 'openRouter',
    name: id,
    enabled: true,
    apiKey: 'synthetic-key',
    models: [],
  };
}
const ready: ProviderQuotaResult = {
  status: 'ready',
  snapshot: { windows: [], credits: [{ remaining: 8, unit: 'USD' }] },
};
const services: ProviderQuotaService[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  services.forEach((service) => service.dispose());
  services.length = 0;
  vi.useRealTimers();
});
function setup(fetchQuota = vi.fn<() => Promise<ProviderQuotaResult>>().mockResolvedValue(ready)) {
  let profiles = [profile()];
  let interval = 30;
  const onChange = vi.fn();
  const service = new ProviderQuotaService({
    getProfiles: () => profiles,
    getIntervalSeconds: () => interval,
    fetchQuota,
    onChange,
  });
  services.push(service);
  return {
    service,
    fetchQuota,
    onChange,
    setProfiles: (next: ProviderProfileConfig[]) => {
      profiles = next;
    },
    setInterval: (next: number) => {
      interval = next;
    },
  };
}

describe('공통 한도 조회 수명과 갱신', () => {
  it('시작과 30초 주기가 같은 refresh 경로를 호출한다', async () => {
    const { service, fetchQuota } = setup();
    service.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchQuota).toHaveBeenCalledTimes(1);
    expect(service.get('one')).toMatchObject(ready);
    service.refresh();
    await vi.advanceTimersByTimeAsync(29999);
    expect(fetchQuota).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchQuota).toHaveBeenCalledTimes(2);
  });
  it('조회 불가여도 모델 상태를 변경하지 않고 같은 주기에 다시 확인한다', async () => {
    const fetchQuota = vi
      .fn<() => Promise<ProviderQuotaResult>>()
      .mockResolvedValue({ status: 'unavailable', reason: 'not-exposed' });
    const { service } = setup(fetchQuota);
    service.start();
    await vi.advanceTimersByTimeAsync(30000);
    expect(fetchQuota).toHaveBeenCalledTimes(2);
    expect(service.get('one')).toMatchObject({ status: 'unavailable', reason: 'not-exposed' });
  });
  it('실패 시 과거 잔액을 현재 잔액처럼 재사용하지 않는다', async () => {
    const { service, fetchQuota } = setup();
    service.start();
    await vi.advanceTimersByTimeAsync(0);
    fetchQuota.mockRejectedValueOnce(new Error('synthetic-secret'));
    await vi.advanceTimersByTimeAsync(30000);
    expect(service.get('one')).toMatchObject({ status: 'unavailable', reason: 'network' });
    expect(service.get('one')).not.toHaveProperty('snapshot');
    expect(JSON.stringify(service.get('one'))).not.toContain('synthetic-secret');
  });
  it('만료 전 요청은 공유하고 매달린 요청은 다음 주기에 새 세대로 재시도한다', async () => {
    let resolve: (value: ProviderQuotaResult) => void = () => {};
    const fetchQuota = vi
      .fn<() => Promise<ProviderQuotaResult>>()
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      )
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValue(ready);
    const { service } = setup(fetchQuota);
    service.start();
    service.refresh();
    await vi.advanceTimersByTimeAsync(14999);
    expect(fetchQuota).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(service.get('one')).toMatchObject({ status: 'unavailable', reason: 'timeout' });
    await vi.advanceTimersByTimeAsync(15000);
    expect(fetchQuota).toHaveBeenCalledTimes(2);
    resolve(ready);
    await vi.advanceTimersByTimeAsync(0);
    expect(service.get('one')).not.toHaveProperty('snapshot');
    service.refresh();
    expect(fetchQuota).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(2);
    await vi.advanceTimersByTimeAsync(15000);
    expect(vi.getTimerCount()).toBe(1);
    expect(service.get('one')).toMatchObject({ status: 'unavailable', reason: 'timeout' });
    await vi.advanceTimersByTimeAsync(15000);
    expect(fetchQuota).toHaveBeenCalledTimes(3);
    expect(service.get('one')).toMatchObject(ready);
  });
  it('한 연결의 지연이 다른 연결의 조회를 막지 않는다', async () => {
    const fetchQuota = vi
      .fn<() => Promise<ProviderQuotaResult>>()
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValue(ready);
    const { service, setProfiles } = setup(fetchQuota);
    setProfiles([profile(), profile('two')]);
    service.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(service.get('two')).toMatchObject(ready);
    expect(service.get('one')).toMatchObject({ status: 'loading' });
  });
  it('키 변경 전 늦은 결과를 버리고 새 연결의 잔액만 보존한다', async () => {
    let resolve: (value: ProviderQuotaResult) => void = () => {};
    const fetchQuota = vi
      .fn<() => Promise<ProviderQuotaResult>>()
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      )
      .mockResolvedValue({ status: 'unavailable', reason: 'permission' });
    const { service, setProfiles } = setup(fetchQuota);
    service.start();
    setProfiles([{ ...profile(), apiKey: 'new-synthetic-key' }]);
    service.configure();
    await vi.advanceTimersByTimeAsync(0);
    resolve(ready);
    await vi.advanceTimersByTimeAsync(0);
    expect(service.get('one')).toMatchObject({ status: 'unavailable', reason: 'permission' });
  });
  it('동일 프로필의 재로그인도 인증 세대가 바뀌면 이전 결과를 버린다', async () => {
    let generation = 'before';
    let resolve: (value: ProviderQuotaResult) => void = () => {};
    const fetchQuota = vi
      .fn<() => Promise<ProviderQuotaResult>>()
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      )
      .mockResolvedValue({ status: 'unavailable', reason: 'authentication' });
    const service = new ProviderQuotaService({
      getProfiles: () => [profile()],
      getIntervalSeconds: () => 30,
      identity: () => generation,
      fetchQuota,
      onChange: () => {},
    });
    services.push(service);
    service.start();
    generation = 'after';
    service.configure();
    await vi.advanceTimersByTimeAsync(0);
    resolve(ready);
    await vi.advanceTimersByTimeAsync(0);
    expect(service.get('one')).toMatchObject({ status: 'unavailable', reason: 'authentication' });
  });

  it('삭제·비활성화 후 도착한 결과는 게시하지 않는다', async () => {
    let resolve: (value: ProviderQuotaResult) => void = () => {};
    const { service, setProfiles, onChange } = setup(
      vi.fn(
        () =>
          new Promise<ProviderQuotaResult>((done) => {
            resolve = done;
          }),
      ),
    );
    service.start();
    setProfiles([]);
    service.configure();
    onChange.mockClear();
    resolve(ready);
    await vi.advanceTimersByTimeAsync(0);
    expect(service.get('one')).toBeUndefined();
    expect(onChange).not.toHaveBeenCalled();
    setProfiles([{ ...profile(), enabled: false }]);
    service.configure();
    expect(service.get('one')).toMatchObject({ status: 'disabled' });
  });
  it('설정 저장 반복으로 타이머가 중복되거나 주기가 밀리지 않는다', async () => {
    const { service, fetchQuota } = setup();
    service.start();
    await vi.advanceTimersByTimeAsync(10000);
    service.configure();
    service.configure();
    await vi.advanceTimersByTimeAsync(20000);
    expect(fetchQuota).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1);
  });
  it('전역 주기 변경을 모든 연결에 적용하고 이전 타이머를 취소한다', async () => {
    const { service, fetchQuota, setInterval, setProfiles } = setup();
    setProfiles([profile(), profile('two')]);
    service.start();
    await vi.advanceTimersByTimeAsync(0);
    setInterval(60);
    service.configure();
    await vi.advanceTimersByTimeAsync(0);
    const count = fetchQuota.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30000);
    expect(fetchQuota).toHaveBeenCalledTimes(count);
    await vi.advanceTimersByTimeAsync(30000);
    expect(fetchQuota).toHaveBeenCalledTimes(count + 2);
    expect(vi.getTimerCount()).toBe(1);
  });
  it('WASM 실패 시 기존 60초 타이머를 30초로 바꾸지 않는다', async () => {
    const rust = await import('../rag/rust-core');
    const { service, fetchQuota, setInterval } = setup();
    setInterval(60);
    service.start();
    await vi.advanceTimersByTimeAsync(0);
    const normalize = vi.spyOn(rust, 'normalizeQuotaIntervalSecondsRust').mockReturnValueOnce(null);
    try {
      service.configure();
    } finally {
      normalize.mockRestore();
    }
    await vi.advanceTimersByTimeAsync(30000);
    expect(fetchQuota).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30000);
    expect(fetchQuota).toHaveBeenCalledTimes(2);
  });

  it('429 대기는 수동 호출과 주기 변경으로도 우회하지 않는다', async () => {
    const fetchQuota = vi
      .fn<() => Promise<ProviderQuotaResult>>()
      .mockResolvedValue({ status: 'unavailable', reason: 'rate-limited', retryAfterMs: 120000 });
    const { service, setInterval } = setup(fetchQuota);
    service.start();
    await vi.advanceTimersByTimeAsync(0);
    setInterval(10);
    service.configure();
    service.refresh();
    await vi.advanceTimersByTimeAsync(119999);
    expect(fetchQuota).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchQuota).toHaveBeenCalledTimes(2);
  });
  it('언로드하면 타이머·리스너·캐시를 정리하고 늦은 요청을 무시한다', async () => {
    let resolve: (value: ProviderQuotaResult) => void = () => {};
    const { service, onChange, fetchQuota } = setup(
      vi.fn(
        () =>
          new Promise<ProviderQuotaResult>((done) => {
            resolve = done;
          }),
      ),
    );
    service.start();
    service.dispose();
    onChange.mockClear();
    resolve(ready);
    await vi.advanceTimersByTimeAsync(90000);
    service.refresh();
    expect(vi.getTimerCount()).toBe(0);
    expect(service.get('one')).toBeUndefined();
    expect(onChange).not.toHaveBeenCalled();
    expect(fetchQuota).toHaveBeenCalledTimes(1);
  });
});
