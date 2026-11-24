import { t } from '../i18n';
import { formatRagEtaDuration, type RagIndexingProgressSummary, type RagRuntimeWorkProgress } from './indexing-progress';

export interface RagIndexingProgressDisplay {
  headline: string;
  detail: string;
  tone: 'neutral' | 'warning' | 'danger';
  phase: string;
  rows: readonly { key: string; label: string; value: string }[];
  etaNote: string | null;
}

const numberFormat = new Intl.NumberFormat('en-US');

function count(value: number | null | undefined): string {
  return value !== null && value !== undefined && Number.isFinite(value) && value >= 0
    ? numberFormat.format(value)
    : t('ragSharedUnknown');
}

const workStages = {
  'opening-storage': 'ragWorkOpenStorage',
  'restoring-corpus': 'ragWorkRestoreCorpus',
  'restoring-keyword-snapshot': 'ragWorkRestoreSnapshot',
  'restoring-keyword-documents': 'ragWorkRestoreDocuments',
  'loading-model': 'ragWorkLoadModel',
  'planning': 'ragWorkPlanning',
  'preparing-source': 'ragWorkPrepareSource',
  'lexical': 'ragWorkLexical',
  'embedding': 'ragWorkEmbedding',
  'saving-vectors': 'ragWorkSaveVectors',
  'verifying': 'ragWorkVerify',
  'publishing': 'ragWorkPublish',
  'waiting': 'ragWorkWaiting',
  'cleanup': 'ragWorkCleanup',
} as const satisfies Record<RagRuntimeWorkProgress['stage'], Parameters<typeof t>[0]>;

const workUnits = { files: 'ragWorkFiles', documents: 'ragWorkDocuments', bytes: 'ragWorkBytes', steps: 'ragWorkSteps' } as const satisfies Record<RagRuntimeWorkProgress['unit'], Parameters<typeof t>[0]>;

function workCount(work: RagRuntimeWorkProgress): string {
  const values = { processed: count(work.processedUnits), total: count(work.totalUnits), unit: t(workUnits[work.unit]) };
  return t(work.totalUnits === null ? 'ragWorkUnknownTotal' : 'ragWorkKnownTotal', values);
}

function workTime(work: RagRuntimeWorkProgress, terminal: string | null): string {
  const elapsed = t('ragWorkElapsed', { elapsed: formatRagEtaDuration(work.elapsedMs) });
  const eta = work.remainingMs !== null && Number.isFinite(work.remainingMs) && work.remainingMs >= 0 && work.confidence !== 'calculating'
    ? t('ragWorkRemaining', { eta: t('ragIndexingProgressEtaApprox', { eta: formatRagEtaDuration(work.remainingMs) }) }) + (work.confidence === 'low' ? ' (' + t('ragWorkEarlyEstimate') + ')' : '')
    : t(work.etaReason === 'stalled' ? 'ragWorkReasonStalled' : work.stage === 'loading-model' ? 'ragWorkReasonAtomic' : work.totalUnits === null ? 'ragWorkReasonTotal' : work.totalUnits <= 1 ? 'ragWorkReasonAtomic' : 'ragWorkReasonSamples');
  const recent = work.lastProgressAgeMs === null ? '' : ' · ' + t('ragWorkRecent', { age: formatRagEtaDuration(work.lastProgressAgeMs) });
  return elapsed + ' · ' + (terminal ?? eta) + recent;
}

function stage(summary: RagIndexingProgressSummary): string {
  if (summary.work) return t(workStages[summary.work.stage]);
  switch (summary.stage) {
    case 'preparing':
      return t('ragSharedStagePreparing');
    case 'lexical':
      return t('ragSharedStageLexical');
    case 'embedding':
      return t('ragSharedStageEmbedding');
    case 'committing':
      return t('ragSharedStageCommitting');
    case 'settled':
      return t('ragSharedStageSettled');
  }
  switch (summary.phase) {
    case 'preparing':
      return t('chatReadinessIndexingPhasePreparing');
    case 'file':
      return t('chatReadinessIndexingPhaseFile');
    case 'pending':
      return t('chatReadinessIndexingPhasePending');
    case 'all':
      return t('chatReadinessIndexingPhaseAll');
    case 'paused':
      return t('chatReadinessIndexingPhasePaused');
    default:
      return t('chatReadinessIndexingPhaseIdle');
  }
}

