import { Notice, setIcon } from 'obsidian';
import { t } from '../i18n';
import { confirmWithModal } from '../utils/modal-prompts';
import type { PluginLike } from '../settings';
import {
  buildVaultPromptGenerationMessages,
  createPromptEntry,
  DEFAULT_OBSIDIAN_PROMPT_ID,
  getPromptDirectionPresets,
  setActivePromptEntry,
  type PromptLibraryEntry,
} from './prompt-library';
import {
  createPromptGenerationProvider,
  resolvePromptGenerationModelState,
} from './prompt-generation-provider';
import {
  focusPromptModalTarget,
  getSharedPromptModalAction,
  getPromptModalTabTarget,
  resolvePromptModalSelection,
  type PromptModalFocusTarget,
} from './prompt-library-modal-state';

let promptModalSequence = 0;

interface OpenPromptLibraryModalOptions {
  containerEl: HTMLElement;
  plugin: PluginLike;
  currentSessionPrompt: string | null;
  selectedModel: string;
  onApplyToSession?: (prompt: string) => void;
  onClose?: () => void;
}

export function openPromptLibraryModal(options: OpenPromptLibraryModalOptions): void {
  const doc = options.containerEl.ownerDocument;
  const activeHTMLElement = doc.defaultView?.HTMLElement;
  const previousFocus =
    activeHTMLElement && doc.activeElement instanceof activeHTMLElement ? doc.activeElement : null;
  const modalId = `superpower-inside-prompt-modal-${++promptModalSequence}`;
  const overlay = options.containerEl.createDiv({ cls: 'superpower-inside-prompt-overlay' });
  const modal = overlay.createDiv({ cls: 'superpower-inside-prompt-modal' });
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', `${modalId}-title`);
  modal.tabIndex = -1;
  const titleBar = modal.createDiv({ cls: 'superpower-inside-prompt-titlebar' });
  const heading = titleBar.createDiv({
    cls: 'superpower-inside-prompt-heading',
    text: t('promptLibraryTitle'),
  });
  heading.id = `${modalId}-title`;
  heading.setAttribute('role', 'heading');
  heading.setAttribute('aria-level', '2');
  const closeBtn = titleBar.createEl('button', {
    cls: 'superpower-inside-prompt-close',
    attr: {
      type: 'button',
      'aria-label': t('closeLabel'),
      'data-prompt-focus': 'closeButton',
    },
  });
  setIcon(closeBtn, 'x');

  const body = modal.createDiv({ cls: 'superpower-inside-prompt-body' });
  const listPane = body.createDiv({ cls: 'superpower-inside-prompt-list-pane' });
  const detailPane = body.createDiv({ cls: 'superpower-inside-prompt-detail-pane' });

  let selectedId =
    options.plugin.settings.chat.activePromptId ??
    options.plugin.settings.chat.promptLibrary[0]?.id ??
    DEFAULT_OBSIDIAN_PROMPT_ID;
  let isClosed = false;
  const mutationAction = getSharedPromptModalAction(options.plugin);
  let mutationFocusTarget: PromptModalFocusTarget = 'selectedPrompt';
  let localMutationInProgress = false;
  let isGenerating = false;
  let generationSequence = 0;
  let unsubscribeMutation = (): void => undefined;

  const close = (): void => {
    if (isClosed) return;
    if (localMutationInProgress) {
      new Notice(t('promptMutationInProgress'));
      return;
    }
    isClosed = true;
    unsubscribeMutation();
    overlay.remove();
    if (previousFocus?.isConnected) previousFocus.focus();
    options.onClose?.();
  };
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });
  overlay.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(
      modal.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    if (focusable.length === 0) {
      event.preventDefault();
      modal.focus();
      return;
    }
    const nextTarget = getPromptModalTabTarget(focusable, doc.activeElement, event.shiftKey);
    if (nextTarget) {
      event.preventDefault();
      nextTarget.focus();
    }
  });

  const saveSettings = async (): Promise<boolean> => {
    try {
      const result = await options.plugin.saveSettings({ reinitRag: false, reinitMcp: false });
      if (!result.success && result.mcpErrors && result.mcpErrors.length > 0) {
        new Notice(t('settingsSaveMcpReconnectFailed', { count: result.mcpErrors.length }), 5000);
      }
      return result.success;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(t('promptSettingsSaveFailed', { message }), 5000);
      return false;
    }
  };

  const getSelectedEntry = (): PromptLibraryEntry | null =>
    options.plugin.settings.chat.promptLibrary.find((entry) => entry.id === selectedId) ?? null;

  const selectEntry = (id: string): void => {
    if (mutationAction.isRunning) return;
    selectedId = id;
    render('selectedPrompt');
  };

  const setMutationBusy = (): void => {
    modal.setAttribute('aria-busy', 'true');
    const controls = Array.from(
      body.querySelectorAll<HTMLElement>('button, input, select, textarea'),
    );
    for (const control of controls) {
      control.setAttribute('disabled', '');
    }
    closeBtn.focus();
  };

  const runMutation = async (
    focusTarget: PromptModalFocusTarget,
    action: () => Promise<void>,
  ): Promise<void> => {
    mutationFocusTarget = focusTarget;
    await mutationAction.tryRun(async () => {
      localMutationInProgress = true;
      try {
        await action();
      } finally {
        localMutationInProgress = false;
      }
    });
  };

  const runMutationWhenIdle = async (
    focusTarget: PromptModalFocusTarget,
    action: () => Promise<void>,
  ): Promise<void> => {
    mutationFocusTarget = focusTarget;
    await mutationAction.runWhenIdle(async () => {
      if (isClosed) return;
      localMutationInProgress = true;
      try {
        await action();
      } finally {
        localMutationInProgress = false;
      }
    });
  };

  const createNewPrompt = async (): Promise<void> => {
    await runMutation('titleInput', async () => {
      const previousLibrary = options.plugin.settings.chat.promptLibrary;
      const previousSelectedId = selectedId;
      const entry = createPromptEntry({
        title: t('promptNewSystemPromptTitle'),
        description: t('manualPromptDescription'),
        content: options.currentSessionPrompt?.trim() || '',
        source: 'user',
      });
      options.plugin.settings.chat.promptLibrary = [
        entry,
        ...options.plugin.settings.chat.promptLibrary,
      ];
      selectedId = entry.id;
      if (!(await saveSettings())) {
        options.plugin.settings.chat.promptLibrary = previousLibrary;
        selectedId = previousSelectedId;
      }
    });
  };

  const deleteSelectedPrompt = async (): Promise<void> => {
    await runMutation('selectedPrompt', async () => {
      const entry = getSelectedEntry();
      if (!entry || entry.id === DEFAULT_OBSIDIAN_PROMPT_ID) return;
      const confirmed = await confirmWithModal(
        options.plugin.app,
        t('promptDeleteConfirm', { title: entry.title }),
        { confirmText: t('deleteLabel') },
      );
      if (!confirmed) return;
      const previousLibrary = options.plugin.settings.chat.promptLibrary;
      const previousActivePromptId = options.plugin.settings.chat.activePromptId;
      const previousSystemPrompt = options.plugin.settings.chat.systemPrompt;
      const previousSelectedId = selectedId;
      options.plugin.settings.chat.promptLibrary =
        options.plugin.settings.chat.promptLibrary.filter((item) => item.id !== entry.id);
      if (options.plugin.settings.chat.activePromptId === entry.id) {
        const defaultEntry = options.plugin.settings.chat.promptLibrary.find(
          (item) => item.id === DEFAULT_OBSIDIAN_PROMPT_ID,
        );
        if (defaultEntry) setActivePromptEntry(options.plugin.settings, defaultEntry);
      }
      selectedId =
        options.plugin.settings.chat.activePromptId ??
        options.plugin.settings.chat.promptLibrary[0]?.id ??
        DEFAULT_OBSIDIAN_PROMPT_ID;
      if (!(await saveSettings())) {
        options.plugin.settings.chat.promptLibrary = previousLibrary;
        options.plugin.settings.chat.activePromptId = previousActivePromptId;
        options.plugin.settings.chat.systemPrompt = previousSystemPrompt;
        selectedId = previousSelectedId;
      }
    });
  };

  const saveSelectedPrompt = async (
    titleInput: HTMLInputElement,
    descriptionInput: HTMLInputElement,
    contentInput: HTMLTextAreaElement,
  ): Promise<void> => {
    const content = contentInput.value.trim();
    if (!content) {
      new Notice(t('promptBodyRequired'));
      return;
    }
    const title = titleInput.value.trim() || t('systemPrompt');
    const description = descriptionInput.value.trim() || undefined;
    await runMutation('titleInput', async () => {
      const entry = getSelectedEntry();
      if (!entry) return;
      const entryIndex = options.plugin.settings.chat.promptLibrary.indexOf(entry);
      if (entryIndex < 0) return;
      const previousEntry = { ...entry };
      const previousSystemPrompt = options.plugin.settings.chat.systemPrompt;
      entry.title = title;
      entry.description = description;
      entry.content = content;
      entry.source = entry.source === 'default' ? 'user' : entry.source;
      entry.updatedAt = new Date().toISOString();
      if (options.plugin.settings.chat.activePromptId === entry.id) {
        setActivePromptEntry(options.plugin.settings, entry);
      }
      if (!(await saveSettings())) {
        options.plugin.settings.chat.promptLibrary[entryIndex] = previousEntry;
        options.plugin.settings.chat.systemPrompt = previousSystemPrompt;
        return;
      }
      new Notice(t('promptSavedNotice'));
    });
  };

  const applySelectedToSession = (): void => {
    const entry = getSelectedEntry();
    if (!entry || !options.onApplyToSession) return;
    options.onApplyToSession(entry.content);
    new Notice(t('promptAppliedToSessionNotice', { title: entry.title }));
  };

  const setSelectedAsGlobalDefault = async (): Promise<void> => {
    await runMutation('titleInput', async () => {
      const entry = getSelectedEntry();
      if (!entry) return;
      const previousActivePromptId = options.plugin.settings.chat.activePromptId;
      const previousSystemPrompt = options.plugin.settings.chat.systemPrompt;
      setActivePromptEntry(options.plugin.settings, entry);
      if (!(await saveSettings())) {
        options.plugin.settings.chat.activePromptId = previousActivePromptId;
        options.plugin.settings.chat.systemPrompt = previousSystemPrompt;
        return;
      }
      new Notice(t('promptSetGlobalDefaultNotice', { title: entry.title }));
    });
  };

  const generateVaultPrompt = async (
    modelSelect: HTMLSelectElement,
    directionSelect: HTMLSelectElement,
    directionText: HTMLTextAreaElement,
    generateBtn: HTMLButtonElement,
  ): Promise<void> => {
    const vectorStore = options.plugin.vectorStore;
    if (!vectorStore) {
      new Notice(t('promptRagStoreMissing'), 7000);
      return;
    }
    if (isGenerating) return;
    isGenerating = true;
    const generationToken = ++generationSequence;
    let saveMutationStarted = false;
    generateBtn.setText(t('generating'));
    setMutationBusy();
    try {
      const providerInfo = createPromptGenerationProvider(
        options.plugin.settings,
        modelSelect.value,
      );
      if (!providerInfo) {
        new Notice(t('promptGenerationModelRequired'));
        return;
      }
      const entries = await vectorStore.getEntries();
      if (isClosed || generationToken !== generationSequence) return;
      if (entries.length === 0) {
        new Notice(t('promptNoEmbeddedVaultInfo'), 7000);
        return;
      }
      const preset = getPromptDirectionPresets().find((item) => item.id === directionSelect.value);
      const generated = await providerInfo.provider.chat(
        buildVaultPromptGenerationMessages({
          entries,
          directionPreset: preset,
          directionText: directionText.value,
        }),
        0.4,
      );
      if (isClosed || generationToken !== generationSequence) return;
      const content = generated.trim();
      if (!content) {
        new Notice(t('promptEmptyModelResponse'));
        return;
      }
      const entry = createPromptEntry({
        title: t('vaultBasedPromptTitle', { preset: preset?.label ?? t('customLabel') }),
        description: t('generatedPromptDescription'),
        content,
        source: 'generated',
        directionPreset: preset?.id,
        directionText: directionText.value,
        model: providerInfo.model,
      });
      saveMutationStarted = true;
      await runMutationWhenIdle('titleInput', async () => {
        const previousLibrary = options.plugin.settings.chat.promptLibrary;
        const previousSelectedId = selectedId;
        options.plugin.settings.chat.promptLibrary = [
          entry,
          ...options.plugin.settings.chat.promptLibrary,
        ];
        selectedId = entry.id;
        if (!(await saveSettings())) {
          options.plugin.settings.chat.promptLibrary = previousLibrary;
          selectedId = previousSelectedId;
          return;
        }
        new Notice(t('vaultBasedPromptGeneratedNotice'));
      });
    } catch (err) {
      if (isClosed) return;
      const message = err instanceof Error ? err.message : String(err);
      new Notice(t('promptGenerationFailed', { message }), 7000);
    } finally {
      if (generationToken === generationSequence) isGenerating = false;
      if (!isClosed && !saveMutationStarted) {
        modal.removeAttribute('aria-busy');
        render('titleInput');
      }
    }
  };

  const renderList = (): void => {
    listPane.empty();
    const actions = listPane.createDiv({ cls: 'superpower-inside-prompt-list-actions' });
    const newBtn = actions.createEl('button', {
      cls: 'superpower-inside-prompt-secondary-btn',
      text: t('newPromptButton'),
      attr: { type: 'button', 'data-prompt-focus': 'newPromptButton' },
    });
    newBtn.addEventListener('click', () => void createNewPrompt());

    const list = listPane.createDiv({ cls: 'superpower-inside-prompt-list' });
    for (const entry of options.plugin.settings.chat.promptLibrary) {
      const isActive = entry.id === selectedId;
      const item = list.createEl('button', {
        cls: `superpower-inside-prompt-list-item${entry.id === selectedId ? ' is-active' : ''}`,
        attr: {
          type: 'button',
          ...(isActive ? { 'aria-current': 'true' } : {}),
          ...(isActive ? { 'data-prompt-focus': 'selectedPrompt' } : {}),
        },
      });
      item.addEventListener('click', () => selectEntry(entry.id));
      item.createDiv({ cls: 'superpower-inside-prompt-list-title', text: entry.title });
      item.createDiv({
        cls: 'superpower-inside-prompt-list-meta',
        text: formatPromptSource(entry),
      });
      if (entry.description) {
        item.createDiv({ cls: 'superpower-inside-prompt-list-desc', text: entry.description });
      }
    }
  };

  const renderDetail = (): void => {
    detailPane.empty();
    const entry = getSelectedEntry();
    if (!entry) {
      detailPane.createDiv({ cls: 'superpower-inside-prompt-empty', text: t('promptEmptyState') });
      return;
    }

    const form = detailPane.createDiv({ cls: 'superpower-inside-prompt-form' });
    const titleInputId = `${modalId}-prompt-title`;
    form.createEl('label', { text: t('titleLabel'), attr: { for: titleInputId } });
    const titleInput = form.createEl('input', {
      cls: 'superpower-inside-prompt-input',
      attr: {
        id: titleInputId,
        type: 'text',
        'data-prompt-focus': 'titleInput',
      },
    });
    titleInput.value = entry.title;

    const descriptionInputId = `${modalId}-prompt-description`;
    form.createEl('label', {
      text: t('descriptionLabel'),
      attr: { for: descriptionInputId },
    });
    const descriptionInput = form.createEl('input', {
      cls: 'superpower-inside-prompt-input',
      attr: { id: descriptionInputId, type: 'text' },
    });
    descriptionInput.value = entry.description ?? '';

    const contentInputId = `${modalId}-prompt-content`;
    form.createEl('label', { text: t('systemPrompt'), attr: { for: contentInputId } });
    const contentInput = form.createEl('textarea', {
      cls: 'superpower-inside-prompt-textarea',
      text: entry.content,
      attr: { id: contentInputId, rows: '12' },
    });
    contentInput.value = entry.content;

    const actionRow = form.createDiv({ cls: 'superpower-inside-prompt-actions' });
    const saveBtn = actionRow.createEl('button', {
      cls: 'superpower-inside-prompt-primary-btn',
      text: t('save'),
      attr: { type: 'button' },
    });
    saveBtn.addEventListener(
      'click',
      () => void saveSelectedPrompt(titleInput, descriptionInput, contentInput),
    );

    if (options.onApplyToSession) {
      const applyBtn = actionRow.createEl('button', {
        cls: 'superpower-inside-prompt-secondary-btn',
        text: t('applyToCurrentSession'),
        attr: { type: 'button' },
      });
      applyBtn.addEventListener('click', applySelectedToSession);
    }

    const defaultBtn = actionRow.createEl('button', {
      cls: 'superpower-inside-prompt-secondary-btn',
      text:
        entry.id === options.plugin.settings.chat.activePromptId
          ? t('globalDefault')
          : t('setGlobalDefault'),
      attr: { type: 'button' },
    });
    defaultBtn.disabled = entry.id === options.plugin.settings.chat.activePromptId;
    defaultBtn.addEventListener('click', () => void setSelectedAsGlobalDefault());

    const deleteBtn = actionRow.createEl('button', {
      cls: 'superpower-inside-prompt-danger-btn',
      text: t('deleteLabel'),
      attr: { type: 'button' },
    });
    deleteBtn.disabled = entry.id === DEFAULT_OBSIDIAN_PROMPT_ID;
    deleteBtn.addEventListener('click', () => void deleteSelectedPrompt());

    renderGenerationPanel(detailPane);
  };

  const renderGenerationPanel = (container: HTMLElement): void => {
    const panel = container.createDiv({ cls: 'superpower-inside-prompt-generation' });
    panel.createDiv({
      cls: 'superpower-inside-prompt-generation-heading',
      text: t('embeddedVaultGenerateTitle'),
    });
    panel.createDiv({
      cls: 'superpower-inside-prompt-generation-description',
      text: t('promptGenerationDataBoundary'),
    });

    const modelState = resolvePromptGenerationModelState(
      options.plugin.settings,
      options.selectedModel,
    );
    const modelOptions = modelState.options;
    const hasModels = modelOptions.length > 0;
    const hasSelectedModel = modelState.selectedModel.length > 0;
    const modelSelectId = `${modalId}-generation-model`;
    panel.createEl('label', {
      cls: 'superpower-inside-prompt-field-label',
      text: t('promptGenerationModelLabel'),
      attr: { for: modelSelectId },
    });
    const modelSelect = panel.createEl('select', {
      cls: 'superpower-inside-prompt-input',
      attr: { id: modelSelectId },
    });
    let unavailableReason: HTMLElement | null = null;
    if (!hasModels) {
      const opt = modelSelect.createEl('option');
      opt.value = '';
      opt.text = t('noModelsEnabled');
      modelSelect.disabled = true;
      unavailableReason = panel.createDiv({
        cls: 'superpower-inside-prompt-generation-unavailable',
        text: t('promptGenerationNoModelsReason'),
      });
      unavailableReason.id = `${modalId}-generation-unavailable`;
      unavailableReason.setAttribute('role', 'status');
      modelSelect.setAttribute('aria-describedby', unavailableReason.id);
    } else {
      if (!hasSelectedModel) {
        const opt = modelSelect.createEl('option');
        opt.value = '';
        opt.text = t('chatReadinessSelectModelAction');
      }
      for (const model of modelOptions) {
        const opt = modelSelect.createEl('option');
        opt.value = model.value;
        opt.text = model.label;
      }
      modelSelect.value = modelState.selectedModel;
      if (!hasSelectedModel) {
        unavailableReason = panel.createDiv({
          cls: 'superpower-inside-prompt-generation-unavailable',
          text: t('promptGenerationModelRequired'),
        });
        unavailableReason.id = `${modalId}-generation-selection-required`;
        unavailableReason.setAttribute('role', 'status');
        modelSelect.setAttribute('aria-describedby', unavailableReason.id);
      }
    }

    const directionSelectId = `${modalId}-generation-direction`;
    panel.createEl('label', {
      cls: 'superpower-inside-prompt-field-label',
      text: t('promptGenerationDirectionLabel'),
      attr: { for: directionSelectId },
    });
    const directionSelect = panel.createEl('select', {
      cls: 'superpower-inside-prompt-input',
      attr: { id: directionSelectId },
    });
    for (const preset of getPromptDirectionPresets()) {
      const opt = directionSelect.createEl('option');
      opt.value = preset.id;
      opt.text = preset.label;
    }
    directionSelect.disabled = !hasSelectedModel;

    const directionTextId = `${modalId}-generation-guidance`;
    panel.createEl('label', {
      cls: 'superpower-inside-prompt-field-label',
      text: t('promptGenerationGuidanceLabel'),
      attr: { for: directionTextId },
    });
    const directionText = panel.createEl('textarea', {
      cls: 'superpower-inside-prompt-direction',
      attr: {
        id: directionTextId,
        rows: '3',
        placeholder: t('promptDirectionPlaceholder'),
      },
    });
    directionText.disabled = !hasSelectedModel;

    const generateBtn = panel.createEl('button', {
      cls: 'superpower-inside-prompt-primary-btn',
      text: t('vaultBasedGeneration'),
      attr: { type: 'button' },
    });
    generateBtn.disabled = !hasSelectedModel;
    const updateGenerationAvailability = (): void => {
      const enabled = hasModels && modelSelect.value.trim().length > 0;
      directionSelect.disabled = !enabled;
      directionText.disabled = !enabled;
      generateBtn.disabled = !enabled;
      if (unavailableReason && hasModels) unavailableReason.hidden = enabled;
    };
    modelSelect.addEventListener('change', updateGenerationAvailability);
    updateGenerationAvailability();
    generateBtn.addEventListener(
      'click',
      () => void generateVaultPrompt(modelSelect, directionSelect, directionText, generateBtn),
    );
  };

  function render(focusTarget?: PromptModalFocusTarget): void {
    selectedId = resolvePromptModalSelection(
      selectedId,
      options.plugin.settings.chat.activePromptId,
      options.plugin.settings.chat.promptLibrary.map((entry) => entry.id),
      DEFAULT_OBSIDIAN_PROMPT_ID,
    );
    renderList();
    renderDetail();
    if (focusTarget && !focusPromptModalTarget(modal, focusTarget)) {
      modal.focus();
    }
  }

  render();
  let hasObservedMutationState = false;
  unsubscribeMutation = mutationAction.subscribe((running) => {
    if (isClosed) return;
    if (running) {
      setMutationBusy();
    } else if (hasObservedMutationState) {
      modal.removeAttribute('aria-busy');
      render(mutationFocusTarget);
    }
    hasObservedMutationState = true;
  });
  closeBtn.focus();
}

function formatPromptSource(entry: PromptLibraryEntry): string {
  const source =
    entry.source === 'default'
      ? t('promptSourceDefault')
      : entry.source === 'generated'
        ? t('promptSourceGenerated')
        : t('promptSourceUser');
  const model = entry.model ? ` · ${entry.model}` : '';
  return `${source}${model}`;
}
