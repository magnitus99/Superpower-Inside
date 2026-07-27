import { t } from '../i18n';
import { isDomInstance } from '../utils/dom';
import type { ToolCallRecord } from './types';
import { planNativeVaultToolRequestRust } from '../rag/rust-core';

export interface ToolCallPlaceholderView {
  className: string;
  iconText: string;
  nameText: string;
  statusClassName: string;
}

export interface ToolCallRowView {
  rowId: string;
  className: string;
  iconText: string;
  nameText: string;
  status: ToolCallRecord['status'];
  statusClassName: string;
  showRunningDots: boolean;
  statusText: string;
  approvalRequired: boolean;
  safetyDecision: 'approval-required' | 'auto-approved' | 'blocked' | 'completed';
  availableActions: string[];
  argumentsPreview: string;
  result?: string;
  resultSummary?: string;
  resultApplied: boolean;
}

export interface ToolCallPanelView {
  labelText: string;
  placeholder?: ToolCallPlaceholderView;
  rows: ToolCallRowView[];
}

export interface ToolCallPanelHandlers {
  approveToolCall(messageId: string, toolCallId: string): void | Promise<void>;
  renderMarkdown(container: HTMLElement, content: string): void | Promise<void>;
}

export function createToolCallPanelView(
  toolCalls: readonly ToolCallRecord[],
  showPlaceholder: boolean,
): ToolCallPanelView {
  return {
    labelText: `🔧 ${t('toolCallLabel')}`,
    placeholder:
      toolCalls.length === 0 && showPlaceholder
        ? {
            className: 'superpower-inside-tool-call placeholder',
            iconText: '🔧',
            nameText: t('mcpToolRunning'),
            statusClassName: 'superpower-inside-tool-call-status running',
          }
        : undefined,
    rows: toolCalls.map(createToolCallRowView),
  };
}

export function createToolCallRowView(toolCall: ToolCallRecord): ToolCallRowView {
  const status = getToolCallStatusView(toolCall.status);
  return {
    rowId: `tool-call-${toolCall.id || toolCall.name}`,
    className: 'superpower-inside-tool-call',
    iconText: '🔧',
    nameText: getToolCallName(toolCall),
    status: toolCall.status,
    statusClassName: `superpower-inside-tool-call-status ${toolCall.status}`,
    showRunningDots: status.showRunningDots,
    statusText: status.text,
    approvalRequired: toolCall.status === 'running' && toolCall.approved === false,
    safetyDecision: getSafetyDecision(toolCall),
    availableActions: getAvailableActions(toolCall),
    argumentsPreview: toolCall.arguments.trim(),
    result: toolCall.result,
    resultSummary: summarizeToolResult(
      toolCall.resultSummary ?? toolCall.normalizedResult ?? toolCall.result,
    ),
    resultApplied:
      toolCall.status === 'success' && Boolean(toolCall.normalizedResult || toolCall.resultSummary),
  };
}

function getToolCallName(toolCall: ToolCallRecord): string {
  if (toolCall.executionKind !== 'native') return toolCall.name || t('toolCallLabel');
  const plan = planNativeVaultToolRequestRust(toolCall.arguments);
  if (!plan?.ok) return toolCall.serverName ?? toolCall.name ?? t('toolCallLabel');
  const actionLabel = getNativeVaultActionLabel(plan.request.action);
  return `${toolCall.serverName ?? 'Superpower Inside'} · ${actionLabel}`;
}

