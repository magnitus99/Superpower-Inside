import { afterEach, describe, expect, it } from 'vitest';
import { setLanguage, t } from '../i18n';
import type { RagIndexingProgressSummary } from './indexing-progress';
import { getRagIndexingProgressDisplay, renderRagIndexingProgress } from './indexing-progress-view';

const summary: RagIndexingProgressSummary = {
  phase: 'all',
  activity: 'indexing',
  servingAvailable: true,
  totalFilesKnown: true,
  completedFiles: 1200,
  totalFiles: 4000,
  processedFiles: 1500,
  failedFiles: 100,
  partialFiles: 200,
  skippedFiles: 0,
  stage: 'embedding',
  currentFileEmbeddedChunks: null,
  currentFileTotalChunks: null,
  etaRemainingMs: null,
  etaConfidence: 'calculating',
  pipelineRemainingMs: 120000,
  pipelineConfidence: 'medium',
  inferenceRemainingMs: 90000,
};
const display = (patch: Partial<RagIndexingProgressSummary> = {}) =>
  getRagIndexingProgressDisplay({ ...summary, ...patch });
const value = (key: string, patch: Partial<RagIndexingProgressSummary> = {}) =>
  display(patch).rows.find((row) => row.key === key)?.value;
afterEach(() => setLanguage('ko'));

