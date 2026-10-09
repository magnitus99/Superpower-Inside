import { t } from '../i18n';
import { isDomInstance } from '../utils/dom';
import type { ToolCallRecord } from './types';
import { planNativeVaultToolRequestRust } from '../rag/rust-core';
import { resolveNamedNativeVaultAction } from '../agent/native-vault-tool';

export interface ToolCallPlaceholderView {
  className: string;
  iconName: string;
  nameText: string;
  statusClassName: string;
  statusIconName: string;
  statusText: string;
}

export interface ToolCallRowView {
  rowId: string;
  className: string;
  iconName: string;
  nameText: string;
  status: ToolCallRecord['status'];
  statusClassName: string;
  statusIconName: string;
  statusText: string;
  approvalRequired: boolean;
  safetyDecision: 'approval-required' | 'auto-approved' | 'blocked' | 'completed';
  availableActions: string[];
  argumentsPreview: string;
  result?: string;
  resultSummary?: string;
  resultApplied: boolean;
  detailsLabel: string;
}

export interface ToolCallPanelView {
  labelText: string;
  iconName: string;
  placeholder?: ToolCallPlaceholderView;
  rows: ToolCallRowView[];
}

export interface ToolCallPanelHandlers {
  approveToolCall(messageId: string, toolCallId: string): void | Promise<void>;
  renderMarkdown(container: HTMLElement, content: string): void | Promise<void>;
  setIcon(element: HTMLElement, icon: string): void;
}

export function createToolCallPanelView(
  toolCalls: readonly ToolCallRecord[],
  showPlaceholder: boolean,
): ToolCallPanelView {
  const runningStatus = getToolCallStatusView('running');
  return {
    labelText: t('toolCallLabel'),
    iconName: 'wrench',
    placeholder:
      toolCalls.length === 0 && showPlaceholder
        ? {
            className: 'superpower-inside-tool-call-group placeholder',
            iconName: runningStatus.iconName,
            nameText: t('mcpToolRunning'),
            statusClassName: 'superpower-inside-tool-call-status running',
            statusIconName: runningStatus.iconName,
            statusText: runningStatus.text,
          }
        : undefined,
    rows: toolCalls.map(createToolCallRowView),
  };
}

export function createToolCallRowView(toolCall: ToolCallRecord): ToolCallRowView {
  const status = getToolCallStatusView(toolCall.status);
  const argumentsPreview = toolCall.arguments.trim();
  return {
    rowId: `tool-call-${toolCall.id || toolCall.name}`,
    className: 'superpower-inside-tool-call-group',
    iconName: 'wrench',
    nameText: getToolCallName(toolCall),
    status: toolCall.status,
    statusClassName: `superpower-inside-tool-call-status ${toolCall.status}`,
    statusIconName: status.iconName,
    statusText: status.text,
    approvalRequired: toolCall.status === 'running' && toolCall.approved === false,
    safetyDecision: getSafetyDecision(toolCall),
    availableActions: getAvailableActions(toolCall),
    argumentsPreview,
    result: toolCall.result,
    resultSummary: summarizeToolResult(
      toolCall.resultSummary ?? toolCall.normalizedResult ?? toolCall.result,
    ),
    resultApplied:
      toolCall.status === 'success' && Boolean(toolCall.normalizedResult || toolCall.resultSummary),
    detailsLabel:
      argumentsPreview && toolCall.result
        ? `${t('toolArgs')} · ${t('toolResult')}`
        : argumentsPreview
          ? t('toolArgs')
          : t('toolResult'),
  };
}

function getToolCallName(toolCall: ToolCallRecord): string {
  if (toolCall.executionKind !== 'native') {
    const actualToolName = toolCall.actualToolName?.trim();
    const serverName = toolCall.serverName?.trim();
    if (actualToolName && serverName) return `${serverName} · ${actualToolName}`;
    if (actualToolName) return actualToolName;
    return toolCall.name || t('toolCallLabel');
  }
  const namedAction = resolveNamedNativeVaultAction(toolCall.name);
  const legacyPlan =
    namedAction === null ? planNativeVaultToolRequestRust(toolCall.arguments) : null;
  const action = namedAction ?? (legacyPlan?.ok === true ? legacyPlan.request.action : null);
  if (action === null) return toolCall.serverName ?? toolCall.name ?? t('toolCallLabel');
  const actionLabel = getNativeVaultActionLabel(action);
  return `${toolCall.serverName ?? 'Superpower Inside'} · ${actionLabel}`;
}

function getNativeVaultActionLabel(
  action: 'search' | 'related' | 'read' | 'list' | 'links' | 'stats',
): string {
  switch (action) {
    case 'search':
      return t('nativeVaultActionSearch');
    case 'related':
      return t('nativeVaultActionRelated');
    case 'read':
      return t('nativeVaultActionRead');
    case 'list':
      return t('nativeVaultActionList');
    case 'links':
      return t('nativeVaultActionLinks');
    case 'stats':
      return t('nativeVaultActionStats');
  }
}

