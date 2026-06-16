import { t } from '../i18n';

export interface ComposerLoadingState {
  isStreaming: boolean;
  sendButton: {
    disabled: boolean;
    text: string;
  };
  inputDisabled: boolean;
  toolsDisabled: boolean;
  modelSelectDisabled: boolean;
}

export function createComposerLoadingState(loading: boolean): ComposerLoadingState {
  return {
    isStreaming: loading,
    sendButton: {
      disabled: false,
      text: loading ? t('stopButton') : t('sendButton'),
    },
    inputDisabled: loading,
    toolsDisabled: loading,
    modelSelectDisabled: loading,
  };
}