describe('공유 색인 표시 — DOM 없이 상태와 관측값을 포맷한다', () => {
  it.each(['ko', 'en'] as const)('언어 %s에서 serving과 미완료 범위를 함께 알린다', (lang) => {
    setLanguage(lang);
    expect(display()).toMatchObject({
      headline: t('ragSharedServing'),
      detail: t('ragSharedServingDetail'),
      tone: 'neutral',
      phase: t('ragSharedStageEmbedding'),
      etaNote: t('ragSharedPipelineScope'),
    });
    expect(value('completed')).toBe('1,200 / 4,000');
    expect(value('processed')).toBe('1,500');
    expect(value('skipped')).toBe('0');
    expect(value('overallEta')).toBe(t('ragIndexingProgressEtaCalculating'));
    expect(value('pipelineEta')).toBe(t('ragIndexingProgressEtaApprox', { eta: '2m' }));
  });
  it('총량 미확인과 관측되지 않은 값은 0으로 만들지 않는다', () => {
    const patch = {
      servingAvailable: false,
      completedFiles: 0,
      totalFiles: 0,
      totalFilesKnown: false,
      processedFiles: null,
      skippedFiles: undefined,
    };
    expect(display(patch).headline).toBe(t('ragSharedFirstIndex'));
    expect(display(patch).detail).toBe(t('ragSharedUnavailableDetail'));
    expect(value('completed', patch)).toBe(t('ragSharedUnknown'));
    expect(value('processed', patch)).toBe(t('ragSharedUnknown'));
    expect(value('skipped', patch)).toBe(t('ragSharedUnknown'));
    expect(value('completed', { ...patch, totalFilesKnown: true })).toBe('0 / 0');
    expect(display({ ...patch, totalFilesKnown: true }).headline).not.toBe(t('ragOverviewReady'));
  });
  it.each(['settling', 'failed', 'partial', 'cancelled', 'paused'] as const)(
    '%s는 숫자나 ETA로 완료를 주장하지 않는다',
    (activity) => {
      const current = display({ activity, etaRemainingMs: 0, etaConfidence: 'high' });
      expect(current.headline).not.toBe(t('ragOverviewReady'));
      expect(current.rows.find((row) => row.key === 'overallEta')?.value).not.toContain('0s');
      expect(current.rows.find((row) => row.key === 'pipelineEta')?.value).not.toContain('2m');
      expect(current.etaNote).toBeNull();
      if (activity === 'partial') expect(current.detail).toContain(t('ragSharedPartialDetail'));
      if (activity === 'settling') expect(current.headline).toBe(t('ragSharedSettling'));
    },
  );
  it('partial은 serving proof가 없어도 유효 부분의 검색 가능성을 부정하지 않는다', () => {
    const partial = display({ activity: 'partial', servingAvailable: false });
    expect(partial.detail).toBe(t('ragSharedPartialDetail'));
    expect(partial.detail).not.toContain(t('ragSharedUnavailableDetail'));
  });
  it('사용자 중단과 성능 보호 대기를 구별하며 unknown pause를 사용자 중단으로 단정하지 않는다', () => {
    expect(display({ activity: 'paused', pauseReason: 'user' }).headline).toBe(
      t('ragSharedStopped'),
    );
    expect(display({ activity: 'paused', pauseReason: 'performance' }).headline).toBe(
      t('ragPerformancePaused'),
    );
    expect(value('overallEta', { activity: 'paused', pauseReason: 'performance' })).toBe(
      t('ragPerformancePaused'),
    );
    expect(value('overallEta', { activity: 'paused', pauseReason: 'user' })).toBe(
      t('ragSharedStoppedValue'),
    );
    expect(display({ activity: 'paused', pauseReason: 'unknown' }).headline).toBe(
      t('chatReadinessIndexingPhasePaused'),
    );
  });
  it.each(['ko', 'en'] as const)('사용자 중단에만 자동 재개 없음과 설정 재개를 안내한다 (%s)', (language) => {
    setLanguage(language);
    const phrase = language === 'ko' ? '자동으로 다시 시작하지 않습니다.' : 'does not restart automatically';
    const stopped = display({ activity: 'paused', pauseReason: 'user' });
    expect(stopped.detail).toContain(phrase);
    expect(stopped.detail).toContain(language === 'ko' ? '설정' : 'settings');
    for (const pauseReason of ['performance', 'unknown'] as const) expect(display({ activity: 'paused', pauseReason }).detail).not.toContain(phrase);
    expect(display({ activity: 'cancelled', pauseReason: 'user' }).detail).not.toContain(phrase);
  });
  it.each([null, 0, -1, Infinity, NaN])(
    '유효하지 않은 pipeline ETA %s를 감춘다',
    (pipelineRemainingMs) => {
      expect(value('pipelineEta', { pipelineRemainingMs })).toBe(
        t('ragIndexingProgressEtaCalculating'),
      );
      expect(display({ pipelineRemainingMs }).etaNote).toBeNull();
    },
  );
  it.each(['low', 'calculating'] as const)(
    '%s 신뢰도 부분·전체 추정은 계산 중이다',
    (confidence) => {
      expect(value('pipelineEta', { pipelineConfidence: confidence })).toBe(
        t('ragIndexingProgressEtaCalculating'),
      );
      expect(value('overallEta', { etaRemainingMs: 120000, etaConfidence: confidence })).toBe(
        t('ragIndexingProgressEtaCalculating'),
      );
    },
  );
  it('원문·파일명·진단·벡터가 섞인 입력에서도 허용된 표시 필드만 읽는다', () => {
    const input = { ...summary, currentFile: 'Synthetic/HiddenSource.md', etaReason: 'synthetic-internal-diagnostic', sourceText: 'synthetic-private-source', vector: [0.125, 0.375] };
    const text = JSON.stringify(getRagIndexingProgressDisplay(input));
    expect(text).not.toContain(input.currentFile);
    expect(text).not.toContain(input.etaReason);
    expect(text).not.toContain(input.sourceText);
    expect(text).not.toContain(JSON.stringify(input.vector));
  });
  it('부분 추정과 물리 설명 성분을 전체 ETA로 합산하지 않는다', () => {
    expect(value('overallEta')).toBe(t('ragIndexingProgressEtaCalculating'));
    expect(value('overallEta', { etaRemainingMs: 300000, etaConfidence: 'high' })).toBe(
      t('ragIndexingProgressEtaApprox', { eta: '5m' }),
    );
    expect(value('failed', { failedFiles: null })).toBe(t('ragSharedUnknown'));
  });
  it('legacy에는 근거 없는 첫 색인·새 완료 원장을 만들지 않고 기존 단계 의미를 유지한다', () => {
    const legacy = {
      phase: 'paused',
      completedFiles: 0,
      totalFiles: 0,
      currentFileEmbeddedChunks: null,
      currentFileTotalChunks: null,
      etaRemainingMs: null,
    } as const;
    const current = getRagIndexingProgressDisplay(legacy);
    expect(current.headline).toBe(t('chatReadinessIndexingPhasePaused'));
    expect(current.rows.find((row) => row.key === 'processed')?.value).toBe(t('ragSharedUnknown'));
    expect(current.rows.find((row) => row.key === 'completed')?.value).toBe(t('ragSharedUnknown'));
  });
});

