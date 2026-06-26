import { ItemView, Notice, WorkspaceLeaf } from 'obsidian';
import type { SuperpowerInsideSettings } from '../settings';
import { t } from '../i18n';
import {
  LOG_LEVEL_LABELS,
  LOG_LEVELS,
  type AppLogger,
  type LogEntry,
  type LogLevel,
} from '../utils/logger';
import type {
  AgentDiagnosticsActiveOperationState,
  AgentDiagnosticsRecommendedActionSnapshot,
  AgentDiagnosticsSnapshot,
} from './snapshot';

export const AGENT_DIAGNOSTICS_VIEW_TYPE = 'superpower-inside-agent-diagnostics';

interface AgentDiagnosticsPluginLike {
  settings: SuperpowerInsideSettings;
  logger: AppLogger;
  saveSettingsLight(): Promise<void>;
  getAgentDiagnosticsFilePath(): string;
  getAgentDiagnosticsEventLogPath(): string;
  getAgentDiagnosticsSafeModeFilePath(): string;
  getAgentDiagnosticsSnapshotText(): string;
  writeAgentDiagnosticsSnapshot(reason: string): Promise<void>;
  clearAgentDiagnosticsDetailedLogging(): Promise<void>;
  enableAgentDiagnosticsSafeMode(): Promise<void>;
}

