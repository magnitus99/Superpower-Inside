import { Notice } from 'obsidian';
import { t } from '../i18n';
import {
  CHAT_PROVIDER_KEYS,
  PROVIDER_LABELS,
  type PluginLike,
  type ProviderKey,
} from '../settings';
import { createCustomOpenAIProvider, createProvider, type LLMProvider } from '../llm/providers';
import {
  buildVaultPromptGenerationMessages,
  createPromptEntry,
  DEFAULT_OBSIDIAN_PROMPT_ID,
  getPromptDirectionPresets,
  type PromptLibraryEntry,
} from './prompt-library';

const PROMPT_MODAL_STYLE_ID = 'superpower-inside-prompt-library-modal-styles';

interface ModelOption {
  value: string;
  label: string;
}

interface OpenPromptLibraryModalOptions {
  containerEl: HTMLElement;
  plugin: PluginLike;
  currentSessionPrompt: string | null;
  selectedModel: string;
  onApplyToSession?: (prompt: string) => void;
  onClose?: () => void;
}

export function openPromptLibraryModal(options: OpenPromptLibraryModalOptions): void {
  ensurePromptLibraryModalStyles(options.containerEl.ownerDocument);

  const overlay = options.containerEl.createDiv({ cls: 'superpower-inside-prompt-overlay' });
  const modal = overlay.createDiv({ cls: 'superpower-inside-prompt-modal' });
  const titleBar = modal.createDiv({ cls: 'superpower-inside-prompt-titlebar' });
  titleBar.createDiv({
    cls: 'superpower-inside-prompt-heading',
    text: t('promptLibraryTitle'),
  });
  const closeBtn = titleBar.createEl('button', {
    cls: 'superpower-inside-prompt-close',
    text: '×',
    attr: { type: 'button', 'aria-label': t('closeLabel') },
  });

  const body = modal.createDiv({ cls: 'superpower-inside-prompt-body' });
  const listPane = body.createDiv({ cls: 'superpower-inside-prompt-list-pane' });
  const detailPane = body.createDiv({ cls: 'superpower-inside-prompt-detail-pane' });

  let selectedId =
    options.plugin.settings.chat.activePromptId ??
    options.plugin.settings.chat.promptLibrary[0]?.id ??
    DEFAULT_OBSIDIAN_PROMPT_ID;
  let isGenerating = false;

  const close = (): void => {
    overlay.remove();
    options.onClose?.();
  };
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });

  const saveSettings = async (): Promise<boolean> => {
    const result = await options.plugin.saveSettings({ reinitRag: false, reinitMcp: false });
    if (!result.success && result.mcpErrors && result.mcpErrors.length > 0) {
      new Notice(t('settingsSaveMcpReconnectFailed', { count: result.mcpErrors.length }), 5000);
    }
    return result.success;
  };

  const getSelectedEntry = (): PromptLibraryEntry | null =>
    options.plugin.settings.chat.promptLibrary.find((entry) => entry.id === selectedId) ?? null;

  const selectEntry = (id: string): void => {
    selectedId = id;
    render();
  };

  const createNewPrompt = async (): Promise<void> => {
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
    await saveSettings();
    render();
  };

  const deleteSelectedPrompt = async (): Promise<void> => {
    const entry = getSelectedEntry();
    if (!entry || entry.id === DEFAULT_OBSIDIAN_PROMPT_ID) return;
    const confirmed = window.confirm(t('promptDeleteConfirm', { title: entry.title }));
    if (!confirmed) return;
    options.plugin.settings.chat.promptLibrary = options.plugin.settings.chat.promptLibrary.filter(
      (item) => item.id !== entry.id,
    );
    if (options.plugin.settings.chat.activePromptId === entry.id) {
      options.plugin.settings.chat.activePromptId = DEFAULT_OBSIDIAN_PROMPT_ID;
    }
    selectedId =
      options.plugin.settings.chat.activePromptId ??
      options.plugin.settings.chat.promptLibrary[0]?.id ??
      DEFAULT_OBSIDIAN_PROMPT_ID;
    await saveSettings();
    render();
  };

  const saveSelectedPrompt = async (
    titleInput: HTMLInputElement,
    descriptionInput: HTMLInputElement,
    contentInput: HTMLTextAreaElement,
  ): Promise<void> => {
    const entry = getSelectedEntry();
    if (!entry) return;
    const content = contentInput.value.trim();
    if (!content) {
      new Notice(t('promptBodyRequired'));
      return;
    }
    entry.title = titleInput.value.trim() || t('systemPrompt');
    entry.description = descriptionInput.value.trim() || undefined;
    entry.content = content;
    entry.source = entry.source === 'default' ? 'user' : entry.source;
    entry.updatedAt = new Date().toISOString();
    await saveSettings();
    new Notice(t('promptSavedNotice'));
    render();
  };

  const applySelectedToSession = (): void => {
    const entry = getSelectedEntry();
    if (!entry || !options.onApplyToSession) return;
    options.onApplyToSession(entry.content);
    new Notice(t('promptAppliedToSessionNotice', { title: entry.title }));
  };

  const setSelectedAsGlobalDefault = async (): Promise<void> => {
    const entry = getSelectedEntry();
    if (!entry) return;
    options.plugin.settings.chat.activePromptId = entry.id;
    await saveSettings();
    new Notice(t('promptSetGlobalDefaultNotice', { title: entry.title }));
    render();
  };

  const generateVaultPrompt = async (
    modelSelect: HTMLSelectElement,
    directionSelect: HTMLSelectElement,
    directionText: HTMLTextAreaElement,
    generateBtn: HTMLButtonElement,
  ): Promise<void> => {
    if (isGenerating) return;
    const providerInfo = createProviderFromModelValue(options.plugin, modelSelect.value);
    if (!providerInfo) {
      new Notice(t('promptGenerationModelRequired'));
      return;
    }
    const vectorStore = options.plugin.vectorStore;
    if (!vectorStore) {
      new Notice(t('promptRagStoreMissing'), 7000);
      return;
    }

    isGenerating = true;
    generateBtn.disabled = true;
    generateBtn.setText(t('generating'));
    try {
      const entries = await vectorStore.getEntries();
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
      options.plugin.settings.chat.promptLibrary = [
        entry,
        ...options.plugin.settings.chat.promptLibrary,
      ];
      selectedId = entry.id;
      await saveSettings();
      new Notice(t('vaultBasedPromptGeneratedNotice'));
      render();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      new Notice(t('promptGenerationFailed', { message }), 7000);
    } finally {
      isGenerating = false;
      generateBtn.disabled = false;
      generateBtn.setText(t('vaultBasedGeneration'));
    }
  };

  const renderList = (): void => {
    listPane.empty();
    const actions = listPane.createDiv({ cls: 'superpower-inside-prompt-list-actions' });
    const newBtn = actions.createEl('button', {
      cls: 'superpower-inside-prompt-secondary-btn',
      text: t('newPromptButton'),
      attr: { type: 'button' },
    });
    newBtn.addEventListener('click', () => void createNewPrompt());

    const list = listPane.createDiv({ cls: 'superpower-inside-prompt-list' });
    for (const entry of options.plugin.settings.chat.promptLibrary) {
      const item = list.createDiv({
        cls: `superpower-inside-prompt-list-item${entry.id === selectedId ? ' is-active' : ''}`,
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
    form.createEl('label', { text: t('titleLabel') });
    const titleInput = form.createEl('input', {
      cls: 'superpower-inside-prompt-input',
      attr: { type: 'text' },
    });
    titleInput.value = entry.title;

    form.createEl('label', { text: t('descriptionLabel') });
    const descriptionInput = form.createEl('input', {
      cls: 'superpower-inside-prompt-input',
      attr: { type: 'text' },
    });
    descriptionInput.value = entry.description ?? '';

    form.createEl('label', { text: t('systemPrompt') });
    const contentInput = form.createEl('textarea', {
      cls: 'superpower-inside-prompt-textarea',
      text: entry.content,
      attr: { rows: '12' },
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

    const modelOptions = getModelOptions(options.plugin);
    const modelSelect = panel.createEl('select', { cls: 'superpower-inside-prompt-input' });
    if (modelOptions.length === 0) {
      const opt = modelSelect.createEl('option');
      opt.value = '';
      opt.text = t('noModelsEnabled');
      modelSelect.disabled = true;
    } else {
      for (const model of modelOptions) {
        const opt = modelSelect.createEl('option');
        opt.value = model.value;
        opt.text = model.label;
      }
      modelSelect.value = modelOptions.some((model) => model.value === options.selectedModel)
        ? options.selectedModel
        : modelOptions[0].value;
    }

    const directionSelect = panel.createEl('select', { cls: 'superpower-inside-prompt-input' });
    for (const preset of getPromptDirectionPresets()) {
      const opt = directionSelect.createEl('option');
      opt.value = preset.id;
      opt.text = preset.label;
    }

    const directionText = panel.createEl('textarea', {
      cls: 'superpower-inside-prompt-direction',
      attr: {
        rows: '3',
        placeholder: t('promptDirectionPlaceholder'),
      },
    });

    const generateBtn = panel.createEl('button', {
      cls: 'superpower-inside-prompt-primary-btn',
      text: t('vaultBasedGeneration'),
      attr: { type: 'button' },
    });
    generateBtn.addEventListener(
      'click',
      () => void generateVaultPrompt(modelSelect, directionSelect, directionText, generateBtn),
    );
  };

  const render = (): void => {
    renderList();
    renderDetail();
  };

  render();
}

function getModelOptions(plugin: PluginLike): ModelOption[] {
  const options: ModelOption[] = [];
  for (const key of CHAT_PROVIDER_KEYS) {
    const config = plugin.settings[key];
    if (!config.enabled) continue;
    for (const model of config.models) {
      options.push({ value: `${key}:${model}`, label: `${PROVIDER_LABELS[key]} — ${model}` });
    }
  }
  for (const provider of plugin.settings.customOpenAIProviders) {
    if (!provider.enabled) continue;
    const label = provider.name.trim() || 'Custom OpenAI-Compatible';
    for (const model of provider.models) {
      options.push({
        value: `customOpenAI:${provider.id}:${model}`,
        label: `${label} — ${model}`,
      });
    }
  }
  return options.sort((a, b) => a.label.localeCompare(b.label, 'en'));
}

function createProviderFromModelValue(
  plugin: PluginLike,
  value: string,
): { provider: LLMProvider; model: string } | null {
  const parts = value.split(':');
  if (parts.length < 2) return null;

  if (parts[0] === 'customOpenAI') {
    if (parts.length < 3) return null;
    const providerId = parts[1];
    const modelName = parts.slice(2).join(':');
    const customProvider = plugin.settings.customOpenAIProviders.find(
      (provider) => provider.id === providerId,
    );
    if (!customProvider?.enabled || !customProvider.baseUrl?.trim()) return null;
    return { provider: createCustomOpenAIProvider(customProvider, modelName), model: modelName };
  }

  const providerKey = parts[0] as ProviderKey;
  const modelName = parts.slice(1).join(':');
  const config = plugin.settings[providerKey];
  if (!config?.enabled) return null;
  return { provider: createProvider(providerKey, config, modelName), model: modelName };
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

function ensurePromptLibraryModalStyles(doc: Document): void {
  if (doc.getElementById(PROMPT_MODAL_STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = PROMPT_MODAL_STYLE_ID;
  style.textContent = `
    .superpower-inside-prompt-overlay {
      position: fixed;
      inset: 0;
      z-index: 1000;
      background: rgba(0, 0, 0, 0.45);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 32px;
    }
    .superpower-inside-prompt-modal {
      width: min(1040px, 96vw);
      max-height: 88vh;
      display: flex;
      flex-direction: column;
      background: var(--background-primary);
      color: var(--text-normal);
      border: 1px solid var(--background-modifier-border);
      border-radius: 8px;
      box-shadow: var(--shadow-l);
      overflow: hidden;
    }
    .superpower-inside-prompt-titlebar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 18px;
      border-bottom: 1px solid var(--background-modifier-border);
    }
    .superpower-inside-prompt-heading,
    .superpower-inside-prompt-generation-heading {
      margin: 0;
      font-size: var(--font-ui-medium);
      line-height: 1.4;
    }
    .superpower-inside-prompt-close {
      border: 0;
      background: transparent;
      color: var(--text-muted);
      font-size: 22px;
      cursor: pointer;
    }
    .superpower-inside-prompt-body {
      min-height: 0;
      display: grid;
      grid-template-columns: minmax(220px, 300px) minmax(0, 1fr);
    }
    .superpower-inside-prompt-list-pane {
      min-height: 0;
      border-right: 1px solid var(--background-modifier-border);
      display: flex;
      flex-direction: column;
    }
    .superpower-inside-prompt-list-actions,
    .superpower-inside-prompt-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      padding: 12px;
    }
    .superpower-inside-prompt-list {
      overflow: auto;
      padding: 0 8px 12px;
    }
    .superpower-inside-prompt-list-item {
      padding: 10px;
      border-radius: 8px;
      cursor: pointer;
    }
    .superpower-inside-prompt-list-item:hover,
    .superpower-inside-prompt-list-item.is-active {
      background: var(--background-modifier-hover);
    }
    .superpower-inside-prompt-list-title {
      font-weight: 600;
      line-height: 1.35;
      overflow-wrap: anywhere;
    }
    .superpower-inside-prompt-list-meta,
    .superpower-inside-prompt-list-desc {
      margin-top: 4px;
      color: var(--text-muted);
      font-size: var(--font-ui-smaller);
      line-height: 1.35;
      overflow-wrap: anywhere;
    }
    .superpower-inside-prompt-detail-pane {
      overflow: auto;
      padding: 16px;
    }
    .superpower-inside-prompt-form {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .superpower-inside-prompt-form label {
      color: var(--text-muted);
      font-size: var(--font-ui-small);
      font-weight: 600;
    }
    .superpower-inside-prompt-input,
    .superpower-inside-prompt-textarea,
    .superpower-inside-prompt-direction {
      width: 100%;
      resize: vertical;
    }
    .superpower-inside-prompt-textarea {
      min-height: 260px;
      font-family: var(--font-monospace);
      line-height: 1.45;
    }
    .superpower-inside-prompt-primary-btn,
    .superpower-inside-prompt-secondary-btn,
    .superpower-inside-prompt-danger-btn {
      border-radius: 6px;
      padding: 6px 10px;
      cursor: pointer;
    }
    .superpower-inside-prompt-primary-btn {
      background: var(--interactive-accent);
      color: var(--text-on-accent);
      border: 1px solid var(--interactive-accent);
    }
    .superpower-inside-prompt-secondary-btn {
      background: var(--background-secondary);
      color: var(--text-normal);
      border: 1px solid var(--background-modifier-border);
    }
    .superpower-inside-prompt-danger-btn {
      background: var(--background-secondary);
      color: var(--text-error);
      border: 1px solid var(--background-modifier-border);
    }
    .superpower-inside-prompt-generation {
      margin-top: 16px;
      padding-top: 16px;
      border-top: 1px solid var(--background-modifier-border);
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .superpower-inside-prompt-empty {
      color: var(--text-muted);
      padding: 16px;
    }
    @media (max-width: 760px) {
      .superpower-inside-prompt-overlay {
        padding: 12px;
      }
      .superpower-inside-prompt-body {
        grid-template-columns: 1fr;
      }
      .superpower-inside-prompt-list-pane {
        max-height: 220px;
        border-right: 0;
        border-bottom: 1px solid var(--background-modifier-border);
      }
    }
  `;
  doc.head.appendChild(style);
}