function estimate(
  value: number | null | undefined,
  confidence: RagIndexingProgressSummary['etaConfidence'],
): string {
  return value !== null &&
    value !== undefined &&
    Number.isFinite(value) &&
    value > 0 &&
    (confidence === 'medium' || confidence === 'high')
    ? t('ragIndexingProgressEtaApprox', { eta: formatRagEtaDuration(value) })
    : t('ragIndexingProgressEtaCalculating');
}

/** 확인된 관측만 표시하며 부분 ETA에서 전체 ETA나 완료를 추론하지 않습니다. */
export function getRagIndexingProgressDisplay(
  summary: RagIndexingProgressSummary,
): RagIndexingProgressDisplay {
  const activity = summary.activity ?? (summary.phase === 'paused' ? 'paused' : 'indexing');
  const serving = summary.servingAvailable;
  let headline = t(
    serving === true
      ? 'ragSharedServing'
      : serving === false
        ? 'ragSharedFirstIndex'
        : 'chatReadinessRagIndexing',
  );
  let detail = t(
    serving === true
      ? 'ragSharedServingDetail'
      : serving === false
        ? 'ragSharedUnavailableDetail'
        : 'chatReadinessRagIndexingDetail',
  );
  if (!summary.work && summary.keywordRestore && (!summary.activity || summary.activity === 'preparing')) {
    const { processedDocuments, expectedDocuments } = summary.keywordRestore;
    const restore =
      expectedDocuments !== null && expectedDocuments > processedDocuments
        ? t('chatReadinessKeywordRestore', {
            completed: count(processedDocuments),
            total: count(expectedDocuments),
          })
        : t('chatReadinessKeywordRestoreCount', { completed: count(processedDocuments) });
    detail = `${detail} ${restore}`;
  }
  let tone: RagIndexingProgressDisplay['tone'] = 'neutral';
  let terminal: string | null = null;
  if (activity === 'settling') headline = t('ragSharedSettling');
  if (activity === 'failed') {
    headline = t('ragSharedFailed');
    tone = 'danger';
    terminal = t('ragSharedFailedValue');
  } else if (activity === 'partial') {
    headline = t('ragSharedPartial');
    tone = 'warning';
    terminal = t('ragSharedPartialValue');
    // 유효한 일부 자료도 이미 검색 가능할 수 있어 전부 미반영이라고 말하지 않습니다.
    detail =
      serving === true
        ? `${t('ragSharedPartialDetail')} ${t('ragSharedServingDetail')}`
        : t('ragSharedPartialDetail');
  } else if (activity === 'cancelled' || activity === 'paused') {
    headline = t(
      activity === 'cancelled' || summary.pauseReason === 'user'
        ? 'ragSharedStopped'
        : summary.pauseReason === 'performance'
          ? 'ragPerformancePaused'
          : 'chatReadinessIndexingPhasePaused',
    );
    tone = 'warning';
    terminal =
      activity === 'cancelled' || summary.pauseReason === 'user'
        ? t('ragSharedStoppedValue')
        : headline;
  }
  if (activity === 'paused' && summary.pauseReason === 'user') detail = `${detail} ${t('ragSharedStoppedDetail')}`;
  const active = activity === 'indexing' || activity === 'preparing';
  const calculating = t('ragIndexingProgressEtaCalculating');
  const pipelineEta = active
    ? estimate(summary.pipelineRemainingMs, summary.pipelineConfidence)
    : (terminal ?? calculating);
  const overallEta = active
    ? estimate(
        summary.etaRemainingMs,
        // legacy 요약의 ETA는 이미 host에서 신뢰도를 거른 값입니다.
        summary.etaConfidence ?? (summary.activity === undefined ? 'medium' : 'calculating'),
      )
    : (terminal ?? calculating);
  const totalKnown = summary.totalFilesKnown ?? summary.totalFiles > 0;
  const phase = !summary.work && activity === 'settling' ? t('ragSharedStageCommitting') : stage(summary);
  return {
    headline,
    detail,
    tone,
    phase,
    rows: [
      { key: 'stage', label: t(summary.work ? 'ragWorkStageLabel' : 'ragSharedStageLabel'), value: phase },
      { key: 'workCount', label: t('ragWorkCountLabel'), value: summary.work ? workCount(summary.work) : t('ragSharedUnknown') },
      { key: 'workTime', label: t('ragWorkTimeLabel'), value: summary.work ? workTime(summary.work, terminal) : (terminal ?? calculating) },
      {
        key: 'completed',
        label: t('ragSharedCompletedLabel'),
        value: totalKnown
          ? t('ragIndexingProgressFilesValue', {
              completed: count(summary.completedFiles),
              total: count(summary.totalFiles),
            })
          : t('ragSharedUnknown'),
      },
      {
        key: 'processed',
        label: t('ragSharedProcessedLabel'),
        value: count(summary.processedFiles),
      },
      { key: 'failed', label: t('ragSharedFailedLabel'), value: count(summary.failedFiles) },
      { key: 'partial', label: t('ragSharedPartialLabel'), value: count(summary.partialFiles) },
      { key: 'skipped', label: t('ragSharedSkippedLabel'), value: count(summary.skippedFiles) },
      { key: 'pipelineEta', label: t('ragSharedPipelineEtaLabel'), value: pipelineEta },
      { key: 'overallEta', label: t('ragSharedOverallEtaLabel'), value: overallEta },
    ],
    etaNote: active && pipelineEta !== calculating ? t('ragSharedPipelineScope') : null,
  };
}