export class AgentDiagnosticsView extends ItemView {
  private readonly plugin: AgentDiagnosticsPluginLike;
  private snapshotEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private diagnosisEl: HTMLElement | null = null;
  private entriesContainer: HTMLElement | null = null;
  private countEl: HTMLElement | null = null;
  private levelFilter: LogLevel | 'all' = 'all';
  private sourceFilter = '';
  private loggerUnsubscribe: (() => void) | null = null;
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
    this.loggerUnsubscribe = this.plugin.logger.subscribe(() => {
      this.refresh();
    });
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
    this.loggerUnsubscribe?.();
    this.loggerUnsubscribe = null;
    this.snapshotEl = null;
    this.statusEl = null;
    this.diagnosisEl = null;
    this.entriesContainer = null;
    this.countEl = null;
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
    this.diagnosisEl = containerEl.createDiv({
      cls: 'superpower-inside-agent-diagnostics-diagnosis',
    });
    this.buildLogSection(containerEl);
    this.snapshotEl = containerEl.createEl('pre', {
      cls: 'superpower-inside-agent-diagnostics-snapshot',
    });
  }

  private buildLogSection(containerEl: HTMLElement): void {
    const section = containerEl.createDiv({ cls: 'superpower-inside-agent-diagnostics-logs' });
    const header = section.createDiv({ cls: 'superpower-inside-logs-header' });
    const title = header.createDiv({ cls: 'superpower-inside-logs-title' });
    title.createDiv({ cls: 'superpower-inside-logs-heading', text: t('loggingViewerTitle') });
    title.createDiv({ cls: 'superpower-inside-logs-subtitle', text: t('loggingViewerDesc') });

    const actions = header.createDiv({ cls: 'superpower-inside-logs-actions' });
    const copyButton = actions.createEl('button', {
      attr: { type: 'button' },
      text: t('loggingCopyVisible'),
    });
    copyButton.addEventListener('click', () => {
      void this.copyVisibleLogs();
    });
    const clearButton = actions.createEl('button', {
      attr: { type: 'button' },
      text: t('loggingClear'),
    });
    clearButton.addEventListener('click', () => {
      this.plugin.logger.clear();
      this.refresh();
    });

    const runtimeControls = section.createDiv({
      cls: 'superpower-inside-logs-runtime-controls',
    });
    const minLevelControl = runtimeControls.createDiv({ cls: 'superpower-inside-logs-control' });
    minLevelControl.createSpan({ text: t('loggingMinLevel') });
    const minLevelSelect = minLevelControl.createEl('select');
    for (const level of LOG_LEVELS) {
      const option = minLevelSelect.createEl('option');
      option.value = level;
      option.text = LOG_LEVEL_LABELS[level];
    }
    minLevelSelect.value = this.plugin.settings.logging.minLevel;
    minLevelSelect.addEventListener('change', () => {
      void this.updateMinLevel(minLevelSelect.value as LogLevel);
    });

    const mirrorLabel = runtimeControls.createEl('label', {
      cls: 'superpower-inside-logs-toggle-control',
    });
    const mirrorInput = mirrorLabel.createEl('input', { type: 'checkbox' });
    mirrorInput.checked = this.plugin.settings.logging.mirrorToConsole;
    mirrorLabel.createSpan({ text: t('loggingMirrorConsole') });
    mirrorInput.addEventListener('change', () => {
      void this.updateMirrorToConsole(mirrorInput.checked);
    });

    const maxEntriesControl = runtimeControls.createDiv({ cls: 'superpower-inside-logs-control' });
    maxEntriesControl.createSpan({ text: t('loggingMaxEntries') });
    const maxEntriesInput = maxEntriesControl.createEl('input', {
      attr: {
        type: 'number',
        min: '100',
        max: '10000',
        step: '100',
      },
    });
    maxEntriesInput.value = String(this.plugin.settings.logging.maxEntries);
    maxEntriesInput.addEventListener('change', () => {
      void this.updateMaxEntries(maxEntriesInput.value);
    });

    const controls = section.createDiv({ cls: 'superpower-inside-logs-controls' });
    const levelControl = controls.createDiv({ cls: 'superpower-inside-logs-control' });
    levelControl.createSpan({ text: t('loggingFilterLevel') });
    const levelSelect = levelControl.createEl('select');
    const allOption = levelSelect.createEl('option');
    allOption.value = 'all';
    allOption.text = t('loggingFilterAllLevels');
    for (const level of LOG_LEVELS) {
      const option = levelSelect.createEl('option');
      option.value = level;
      option.text = LOG_LEVEL_LABELS[level];
    }
    levelSelect.value = this.levelFilter;
    levelSelect.addEventListener('change', () => {
      this.levelFilter = levelSelect.value === 'all' ? 'all' : (levelSelect.value as LogLevel);
      this.refreshLogs();
    });

    const sourceControl = controls.createDiv({ cls: 'superpower-inside-logs-control' });
    sourceControl.createSpan({ text: t('loggingFilterSource') });
    const sourceInput = sourceControl.createEl('input', {
      attr: { type: 'search', placeholder: t('loggingFilterSourcePlaceholder') },
    });
    sourceInput.value = this.sourceFilter;
    sourceInput.addEventListener('input', () => {
      this.sourceFilter = sourceInput.value;
      this.refreshLogs();
    });

    this.countEl = controls.createDiv({ cls: 'superpower-inside-logs-count' });
    this.entriesContainer = section.createDiv({ cls: 'superpower-inside-logs-list' });
  }

  private refresh(): void {
    const snapshotText = this.plugin.getAgentDiagnosticsSnapshotText();
    const snapshot = this.parseSnapshot(snapshotText);
    const jsonPath = snapshot?.diagnosticFile.path ?? this.plugin.getAgentDiagnosticsFilePath();
    const eventLogPath =
      snapshot?.diagnosticFile.eventLogPath ?? this.plugin.getAgentDiagnosticsEventLogPath();
    this.statusEl?.setText(
      `Enabled. JSON: ${jsonPath}; events: ${eventLogPath}`,
    );
    this.renderDiagnosis(snapshot);
    this.snapshotEl?.setText(snapshotText);
    this.refreshLogs();
  }

  private parseSnapshot(text: string): AgentDiagnosticsSnapshot | null {
    try {
      const value: unknown = JSON.parse(text);
      return isAgentDiagnosticsSnapshot(value) ? value : null;
    } catch {
      return null;
    }
  }

  private renderDiagnosis(snapshot: AgentDiagnosticsSnapshot | null): void {
    if (!this.diagnosisEl) return;
    this.diagnosisEl.empty();
    if (!snapshot) {
      this.diagnosisEl.createDiv({
        cls: 'superpower-inside-agent-diagnostics-diagnosis-summary',
        text: 'Diagnostics snapshot is not readable yet. Write a snapshot or reopen Obsidian.',
      });
      return;
    }

    const diagnosis = snapshot.diagnosis;
    const header = this.diagnosisEl.createDiv({
      cls: 'superpower-inside-agent-diagnostics-diagnosis-header',
    });
    header.createSpan({
      cls: `superpower-inside-agent-diagnostics-diagnosis-badge superpower-inside-agent-diagnostics-diagnosis-badge--${diagnosis.status}`,
      text: diagnosis.status,
    });
    const title = header.createDiv({ cls: 'superpower-inside-agent-diagnostics-diagnosis-title' });
    title.createDiv({
      cls: 'superpower-inside-agent-diagnostics-diagnosis-heading',
      text: 'Current diagnosis',
    });
    title.createDiv({
      cls: 'superpower-inside-agent-diagnostics-diagnosis-summary',
      text: diagnosis.summary,
    });

    const details = this.diagnosisEl.createDiv({
      cls: 'superpower-inside-agent-diagnostics-diagnosis-grid',
    });
    this.renderDiagnosisRow(details, 'Likely cause', diagnosis.suspectedCause ?? 'None visible');
    this.renderDiagnosisRow(
      details,
      'Last operation',
      this.formatActiveOperation(diagnosis.lastActiveOperation, diagnosis.status),
    );
    this.renderDiagnosisRow(details, 'JSON snapshot', snapshot.diagnosticFile.path);
    this.renderDiagnosisRow(details, 'Event log', snapshot.diagnosticFile.eventLogPath);
    this.renderDiagnosisRow(details, 'Safe-mode flag', snapshot.diagnosticFile.safeModeFlagPath);

    this.renderRecommendedActions(this.diagnosisEl, diagnosis.recommendedActions);
  }

  private renderDiagnosisRow(containerEl: HTMLElement, label: string, value: string): void {
    const labelEl = containerEl.createDiv({
      cls: 'superpower-inside-agent-diagnostics-diagnosis-label',
      text: label,
    });
    labelEl.setAttr('aria-label', label);
    containerEl.createDiv({
      cls: 'superpower-inside-agent-diagnostics-diagnosis-value',
      text: value,
    });
  }

  private renderRecommendedActions(
    containerEl: HTMLElement,
    actions: readonly AgentDiagnosticsRecommendedActionSnapshot[],
  ): void {
    const section = containerEl.createDiv({
      cls: 'superpower-inside-agent-diagnostics-diagnosis-actions-panel',
    });
    const header = section.createDiv({
      cls: 'superpower-inside-agent-diagnostics-diagnosis-actions-header',
    });
    header.createDiv({
      cls: 'superpower-inside-agent-diagnostics-diagnosis-actions-title',
      text: 'Recovery',
    });
    const safeModeButton = header.createEl('button', {
      attr: { type: 'button' },
      text: 'Enable safe mode',
    });
    safeModeButton.addEventListener('click', () => {
      void this.enableSafeMode();
    });

    const actionList = section.createDiv({
      cls: 'superpower-inside-agent-diagnostics-diagnosis-actions-list',
    });
    for (const action of actions.slice(0, 3)) {
      const item = actionList.createDiv({
        cls: 'superpower-inside-agent-diagnostics-diagnosis-action',
      });
      item.createDiv({
        cls: 'superpower-inside-agent-diagnostics-diagnosis-action-label',
        text: action.label,
      });
      item.createDiv({
        cls: 'superpower-inside-agent-diagnostics-diagnosis-action-detail',
        text: action.detail,
      });
    }
  }

  private formatActiveOperation(
    operation: AgentDiagnosticsActiveOperationState | null,
    status: AgentDiagnosticsSnapshot['diagnosis']['status'],
  ): string {
    if (!operation) return 'None visible';
    const label = operation.detail ? `${operation.phase}:${operation.detail}` : operation.phase;
    if (status === 'unclean-shutdown') {
      return `${label} (previous session, last seen ${this.formatTimestamp(operation.lastUpdatedAt)})`;
    }
    const activeSeconds = Math.max(0, Math.round((Date.now() - operation.startedAt) / 1000));
    return `${label} (${activeSeconds}s active)`;
  }

  private formatTimestamp(timestamp: number): string {
    return new Date(timestamp).toLocaleTimeString(undefined, {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  private refreshLogs(): void {
    if (!this.entriesContainer) return;
    const entries = this.getVisibleEntries();
    this.entriesContainer.empty();
    this.countEl?.setText(t('loggingVisibleCount', { count: entries.length }));

    if (entries.length === 0) {
      this.entriesContainer.createDiv({
        cls: 'superpower-inside-logs-empty',
        text: t('loggingEmpty'),
      });
      return;
    }

    for (const entry of [...entries].reverse()) {
      this.renderEntry(this.entriesContainer, entry);
    }
  }

  private getVisibleEntries(): LogEntry[] {
    const sourceFilter = this.sourceFilter.trim().toLowerCase();
    return this.plugin.logger.getEntries().filter((entry) => {
      if (this.levelFilter !== 'all') {
        const selectedIndex = LOG_LEVELS.indexOf(this.levelFilter);
        const entryIndex = LOG_LEVELS.indexOf(entry.level);
        if (entryIndex < selectedIndex) return false;
      }
      return !sourceFilter || entry.source.toLowerCase().includes(sourceFilter);
    });
  }

  private async updateMinLevel(level: LogLevel): Promise<void> {
    this.plugin.settings.logging.minLevel = level;
    await this.persistLoggerConfig();
  }

  private async updateMirrorToConsole(value: boolean): Promise<void> {
    this.plugin.settings.logging.mirrorToConsole = value;
    await this.persistLoggerConfig();
  }

  private async updateMaxEntries(value: string): Promise<void> {
    const num = Number.parseInt(value, 10);
    if (Number.isNaN(num)) return;
    this.plugin.settings.logging.maxEntries = Math.max(100, Math.min(10000, num));
    await this.persistLoggerConfig();
  }

  private async persistLoggerConfig(): Promise<void> {
    this.plugin.logger.configure(this.plugin.settings.logging);
    await this.plugin.saveSettingsLight();
    this.refresh();
  }

  private renderEntry(containerEl: HTMLElement, entry: LogEntry): void {
    const item = containerEl.createDiv({
      cls: `superpower-inside-log-entry superpower-inside-log-entry--${entry.level}`,
    });
    const meta = item.createDiv({ cls: 'superpower-inside-log-entry-meta' });
    meta.createSpan({
      cls: `superpower-inside-log-level superpower-inside-log-level--${entry.level}`,
      text: LOG_LEVEL_LABELS[entry.level],
    });
    meta.createSpan({ cls: 'superpower-inside-log-time', text: this.formatTime(entry) });
    meta.createSpan({ cls: 'superpower-inside-log-source', text: entry.source });
    item.createDiv({ cls: 'superpower-inside-log-message', text: entry.message });

    const detailText = this.formatDetail(entry);
    if (detailText) {
      item.createEl('pre', {
        cls: 'superpower-inside-log-detail',
        text: detailText,
      });
    }
  }

  private formatTime(entry: LogEntry): string {
    return new Date(entry.timestamp).toLocaleTimeString(undefined, {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  private formatDetail(entry: LogEntry): string {
    const parts: string[] = [];
    if (entry.data !== undefined) {
      parts.push(this.stringifyValue(entry.data));
    }
    if (entry.error) {
      parts.push(entry.error);
    }
    return parts.join('\n');
  }

  private stringifyValue(value: unknown): string {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  private async copyVisibleLogs(): Promise<void> {
    const text = this.getVisibleEntries()
      .map((entry) => {
        const detail = this.formatDetail(entry);
        const line = `${new Date(entry.timestamp).toISOString()} ${LOG_LEVEL_LABELS[entry.level]} [${entry.source}] ${entry.message}`;
        return detail ? `${line}\n${detail}` : line;
      })
      .join('\n\n');
    try {
      await navigator.clipboard.writeText(text);
      new Notice(t('loggingCopied'));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      new Notice(t('loggingCopyFailed', { message }), 5000);
    }
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

  private async enableSafeMode(): Promise<void> {
    try {
      await this.plugin.enableAgentDiagnosticsSafeMode();
      this.refresh();
      new Notice(
        'Agent diagnostics safe mode enabled. Restart Obsidian to reopen with heavy indexing disabled.',
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      new Notice(`Failed to enable Agent diagnostics safe mode: ${message}`, 5000);
    }
  }
}

function isAgentDiagnosticsSnapshot(value: unknown): value is AgentDiagnosticsSnapshot {
  if (!isRecord(value)) return false;
  return (
    value.schemaVersion === 1 &&
    isRecord(value.diagnosis) &&
    isRecord(value.diagnosticFile)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