// Obsidian DOM API의 작은 대역. 실제 브라우저 포커스·레이아웃은 preview 계약에서 확인한다.
class Element {
  children: Element[] = [];
  className = '';
  textContent = '';
  writes = 0;
  attributes = new Map<string, string>();
  listeners = new Map<string, () => void>();
  ownerDocument: { activeElement: Element | null };
  constructor(
    public tagName = 'div',
    doc?: { activeElement: Element | null },
  ) {
    this.ownerDocument = doc ?? { activeElement: null };
  }
  createEl(tag: string, options?: { cls?: string; text?: string; attr?: Record<string, string> }) {
    const child = new Element(tag, this.ownerDocument);
    child.className = options?.cls ?? '';
    child.textContent = options?.text ?? '';
    for (const [key, value] of Object.entries(options?.attr ?? {})) child.setAttribute(key, value);
    this.children.push(child);
    return child;
  }
  createDiv(options?: { cls?: string; text?: string; attr?: Record<string, string> }) {
    return this.createEl('div', options);
  }
  createSpan(options?: { cls?: string; text?: string; attr?: Record<string, string> }) {
    return this.createEl('span', options);
  }
  querySelector(selector: string): Element | null {
    for (const child of this.children) {
      if (
        selector.startsWith('.')
          ? child.className.split(' ').includes(selector.slice(1))
          : child.tagName === selector
      )
        return child;
      const found = child.querySelector(selector);
      if (found) return found;
    }
    return null;
  }
  setText(text: string) {
    this.writes++;
    this.textContent = text;
  }
  setAttribute(key: string, value: string) {
    this.attributes.set(key, value);
  }
  getAttribute(key: string) {
    return this.attributes.get(key) ?? null;
  }
  toggleClass(cls: string, on: boolean) {
    this.className = [
      ...this.className.split(' ').filter((value) => value && value !== cls),
      ...(on ? [cls] : []),
    ].join(' ');
  }
  addEventListener(type: string, listener: () => void) {
    this.listeners.set(type, listener);
  }
  focus() {
    this.ownerDocument.activeElement = this;
  }
}