let nextDetailsId = 0;
const hiddenClass = 'superpower-inside-hidden';

function updateText(element: HTMLElement | null, text: string): void {
  if (element && element.textContent !== text) element.setText(text);
}

/** 고정 DOM을 재사용해 숫자·상태 갱신 동안 펼침과 키보드 포커스를 보존합니다. */
export function renderRagIndexingProgress(
  container: HTMLElement,
  summary: RagIndexingProgressSummary,
): void {
  const display = getRagIndexingProgressDisplay(summary);
  let root = container.querySelector<HTMLElement>('.superpower-inside-indexing-progress');
  if (!root) {
    root = container.createDiv({ cls: 'superpower-inside-indexing-progress' });
    const header = root.createDiv({ cls: 'superpower-inside-indexing-header' });
    header.createSpan({
      cls: 'superpower-inside-indexing-headline',
      attr: { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' },
    });
    const button = header.createEl('button', {
      cls: 'superpower-inside-indexing-toggle',
      attr: { type: 'button', 'aria-expanded': 'false' },
    });
    root.createDiv({ cls: 'superpower-inside-indexing-detail' });
    const stageList = root.createEl('dl', { cls: 'superpower-inside-indexing-stage' });
    const panel = root.createDiv({
      cls: `superpower-inside-indexing-details ${hiddenClass}`,
      attr: { id: `superpower-inside-indexing-details-${++nextDetailsId}` },
    });
    const list = panel.createEl('dl', { cls: 'superpower-inside-indexing-facts' });
    for (const row of display.rows) {
      const item = (['stage', 'workCount', 'workTime'].includes(row.key) ? stageList : list).createDiv({
        cls: 'superpower-inside-indexing-row',
      });
      item.createEl('dt', { cls: `superpower-inside-indexing-label-${row.key}` });
      item.createEl('dd', { cls: `superpower-inside-indexing-value-${row.key}` });
    }
    panel.createDiv({ cls: 'superpower-inside-indexing-scope' });
    button.setAttribute('aria-controls', panel.getAttribute('id')!);
    button.addEventListener('click', () => {
      const open = button.getAttribute('aria-expanded') !== 'true';
      button.setAttribute('aria-expanded', String(open));
      panel.toggleClass(hiddenClass, !open);
      updateText(button, t(open ? 'ragSharedDetailsHide' : 'ragSharedDetailsShow'));
    });
  }
  root.className = `superpower-inside-indexing-progress tone-${display.tone}`;
  updateText(root.querySelector('.superpower-inside-indexing-headline'), display.headline);
  updateText(root.querySelector('.superpower-inside-indexing-detail'), display.detail);
  const button = root.querySelector<HTMLElement>('.superpower-inside-indexing-toggle');
  updateText(
    button,
    t(
      button?.getAttribute('aria-expanded') === 'true'
        ? 'ragSharedDetailsHide'
        : 'ragSharedDetailsShow',
    ),
  );
  for (const row of display.rows) {
    updateText(root.querySelector(`.superpower-inside-indexing-label-${row.key}`), row.label);
    updateText(root.querySelector(`.superpower-inside-indexing-value-${row.key}`), row.value);
  }
  const note = root.querySelector<HTMLElement>('.superpower-inside-indexing-scope');
  updateText(note, display.etaNote ?? '');
  note?.toggleClass(hiddenClass, display.etaNote === null);
}
