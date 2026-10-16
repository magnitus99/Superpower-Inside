import { describe, expect, it } from 'vitest';
import { createChatReadinessSnapshot } from './chat-readiness';

describe('질문을 보내기 위한 준비 조건', () => {
  it('연결이 없으면 질문을 보존한 채 연결 설정만 안내한다', () => {
    const snapshot = createChatReadinessSnapshot({
      enabledProviderCount: 0,
      availableModelCount: 0,
      selectedModel: '',
    });
    expect(snapshot.blocksSend).toBe(true);
    expect(snapshot.items).toEqual([
      expect.objectContaining({
        kind: 'provider',
        action: 'configure-provider',
        severity: 'blocking',
      }),
    ]);
  });
  it('모델이 등록되지 않았으면 연결 설정으로 안내한다', () => {
    expect(
      createChatReadinessSnapshot({
        enabledProviderCount: 1,
        availableModelCount: 0,
        selectedModel: '',
      }).items[0].action,
    ).toBe('configure-provider');
  });
  it('사용할 모델이 있지만 선택하지 않았을 때만 모델 선택을 요청한다', () => {
    expect(
      createChatReadinessSnapshot({
        enabledProviderCount: 1,
        availableModelCount: 2,
        selectedModel: '',
      }).items[0].action,
    ).toBe('select-model');
  });
  it('질문이 가능한 경우 검색 준비·외부 도구·저장 위치 관리를 요구하지 않는다', () => {
    expect(
      createChatReadinessSnapshot({
        enabledProviderCount: 1,
        availableModelCount: 1,
        selectedModel: 'example:model',
      }),
    ).toMatchObject({ status: 'ready', blocksSend: false, items: [] });
  });
});