function getSafetyDecision(toolCall: ToolCallRecord): ToolCallRowView['safetyDecision'] {
  if (toolCall.approved === false) return 'approval-required';
  if (toolCall.status === 'error') return 'blocked';
  if (toolCall.status === 'success') return 'completed';
  return 'auto-approved';
}

function getAvailableActions(toolCall: ToolCallRecord): string[] {
  if (toolCall.approved === false) return ['approve-tool', 'copy-args'];
  if (toolCall.status === 'error') return ['retry-tool', 'copy-debug'];
  if (toolCall.status === 'success') return ['copy-result', 'regenerate-answer'];
  return ['copy-args'];
}

function summarizeToolResult(result: string | undefined): string | undefined {
  if (!result) return undefined;
  const collapsed = result.replace(/\s+/g, ' ').trim();
  return collapsed.length > 160 ? `${collapsed.slice(0, 157)}...` : collapsed;
}

function getToolCallStatusView(status: ToolCallRecord['status']): {
  iconName: string;
  text: string;
} {
  if (status === 'running') {
    return { iconName: 'loader-circle', text: t('overviewRunning') };
  }
  if (status === 'success') {
    return { iconName: 'check', text: t('chatStatusDone') };
  }
  return { iconName: 'circle-alert', text: t('chatStatusError') };
}

export class ToolCallPanel {
  constructor(private readonly handlers: ToolCallPanelHandlers) {}

