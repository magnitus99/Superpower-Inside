import { describe, expect, it, vi } from 'vitest';
import { RefreshBus } from './refresh-bus';

describe('RefreshBus', () => {
  it('emit을 호출하면 등록된 리스너가 호출된다', () => {
    const bus = new RefreshBus();
    const handler = vi.fn();
    bus.on('rag', handler);
    bus.emit('rag', { status: 'success' });
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({ status: 'success' });
  });

  it('구독 해제 후에는 리스너가 호출되지 않는다', () => {
    const bus = new RefreshBus();
    const handler = vi.fn();
    const unsub = bus.on('rag', handler);
    unsub();
    bus.emit('rag', { status: 'success' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('같은 도메인에 여러 리스너를 등록할 수 있다', () => {
    const bus = new RefreshBus();
    const h1 = vi.fn();
    const h2 = vi.fn();
    bus.on('mcp', h1);
    bus.on('mcp', h2);
    bus.emit('mcp', { status: 'partial', detail: '2개 실패' });
    expect(h1).toHaveBeenCalledOnce();
    expect(h2).toHaveBeenCalledOnce();
  });

  it('서로 다른 도메인은 독립적으로 동작한다', () => {
    const bus = new RefreshBus();
    const ragHandler = vi.fn();
    const mcpHandler = vi.fn();
    bus.on('rag', ragHandler);
    bus.on('mcp', mcpHandler);
    bus.emit('rag', { status: 'success' });
    expect(ragHandler).toHaveBeenCalledOnce();
    expect(mcpHandler).not.toHaveBeenCalled();
  });

  it('emit 결과 객체에 detail이 포함될 수 있다', () => {
    const bus = new RefreshBus();
    const handler = vi.fn();
    bus.on('models', handler);
    bus.emit('models', { status: 'success', detail: '3개 모델 로드됨' });
    expect(handler).toHaveBeenCalledWith({
      status: 'success',
      detail: '3개 모델 로드됨',
    });
  });

  it('destroy() 호출 후 모든 리스너가 제거된다', () => {
    const bus = new RefreshBus();
    const h1 = vi.fn();
    const h2 = vi.fn();
    bus.on('rag', h1);
    bus.on('mcp', h2);
    bus.destroy();
    bus.emit('rag', { status: 'success' });
    bus.emit('mcp', { status: 'success' });
    expect(h1).not.toHaveBeenCalled();
    expect(h2).not.toHaveBeenCalled();
  });

  it('리스너 내부 오류가 다른 리스너에 전파되지 않는다', () => {
    const bus = new RefreshBus();
    const bad = vi.fn().mockImplementation(() => {
      throw new Error('boom');
    });
    const good = vi.fn();
    bus.on('rag', bad);
    bus.on('rag', good);
    // 오류 없이 실행되어야 함
    expect(() => bus.emit('rag', { status: 'success' })).not.toThrow();
    expect(good).toHaveBeenCalledOnce();
  });
});