describe('공유 renderer DOM 갱신', () => {
  it('기본 접힘·native button·고정 dl 행을 만들고 포커스·open·동일 노드를 유지한다', () => {
    const container = new Element();
    const render = (patch: Partial<RagIndexingProgressSummary> = {}) =>
      renderRagIndexingProgress(container as unknown as HTMLElement, { ...summary, ...patch });
    render();
    const root = container.querySelector('.superpower-inside-indexing-progress')!;
    const toggle = root.querySelector('button')!;
    const headline = root.querySelector('.superpower-inside-indexing-headline')!;
    const panel = root.querySelector('.superpower-inside-indexing-details')!;
    const completed = root.querySelector('.superpower-inside-indexing-value-completed')!;
    expect(toggle.getAttribute('type')).toBe('button');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-controls')).toBe(panel.getAttribute('id'));
    expect(headline.getAttribute('aria-live')).toBe('polite');
    expect(root.getAttribute('aria-live')).toBeNull();
    expect(panel.getAttribute('aria-live')).toBeNull();
    expect(root.querySelector('dl')).not.toBeNull();
    const writes = headline.writes;
    toggle.focus();
    toggle.listeners.get('click')!();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    render({ completedFiles: 1201 });
    expect(container.querySelector('button')).toBe(toggle);
    expect(container.ownerDocument.activeElement).toBe(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(root.querySelector('.superpower-inside-indexing-value-completed')).toBe(completed);
    expect(completed.textContent).toBe('1,201 / 4,000');
    expect(headline.writes).toBe(writes);
    const valueWrites = completed.writes;
    render({ completedFiles: 1201 });
    expect(completed.writes).toBe(valueWrites);
    render({ activity: 'partial' });
    expect(container.querySelector('button')).toBe(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(headline.textContent).toBe(t('ragSharedPartial'));
    toggle.listeners.get('click')!();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });
  it('여러 호스트의 controls ID를 분리한다', () => {
    const a = new Element();
    const b = new Element();
    renderRagIndexingProgress(a as unknown as HTMLElement, summary);
    renderRagIndexingProgress(b as unknown as HTMLElement, summary);
    expect(a.querySelector('button')?.getAttribute('aria-controls')).not.toBe(
      b.querySelector('button')?.getAttribute('aria-controls'),
    );
  });
});

describe('전체 준비 작업', () => {
  const work = { stage: 'opening-storage', unit: 'steps', processedUnits: 0, totalUnits: null, elapsedMs: 252000, lastProgressAgeMs: 12000, remainingMs: null, ratePerSecond: null, confidence: 'calculating', etaReason: 'unknown-total' } as const;
  it.each(['ko', 'en'] as const)('모든 작업의 고정 번역과 unknown/zero/bytes/atomic/stall를 보존한다 (%s)', language => {
    setLanguage(language);
    const stages = ['opening-storage', 'restoring-corpus', 'restoring-keyword-snapshot', 'restoring-keyword-documents', 'loading-model', 'planning', 'preparing-source', 'lexical', 'embedding', 'saving-vectors', 'verifying', 'publishing', 'waiting', 'cleanup'] as const;
    const labels = stages.map(stage => display({ work: { ...work, stage } }).phase);
    expect(new Set(labels).size).toBe(stages.length);
    for (const [index, label] of labels.entries()) expect(label).not.toBe(stages[index]);
    expect(value('workCount', { work })).toBe(t('ragWorkUnknownTotal', { processed: '0', unit: t('ragWorkSteps') }));
    expect(value('workCount', { work: { ...work, unit: 'bytes', processedUnits: 8388608, totalUnits: 33554432 } })).toBe('8,388,608 / 33,554,432 bytes');
    expect(value('workTime', { work: { ...work, stage: 'loading-model' } })).toContain(t('ragWorkReasonAtomic'));
    expect(value('workTime', { work: { ...work, etaReason: 'stalled' } })).toContain(t('ragWorkReasonStalled'));
    expect(value('workTime', { work })).toContain('4m 12s');
    expect(value('workTime', { work })).toContain('12s');
    for (const stage of ['verifying', 'publishing', 'waiting'] as const) {
      const current = display({ activity: 'settling', work: { ...work, stage, remainingMs: 16000, confidence: 'medium' } });
      expect(current.headline).not.toBe(t('ragOverviewReady'));
      expect(current.rows.find(row => row.key === 'workTime')?.value).toContain('16s');
      expect(current.rows.find(row => row.key === 'overallEta')?.value).toBe(t('ragIndexingProgressEtaCalculating'));
    }
  });
  it('새 작업으로 바뀌어도 접힌 세 행과 button·focus를 유지하고 terminal ETA는 멈춘다', () => {
    const container = new Element();
    const render = (patch: Partial<RagIndexingProgressSummary>) => renderRagIndexingProgress(container as unknown as HTMLElement, { ...summary, ...patch });
    render({ work });
    const visible = container.querySelector('.superpower-inside-indexing-stage')!;
    expect(visible.children.length).toBe(3);
    const button = container.querySelector('button')!; button.focus();
    for (const stage of ['restoring-keyword-documents', 'loading-model', 'verifying', 'publishing', 'waiting'] as const) {
      render({ work: { ...work, stage } });
      expect(container.querySelector('.superpower-inside-indexing-stage')).toBe(visible);
      expect(container.querySelector('button')).toBe(button);
      expect(container.ownerDocument.activeElement).toBe(button);
      expect(button.getAttribute('aria-expanded')).toBe('false');
    }
    for (const activity of ['paused', 'failed', 'partial', 'cancelled'] as const) {
      expect(value('workTime', { activity, work: { ...work, remainingMs: 540000, confidence: 'low' } })).not.toContain('9m');
    }
  });
  it('복원 작업량과 저신뢰 단계 ETA를 상세 밖에 제공한다', () => {
    const current = display({ activity: 'preparing', work: { stage: 'restoring-keyword-documents', unit: 'documents', processedUnits: 41984, totalUnits: 135835, elapsedMs: 252000, lastProgressAgeMs: 1000, remainingMs: 540000, ratePerSecond: 166, confidence: 'low', etaReason: 'warming-up' } });
    expect(current.phase).toBe(t('ragWorkRestoreDocuments'));
    expect(current.rows.find(row => row.key === 'workCount')?.value).toContain('41,984 / 135,835');
    expect(current.rows.find(row => row.key === 'workTime')?.value).toContain('9m');
    expect(current.rows.find(row => row.key === 'workTime')?.value).toContain(t('ragWorkEarlyEstimate'));
  });
});