function getNativeVaultActionLabel(action: 'search' | 'read' | 'list' | 'links' | 'stats'): string {
  switch (action) {
    case 'search':
      return t('nativeVaultActionSearch');
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
  showRunningDots: boolean;
  text: string;
} {
  if (status === 'running') {
    return { showRunningDots: true, text: '' };
  }
  if (status === 'success') {
    return { showRunningDots: false, text: '✓' };
  }
  return { showRunningDots: false, text: '✗' };
}

export class ToolCallPanel {
  constructor(private readonly handlers: ToolCallPanelHandlers) {}

  renderToolCallsSection(
    section: HTMLElement,
    toolCalls: ToolCallRecord[],
    showPlaceholder: boolean,
  ): void {
    const view = createToolCallPanelView(toolCalls, showPlaceholder);
    const existingLabel = section.querySelector('.superpower-inside-chat-tool-calls-label');
    if (!existingLabel) {
      section.createDiv({
        cls: 'superpower-inside-chat-tool-calls-label',
        text: view.labelText,
      });
    }

    if (view.placeholder) {
      const existingPlaceholder = section.querySelector('.superpower-inside-tool-call.placeholder');
      if (!existingPlaceholder) {
        const row = section.createDiv({ cls: view.placeholder.className });
        row.createSpan({
          cls: 'superpower-inside-tool-call-icon',
          text: view.placeholder.iconText,
        });
        row.createSpan({
          cls: 'superpower-inside-tool-call-name',
          text: view.placeholder.nameText,
        });
        const statusBadge = row.createSpan({ cls: view.placeholder.statusClassName });
        this.renderRunningDots(statusBadge);
      }
      return;
    }

    section
      .querySelectorAll('.superpower-inside-tool-call.placeholder')
      .forEach((el) => el.remove());

    for (const [index, toolCall] of toolCalls.entries()) {
      const rowView = view.rows[index];
      if (!rowView) continue;
      let callRow = Array.from(section.querySelectorAll('.superpower-inside-tool-call')).find(
        (el): el is HTMLElement =>
          isDomInstance(el, HTMLElement) && el.getAttribute('data-tool-call-id') === rowView.rowId,
      );

      if (!callRow) {
        callRow = section.createDiv({ cls: rowView.className });
        callRow.setAttribute('data-tool-call-id', rowView.rowId);
        callRow.createSpan({ cls: 'superpower-inside-tool-call-icon', text: rowView.iconText });
        callRow.createSpan({
          cls: 'superpower-inside-tool-call-name',
          text: rowView.nameText,
        });
        const statusBadge = callRow.createSpan({ cls: rowView.statusClassName });
        this.renderToolCallStatus(statusBadge, rowView);
      } else {
        const statusBadge = callRow.querySelector('.superpower-inside-tool-call-status');
        if (isDomInstance(statusBadge, HTMLElement)) {
          statusBadge.className = rowView.statusClassName;
          this.renderToolCallStatus(statusBadge, rowView);
        }
      }

      let resultSummary = callRow.querySelector('.superpower-inside-tool-call-summary');
      if (rowView.resultSummary) {
        if (!isDomInstance(resultSummary, HTMLElement)) {
          resultSummary = callRow.createSpan({
            cls: 'superpower-inside-tool-call-summary',
          });
        }
        resultSummary.setText(rowView.resultSummary);
      } else if (isDomInstance(resultSummary, HTMLElement)) {
        resultSummary.remove();
      }

      const staleApproveBtn = callRow.querySelector('.superpower-inside-tool-call-approve');
      if (isDomInstance(staleApproveBtn, HTMLElement) && !rowView.approvalRequired) {
        staleApproveBtn.remove();
      }
      if (
        rowView.approvalRequired &&
        !callRow.querySelector('.superpower-inside-tool-call-approve')
      ) {
        const approveBtn = callRow.createEl('button', {
          cls: 'superpower-inside-tool-call-approve',
          text: t('toolApproveExecution'),
        });
        approveBtn.addEventListener('click', () => {
          const messageId = section
            .closest('.superpower-inside-chat-bubble-container')
            ?.getAttribute('data-message-id');
          if (messageId)
            void this.handlers.approveToolCall(messageId, toolCall.id || toolCall.name);
        });
      }

      const existingArgs = Array.from(
        section.querySelectorAll('.superpower-inside-tool-arguments'),
      ).find(
        (el): el is HTMLDetailsElement =>
          isDomInstance(el, HTMLDetailsElement) &&
          el.getAttribute('data-tool-call-id') === rowView.rowId,
      );
      const existingResult = Array.from(
        section.querySelectorAll('.superpower-inside-tool-result-details'),
      ).find(
        (el): el is HTMLDetailsElement =>
          isDomInstance(el, HTMLDetailsElement) &&
          el.getAttribute('data-tool-call-id') === rowView.rowId,
      );
      const argsOpen = existingArgs?.open ?? false;
      const resultOpen = existingResult?.open ?? false;
      existingArgs?.remove();
      existingResult?.remove();

      if (rowView.argumentsPreview) {
        const args = section.createEl('details', { cls: 'superpower-inside-tool-arguments' });
        args.setAttribute('data-tool-call-id', rowView.rowId);
        args.open = argsOpen;
        args.createEl('summary', { text: t('toolArgs') });
        args.createEl('pre', { text: rowView.argumentsPreview });
      }

      if (rowView.result) {
        const resultDetails = section.createEl('details', {
          cls: 'superpower-inside-tool-result-details',
        });
        resultDetails.setAttribute('data-tool-call-id', rowView.rowId);
        resultDetails.open = resultOpen;
        resultDetails.createEl('summary', { text: t('toolResult') });
        const resultArea = resultDetails.createDiv({ cls: 'superpower-inside-tool-result' });
        void this.handlers.renderMarkdown(resultArea, rowView.result);
      }
    }

    const currentIds = new Set(view.rows.map((row) => row.rowId));
    section.querySelectorAll('.superpower-inside-tool-call:not(.placeholder)').forEach((el) => {
      const elId = el.getAttribute('data-tool-call-id');
      if (elId && !currentIds.has(elId)) {
        el.remove();
      }
    });
    section.querySelectorAll('.superpower-inside-tool-arguments').forEach((el) => {
      const elId = el.getAttribute('data-tool-call-id');
      if (elId && !currentIds.has(elId)) {
        el.remove();
      }
    });
    section.querySelectorAll('.superpower-inside-tool-result-details').forEach((el) => {
      const elId = el.getAttribute('data-tool-call-id');
      if (elId && !currentIds.has(elId)) {
        el.remove();
      }
    });
  }

  private renderToolCallStatus(statusBadge: HTMLElement, rowView: ToolCallRowView): void {
    if (rowView.showRunningDots) {
      this.renderRunningDots(statusBadge);
    } else {
      statusBadge.setText(rowView.statusText);
    }
  }

  private renderRunningDots(container: HTMLElement): void {
    container.empty();
    const dots = container.createSpan({ cls: 'superpower-inside-tool-running-dots' });
    dots.createSpan({});
    dots.createSpan({});
    dots.createSpan({});
  }
}
