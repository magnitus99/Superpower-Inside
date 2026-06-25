import { ItemView, Notice, WorkspaceLeaf } from 'obsidian';
import type { SuperpowerInsideSettings } from '../settings';
import { t } from '../i18n';

export const AGENT_DIAGNOSTICS_VIEW_TYPE = 'superpower-inside-agent-diagnostics';

interface AgentDiagnosticsPluginLike {
  settings: SuperpowerInsideSettings;
  getAgentDiagnosticsFilePath(): string;
  getAgentDiagnosticsSnapshotText(): string;
  writeAgentDiagnosticsSnapshot(reason: string): Promise<void>;
  clearAgentDiagnosticsDetailedLogging(): Promise<void>;
}

export class AgentDiagnosticsView extends ItemView {
  private readonly plugin: AgentDiagnosticsPluginLike;
  private snapshotEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private refreshTimer: number | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: AgentDiagnosticsPluginLike) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return AGENT_DIAGNOSTICS_VIEW_TYPE;
  }

  getDisplayText(): string {
    return t('agentDiagnosticsViewTitle');
  }

  getIcon(): string {
    return 'bug';
  }

  async onOpen(): Promise<void> {
    await Promise.resolve();
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass('superpower-inside-agent-diagnostics-view');
    this.buildLayout(container as HTMLElement);
    this.refresh();
    this.refreshTimer = window.setInterval(() => {
      this.refresh();
    }, 2_000);
  }

  async onClose(): Promise<void> {
    await Promise.resolve();
    if (this.refreshTimer !== null) {
      window.clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.snapshotEl = null;
    this.statusEl = null;
  }

  private buildLayout(containerEl: HTMLElement): void {
    const header = containerEl.createDiv({ cls: 'superpower-inside-agent-diagnostics-header' });
    const title = header.createDiv({ cls: 'superpower-inside-agent-diagnostics-title' });
    title.createDiv({
      cls: 'superpower-inside-agent-diagnostics-heading',
      text: t('agentDiagnosticsViewTitle'),
    });
    title.createDiv({
      cls: 'superpower-inside-agent-diagnostics-subtitle',
      text: t('agentDiagnosticsViewDesc'),
    });

    const actions = header.createDiv({ cls: 'superpower-inside-agent-diagnostics-actions' });
    const refreshButton = actions.createEl('button', {
      attr: { type: 'button' },
      text: t('agentDiagnosticsRefreshButton'),
    });
    refreshButton.addEventListener('click', () => {
      this.refresh();
    });

    const writeButton = actions.createEl('button', {
      attr: { type: 'button' },
      text: t('agentDiagnosticsWriteButton'),
    });
    writeButton.addEventListener('click', () => {
      void this.writeSnapshot();
    });

    const copyButton = actions.createEl('button', {
      attr: { type: 'button' },
      text: t('agentDiagnosticsCopyButton'),
    });
    copyButton.addEventListener('click', () => {
      void this.copySnapshot();
    });

    const clearButton = actions.createEl('button', {
      attr: { type: 'button' },
      text: t('agentDiagnosticsClearButton'),
    });
    clearButton.addEventListener('click', () => {
      void this.clearDetailedLogging();
    });

    this.statusEl = containerEl.createDiv({ cls: 'superpower-inside-agent-diagnostics-status' });
    this.snapshotEl = containerEl.createEl('pre', {
      cls: 'superpower-inside-agent-diagnostics-snapshot',
    });
  }

  private refresh(): void {
    const enabled = this.plugin.settings.agentDiagnostics.enabled;
    this.statusEl?.setText(
      enabled
        ? t('agentDiagnosticsEnabledStatus', { path: this.plugin.getAgentDiagnosticsFilePath() })
        : t('agentDiagnosticsDisabledStatus'),
    );
    this.snapshotEl?.setText(this.plugin.getAgentDiagnosticsSnapshotText());
  }

  private async writeSnapshot(): Promise<void> {
    await this.plugin.writeAgentDiagnosticsSnapshot('view-write');
    this.refresh();
    new Notice(t('agentDiagnosticsWriteDone'));
  }

  private async copySnapshot(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.plugin.getAgentDiagnosticsSnapshotText());
      new Notice(t('agentDiagnosticsCopied'));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      new Notice(t('agentDiagnosticsCopyFailed', { message }), 5000);
    }
  }

  private async clearDetailedLogging(): Promise<void> {
    await this.plugin.clearAgentDiagnosticsDetailedLogging();
    this.refresh();
    new Notice(t('agentDiagnosticsClearDone'));
  }
}
