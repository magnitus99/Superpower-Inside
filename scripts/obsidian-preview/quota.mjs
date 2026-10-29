import { SuperpowerInsideSettingTab } from '../../src/settings';
import { ProviderQuotaService } from '../../src/llm/provider-quota-service';
import { getProviderQuotaDisplay } from '../../src/llm/provider-quota-display';
import { t } from '../../src/i18n';

/** 실제 공통 캐시·설정 목록·ChatView를 합성 응답으로 연결하며 외부 요청은 하지 않습니다. */
export async function createQuotaPreview({ app, plugin, params }) {
  const scenario = params.get('quota');
  const model = {
    id: 'example-model',
    kind: 'general',
    verification: { chatStatus: 'success', embeddingStatus: 'unknown' },
  };
  const first = {
    id: 'quota-example',
    name: 'OpenCode Go',
    strategy: 'opencode',
    enabled: scenario !== 'disabled',
    apiKey: 'synthetic-key',
    baseUrl: 'https://opencode.ai/inference/go',
    models: [structuredClone(model)],
  };
  const custom = {
    ...first,
    id: 'quota-custom',
    name: 'Custom endpoint',
    strategy: 'openAICompatible',
    enabled: true,
    baseUrl: 'https://example.invalid/v1',
  };
  const credits = {
    ...first,
    id: 'quota-credits',
    name: 'OpenRouter',
    strategy: 'openRouter',
    enabled: true,
    baseUrl: 'https://openrouter.ai/api/v1',
  };
  plugin.settings.providerProfiles = scenario === 'empty' ? [] : [first, custom, credits];
  plugin.settings.chat.defaultModel = scenario === 'empty' ? '' : `profile:${first.id}:${model.id}`;
  plugin.settings.autoSaveEnabled = false;
  const responses = new Map([
    [
      first.id,
      {
        status: 'ready',
        snapshot: {
          windows: [
            { id: 'actual-week', remainingPercent: 2, durationSeconds: 604800 },
            { id: 'actual-short', remainingPercent: 80, durationSeconds: 18000 },
          ],
          credits: [],
        },
      },
    ],
    [custom.id, { status: 'unsupported' }],
    [
      credits.id,
      { status: 'ready', snapshot: { windows: [], credits: [{ remaining: 12.4, unit: 'USD' }] } },
    ],
  ]);
  if (scenario === 'error')
    responses.set(first.id, { status: 'unavailable', reason: 'permission' });
  plugin.providerQuota = new ProviderQuotaService({
    getProfiles: () => plugin.settings.providerProfiles,
    getIntervalSeconds: () => plugin.settings.quotaCheckIntervalSeconds,
    identity: (profile) => JSON.stringify([profile.id, profile.enabled, profile.apiKey]),
    fetchQuota: async (profile) =>
      scenario === 'loading' && profile.id === first.id
        ? new Promise(() => {})
        : responses.get(profile.id),
    onChange: (profileId) =>
      plugin.refreshBus.emit('quota', { status: 'success', detail: profileId }),
  });
  const saves = [];
  plugin.saveSettings = async (options) => {
    saves.push(options);
    plugin.providerQuota.configure();
    return { success: true };
  };
  plugin.providerQuota.start();
  await Promise.resolve();
  await Promise.resolve();
  let tab;
  let root;
  return {
    mount() {
      if (!params.has('quotaSettings')) return;
      tab = new SuperpowerInsideSettingTab(app, plugin);
      root = tab.containerEl;
      root.addClass('view-content', 'superpower-inside-settings-root');
      root.setAttribute('lang', plugin.settings.language);
      document.getElementById('preview-leaf').replaceChildren(root);
      tab.buildProvidersTab(root);
      tab.registerQuotaRefreshEvents();
      if (params.has('expanded'))
        root.querySelector('.superpower-inside-provider-disclosure > button')?.click();
    },
    async check() {
      const checks = [];
      const check = (condition, label) => {
        if (!condition) throw Error(`한도 검수 실패: ${label}`);
        checks.push(label);
      };
      const expected = getProviderQuotaDisplay(first, plugin.providerQuota.get(first.id)).text;
      if (root) {
        const values = root.querySelectorAll('.superpower-inside-provider-quota');
        check(values.length === plugin.settings.providerProfiles.length, '모든 연결명 옆 표시');
        if (scenario !== 'empty') {
          check(values[0].textContent === expected, '설정의 실제 공통 캐시 표시');
          check(values[1].textContent === t('quotaUnsupported'), '사용자 지정 자동 조회 미지원');
          check(values[2].textContent.includes('12.40'), 'OpenRouter 잔여 크레딧');
        }
        const input = root.querySelector('[data-quota-interval]');
        check(input?.value === '30' && input.type === 'number', '빈 연결에도 기본 30초 입력 표시');
        check(
          input.min === '10' && input.max === '3600' && input.step === '1',
          '입력 경계·정수 계약',
        );
        input.focus();
        const change = async (value) => {
          input.value = value;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await tab.saveChain;
          await Promise.resolve();
        };
        for (const invalid of ['', '9', '3601', '12.5']) {
          await change(invalid);
          check(
            plugin.settings.quotaCheckIntervalSeconds === 30,
            `잘못된 간격 보존 ${invalid || 'empty'}`,
          );
        }
        await change('60');
        check(
          plugin.settings.quotaCheckIntervalSeconds === 60 && saves.length === 1,
          '60초 저장 연결',
        );
        check(!saves[0].reinitRag && !saves[0].reinitMcp, '간격 저장은 RAG·MCP 재초기화 없음');
        plugin.refreshBus.emit('quota', { status: 'error', detail: first.id });
        check(
          root.querySelector('[data-quota-interval]') === input && document.activeElement === input,
          '한도 갱신 시 DOM·입력 포커스 보존',
        );
        if (scenario === 'ready') {
          responses.set(first.id, {
            status: 'ready',
            snapshot: {
              windows: [{ id: 'new-window', period: 'week', remainingPercent: 0 }],
              credits: [],
            },
          });
          first.apiKey = 'synthetic-key-rotated';
          plugin.providerQuota.configure();
          await Promise.resolve();
          await Promise.resolve();
          check(values[0].textContent.includes('0%'), '실제 캐시 이벤트로 0% 갱신');
          responses.set(first.id, {
            status: 'ready',
            snapshot: {
              windows: [{ id: 'actual-week', remainingPercent: 2, durationSeconds: 604800 }],
              credits: [],
            },
          });
          first.apiKey = 'synthetic-key';
        }
        await change('30');
        if (params.has('expanded'))
          check(
            root
              .querySelector('.superpower-inside-provider-disclosure > button')
              ?.getAttribute('aria-expanded') === 'true',
            '갱신 후 펼침 상태 보존',
          );
      } else {
        const value = document.querySelector('.superpower-inside-chat-quota');
        if (scenario === 'empty' || scenario === 'disabled')
          check(value?.hidden === true, '선택 모델 없을 때 이전 한도 숨김');
        else {
          check(value?.textContent === expected && !value.hidden, '모델 선택 옆 공통 표시');
          const select = document.querySelector('.superpower-inside-chat-model-select');
          select.value = `profile:${credits.id}:${model.id}`;
          select.dispatchEvent(new Event('change'));
          check(
            value.textContent.includes('12.40') && !value.textContent.includes('%'),
            '모델 변경은 해당 연결 크레딧 표시',
          );
          select.value = plugin.settings.chat.defaultModel;
          select.dispatchEvent(new Event('change'));
          check(value.textContent === expected, '선택 복귀 시 이전 연결 캐시 표시');
        }
      }
      check(document.documentElement.scrollWidth <= window.innerWidth, '한도·간격 가로 넘침 없음');
      return checks;
    },
  };
}
