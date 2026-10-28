import { App, Modal, setIcon } from 'obsidian';
import { t } from './i18n';
import type { ProviderStrategyKey } from './settings';

export interface ProviderPickerOption {
  strategy: ProviderStrategyKey;
  label: string;
  description: string;
  icon: string;
  recommended?: boolean;
  legacy?: boolean;
  /** 선택 시 프로필에 저장할 base URL 프리셋입니다. */
  baseUrl?: string;
  /** 선택 시 프로필 이름 프리셋입니다. */
  profileName?: string;
}

/**
 * 새 연결을 만들기 전에 기본 제공 프로바이더를 정렬된 카드로 보여줍니다.
 * 카드 선택만 담당하고 저장·검증은 설정 화면의 기존 경로가 이어받습니다.
 */
export class ProviderPickerModal extends Modal {
  constructor(
    app: App,
    private readonly options: readonly ProviderPickerOption[],
    private readonly onChoose: (option: ProviderPickerOption) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass('superpower-inside-provider-picker-modal');
    this.setTitle(t('providerAddTitle'));
    contentEl.createDiv({
      cls: 'superpower-inside-provider-picker-desc',
      text: t('providerAddDesc'),
    });
    const grid = contentEl.createDiv({
      cls: 'superpower-inside-provider-strategy-grid superpower-inside-provider-picker-grid',
    });
    let firstButton: HTMLButtonElement | null = null;
    for (const option of this.options) {
      const button = grid.createEl('button', {
        cls: 'superpower-inside-provider-strategy-option superpower-inside-provider-picker-option',
        attr: {
          type: 'button',
          'aria-label': option.description
            ? `${option.label}. ${option.description}`
            : option.label,
        },
      });
      const heading = button.createSpan({
        cls: 'superpower-inside-provider-picker-heading',
      });
      const icon = heading.createSpan({ cls: 'superpower-inside-provider-picker-icon' });
      setIcon(icon, option.icon);
      heading.createSpan({
        cls: 'superpower-inside-provider-strategy-name',
        text: option.label,
      });
      if (option.recommended || option.legacy) {
        const badge = heading.createSpan({
          cls: [
            'superpower-inside-provider-picker-badge',
            option.recommended ? 'is-recommended' : '',
            option.legacy ? 'is-legacy' : '',
          ]
            .filter(Boolean)
            .join(' '),
          text: option.recommended
            ? t('providerPickerRecommended')
            : t('providerPickerLegacy'),
        });
        badge.setAttribute('aria-hidden', 'true');
      }
      button.createSpan({
        cls: 'superpower-inside-provider-picker-detail',
        text: option.description,
      });
      button.addEventListener('click', () => {
        this.close();
        this.onChoose(option);
      });
      if (option.recommended) firstButton = button;
    }
    window.setTimeout(() => {
      (firstButton ?? grid.querySelector<HTMLButtonElement>('button'))?.focus();
    }, 0);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