  renderToolCallsSection(
    section: HTMLElement,
    toolCalls: ToolCallRecord[],
    showPlaceholder: boolean,
  ): void {
    const view = createToolCallPanelView(toolCalls, showPlaceholder);
    let label = section.querySelector('.superpower-inside-chat-tool-calls-label');
    if (!isDomInstance(label, HTMLElement)) {
      label = section.createDiv({ cls: 'superpower-inside-chat-tool-calls-label' });
      const icon = label.createSpan({
        cls: 'superpower-inside-chat-tool-calls-label-icon',
        attr: { 'aria-hidden': 'true' },
      });
      this.handlers.setIcon(icon, view.iconName);
      label.createSpan({
        cls: 'superpower-inside-chat-tool-calls-label-text',
        text: view.labelText,
      });
    }

    if (view.placeholder) {
      section
        .querySelectorAll('.superpower-inside-tool-call-group:not(.placeholder)')
        .forEach((element) => element.remove());
      const existingPlaceholder = section.querySelector(
        '.superpower-inside-tool-call-group.placeholder',
      );
      if (!isDomInstance(existingPlaceholder, HTMLElement)) {
        const group = section.createDiv({
          cls: view.placeholder.className,
          attr: {
            role: 'status',
            'aria-label': view.placeholder.nameText,
          },
        });
        const header = group.createDiv({ cls: 'superpower-inside-tool-call-header' });
        const icon = header.createSpan({
          cls: 'superpower-inside-tool-call-icon',
          attr: { 'aria-hidden': 'true' },
        });
        this.handlers.setIcon(icon, view.placeholder.iconName);
        header.createSpan({
          cls: 'superpower-inside-tool-call-name',
          text: view.placeholder.nameText,
        });
        const statusBadge = header.createSpan({ cls: view.placeholder.statusClassName });
        this.renderToolCallStatus(
          statusBadge,
          view.placeholder.statusIconName,
          view.placeholder.statusText,
        );
      }
      return;
    }

    section
      .querySelectorAll('.superpower-inside-tool-call-group.placeholder')
      .forEach((element) => element.remove());

    for (const [index, toolCall] of toolCalls.entries()) {
      const rowView = view.rows[index];
      if (!rowView) continue;
      let callGroup = Array.from(
        section.querySelectorAll('.superpower-inside-tool-call-group:not(.placeholder)'),
      ).find(
        (element): element is HTMLElement =>
          isDomInstance(element, HTMLElement) &&
          element.getAttribute('data-tool-call-id') === rowView.rowId,
      );

      if (!callGroup) {
        callGroup = section.createDiv({ cls: rowView.className });
        callGroup.setAttribute('data-tool-call-id', rowView.rowId);
        callGroup.setAttribute('role', 'group');
        callGroup.setAttribute('aria-label', rowView.nameText);
        const header = callGroup.createDiv({ cls: 'superpower-inside-tool-call-header' });
        const icon = header.createSpan({
          cls: 'superpower-inside-tool-call-icon',
          attr: { 'aria-hidden': 'true' },
        });
        this.handlers.setIcon(icon, rowView.iconName);
        header.createSpan({
          cls: 'superpower-inside-tool-call-name',
          text: rowView.nameText,
        });
        header.createSpan({ cls: rowView.statusClassName });
        const summary = callGroup.createSpan({ cls: 'superpower-inside-tool-call-summary' });
        summary.hidden = true;
      } else {
        callGroup.setAttribute('aria-label', rowView.nameText);
        const name = callGroup.querySelector('.superpower-inside-tool-call-name');
        if (isDomInstance(name, HTMLElement)) {
          name.setText(rowView.nameText);
        }
      }

      const statusBadge = callGroup.querySelector('.superpower-inside-tool-call-status');
      if (isDomInstance(statusBadge, HTMLElement)) {
        statusBadge.className = rowView.statusClassName;
        this.renderToolCallStatus(statusBadge, rowView.statusIconName, rowView.statusText);
      }

      const resultSummary = callGroup.querySelector('.superpower-inside-tool-call-summary');
      if (isDomInstance(resultSummary, HTMLElement)) {
        resultSummary.hidden = !rowView.resultSummary;
        resultSummary.setText(rowView.resultSummary ?? '');
      }

      const staleApproveBtn = callGroup.querySelector('.superpower-inside-tool-call-approve');
      if (isDomInstance(staleApproveBtn, HTMLElement) && !rowView.approvalRequired) {
        staleApproveBtn.remove();
      }
      if (
        rowView.approvalRequired &&
        !callGroup.querySelector('.superpower-inside-tool-call-approve')
      ) {
        const approveBtn = callGroup.createEl('button', {
          cls: 'superpower-inside-tool-call-approve',
          text: t('toolApproveExecution'),
        });
        approveBtn.setAttribute('type', 'button');
        approveBtn.setAttribute('aria-label', t('toolApproveExecution'));
        const details = callGroup.querySelector('.superpower-inside-tool-call-details');
        if (details) callGroup.insertBefore(approveBtn, details);
        approveBtn.addEventListener('click', () => {
          const messageId = section
            .closest('.superpower-inside-chat-bubble-container')
            ?.getAttribute('data-message-id');
          if (messageId) void this.handlers.approveToolCall(messageId, toolCall.id);
        });
      }

      const existingDetails = callGroup.querySelector('.superpower-inside-tool-call-details');
      const detailsOpen =
        isDomInstance(existingDetails, HTMLDetailsElement) && existingDetails.open;
      existingDetails?.remove();

      if (rowView.argumentsPreview || rowView.result) {
        const details = callGroup.createEl('details', {
          cls: 'superpower-inside-tool-call-details',
        });
        details.open = detailsOpen;
        const detailsContentId = createToolCallDetailsContentId(rowView.rowId);
        const detailsSummary = details.createEl('summary', {
          cls: 'superpower-inside-tool-call-details-summary',
        });
        detailsSummary.setAttribute('aria-label', rowView.detailsLabel);
        detailsSummary.setAttribute('aria-expanded', String(details.open));
        detailsSummary.setAttribute('aria-controls', detailsContentId);
        const detailsIcon = detailsSummary.createSpan({
          cls: 'superpower-inside-tool-call-details-icon',
          attr: { 'aria-hidden': 'true' },
        });
        this.handlers.setIcon(detailsIcon, details.open ? 'chevron-down' : 'chevron-right');
        detailsSummary.createSpan({
          cls: 'superpower-inside-tool-call-details-label',
          text: rowView.detailsLabel,
        });
        const detailsContent = details.createDiv({
          cls: 'superpower-inside-tool-call-details-content',
          attr: { id: detailsContentId },
        });
        details.addEventListener('toggle', () => {
          detailsSummary.setAttribute('aria-expanded', String(details.open));
          this.handlers.setIcon(detailsIcon, details.open ? 'chevron-down' : 'chevron-right');
        });

        if (rowView.argumentsPreview) {
          const argumentsSection = detailsContent.createDiv({
            cls: 'superpower-inside-tool-arguments',
          });
          argumentsSection.createSpan({
            cls: 'superpower-inside-tool-call-detail-label',
            text: t('toolArgs'),
          });
          argumentsSection.createEl('pre', { text: rowView.argumentsPreview });
        }

        if (rowView.result) {
          const resultSection = detailsContent.createDiv({
            cls: 'superpower-inside-tool-result-details',
          });
          resultSection.createSpan({
            cls: 'superpower-inside-tool-call-detail-label',
            text: t('toolResult'),
          });
          const resultArea = resultSection.createDiv({
            cls: 'superpower-inside-tool-result',
          });
          void this.handlers.renderMarkdown(resultArea, rowView.result);
        }
      }
    }

    const currentIds = new Set(view.rows.map((row) => row.rowId));
    section
      .querySelectorAll('.superpower-inside-tool-call-group:not(.placeholder)')
      .forEach((element) => {
        const elementId = element.getAttribute('data-tool-call-id');
        if (elementId && !currentIds.has(elementId)) {
          element.remove();
        }
      });
  }

  private renderToolCallStatus(
    statusBadge: HTMLElement,
    iconName: string,
    statusText: string,
  ): void {
    statusBadge.empty();
    statusBadge.setAttribute('role', 'status');
    statusBadge.setAttribute('aria-live', 'polite');
    statusBadge.setAttribute('aria-label', statusText);
    const icon = statusBadge.createSpan({
      cls: 'superpower-inside-tool-call-status-icon',
      attr: { 'aria-hidden': 'true' },
    });
    this.handlers.setIcon(icon, iconName);
    statusBadge.createSpan({
      cls: 'superpower-inside-tool-call-status-text',
      text: statusText,
    });
  }
}

function createToolCallDetailsContentId(rowId: string): string {
  const safeRowId = rowId.replace(/[^a-zA-Z0-9_-]/g, '-');
  return `${safeRowId}-details`;
}
