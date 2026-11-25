// 실제 파일·모델·관측과 독립적인 화면 검수용 요약입니다.
export function createIndexingPreviewSummary(name) {
  if (
    ![
      'opening',
      'legacy-restore',
      'snapshot-bytes',
      'model-init',
      'verifying',
      'publication-waiting',
      'stalled',
      'serving',
      'unknown',
      'settling',
      'partial',
      'failed',
      'failed-missing',
      'restore-failed',
      'restore-history',
      'restore-required',
      'restore-progress',
      'user-paused',
      'performance-paused',
    ].includes(name)
  )
    return null;
  const summary = {
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
  const workStages = { opening: 'opening-storage', 'legacy-restore': 'restoring-keyword-documents', 'snapshot-bytes': 'restoring-keyword-snapshot', 'model-init': 'loading-model', verifying: 'verifying', 'publication-waiting': 'waiting', stalled: 'restoring-keyword-documents' };
  if (workStages[name]) {
    const work = { stage: workStages[name], unit: 'documents', processedUnits: 41984, totalUnits: 135835, elapsedMs: 252000, lastProgressAgeMs: 1000, remainingMs: 540000, ratePerSecond: 166, confidence: 'low', etaReason: 'observed-rate' };
    if (name === 'opening' || name === 'model-init' || name === 'publication-waiting') Object.assign(work, { unit: 'steps', processedUnits: null, totalUnits: null, remainingMs: null, ratePerSecond: null, confidence: 'calculating', etaReason: 'unknown-total' });
    if (name === 'snapshot-bytes') Object.assign(work, { unit: 'bytes', processedUnits: 8388608, totalUnits: 33554432 });
    if (name === 'verifying') Object.assign(work, { unit: 'files', processedUnits: 2400, totalUnits: 4000, remainingMs: 16000, confidence: 'medium' });
    if (name === 'stalled') Object.assign(work, { remainingMs: null, ratePerSecond: null, lastProgressAgeMs: 90000, confidence: 'calculating', etaReason: 'stalled' });
    return { ...summary, phase: 'preparing', activity: 'preparing', servingAvailable: false, totalFilesKnown: false, completedFiles: 0, totalFiles: 0, processedFiles: null, failedFiles: null, partialFiles: null, skippedFiles: null, pipelineRemainingMs: null, pipelineConfidence: 'calculating', work };
  }
  if (name === 'unknown')
    return {
      ...summary,
      phase: 'preparing',
      activity: 'preparing',
      stage: 'preparing',
      servingAvailable: false,
      totalFilesKnown: false,
      completedFiles: 0,
      totalFiles: 0,
      processedFiles: null,
      failedFiles: null,
      partialFiles: null,
      skippedFiles: null,
      pipelineRemainingMs: null,
      pipelineConfidence: 'calculating',
      inferenceRemainingMs: null,
    };
  if (name === 'settling')
    return {
      ...summary,
      activity: 'settling',
      stage: 'committing',
      completedFiles: 4000,
      processedFiles: 4000,
      failedFiles: 0,
      partialFiles: 0,
    };
  if (name.startsWith('restore-')) {
    const base = { ...summary, totalFilesKnown: false, completedFiles: 0, totalFiles: 0, processedFiles: null, failedFiles: null, partialFiles: null, skippedFiles: null, pipelineRemainingMs: null, etaRemainingMs: null };
    if (name === 'restore-progress') return { ...base, activity: 'preparing', restoring: true, servingAvailable: false,
      work: { stage: 'restoring-keyword-documents', unit: 'documents', processedUnits: 128, totalUnits: 4096, elapsedMs: 1000, lastProgressAgeMs: 100, remainingMs: null, ratePerSecond: null, confidence: 'calculating', etaReason: 'insufficient-samples' } };
    if (name === 'restore-required') return { ...base, activity: 'partial', updateRequired: true };
    return { ...base, activity: 'failed', updateRequired: true, failure: name === 'restore-failed'
      ? { source: 'restore', error: 'SyntheticError: restoration interrupted', stage: 'restoring-keyword-documents' }
      : { source: 'saved', error: null, stage: null } };
  }
  if (name === 'failed' || name === 'failed-missing')
    return { ...summary, activity: 'failed', stage: 'settled', lastInitError: name === 'failed' ? 'SyntheticError: PREVIEW_STORAGE_CHANNEL_CLOSED — The storage connection closed before this operation could finish.' : null, lastInitStage: name === 'failed' ? 'opening-storage' : null };
  if (name === 'partial')
    return { ...summary, activity: name, stage: 'settled' };
  if (name.endsWith('-paused'))
    return {
      ...summary,
      phase: 'paused',
      activity: 'paused',
      pauseReason: name === 'user-paused' ? 'user' : 'performance',
    };
  return summary;
}

/** 실제 ChatView/SearchView가 만든 widget DOM을 검수합니다. 렌더러 대역을 만들지 않습니다. */
export async function checkIndexingProgress({ container, summary, update, expanded }) {
  const checks = [];
  const check = (condition, label) => {
    if (!condition) throw Error(`공유 진행 검수 실패: ${label}`);
    checks.push(label);
  };
  const root = container.querySelector('.superpower-inside-indexing-progress');
  check(!!root, '실제 view의 공통 renderer');
  const settingsRow = root.closest('.superpower-inside-rag-overview-row');
  check(!settingsRow || root.getBoundingClientRect().width >= settingsRow.getBoundingClientRect().width - 2, '설정 진행 영역은 행 전체 폭 사용');
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const rgba = (color) => {
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = color;
    context.fillRect(0, 0, 1, 1);
    return [...context.getImageData(0, 0, 1, 1).data];
  };
  const luminance = (color) => rgba(color).slice(0, 3).map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  for (const element of root.querySelectorAll('.superpower-inside-indexing-headline, .superpower-inside-indexing-detail, dt, dd, .superpower-inside-indexing-scope, button')) {
    if (!element.getClientRects().length) continue;
    let parent = element;
    while (parent.parentElement && rgba(getComputedStyle(parent).backgroundColor)[3] === 0) parent = parent.parentElement;
    const foreground = luminance(getComputedStyle(element).color);
    const background = luminance(getComputedStyle(parent).backgroundColor);
    const ratio = (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    check(ratio >= 4.5, `진행 텍스트 대비 4.5:1 (${element.className}: ${ratio.toFixed(2)})`);
  }
  const button = root.querySelector('button');
  const panel = root.querySelector('.superpower-inside-indexing-details');
  const headline = root.querySelector('.superpower-inside-indexing-headline');
  const values = [...root.querySelectorAll('dd')];
  check(values.length === 12, '고정 실패 진단·단계·원장·부분/전체 ETA 행');
  check(
    button.getAttribute('aria-expanded') === 'false' && getComputedStyle(panel).display === 'none',
    '기본 접힘',
  );
  check(
    button.getAttribute('type') === 'button' && button.getAttribute('aria-controls') === panel.id,
    'native 제어와 panel 연결',
  );
  check(
    headline.getAttribute('aria-live') === 'polite' &&
      root.querySelectorAll('[aria-live]').length === 1,
    '헤드라인만 live',
  );
  const visibleRows = root.querySelector('.superpower-inside-indexing-stage');
  check(visibleRows.querySelectorAll('dd').length === 5 && !visibleRows.closest('.superpower-inside-indexing-details'), '접혀도 실패 진단·현재 작업·작업량·시간 표시');
  const reason = root.querySelector('.superpower-inside-indexing-value-failureReason');
  const failureStage = root.querySelector('.superpower-inside-indexing-value-failureStage');
  check(!!reason && !!failureStage && !reason.closest('.superpower-inside-indexing-details'), '실패 이유와 단계는 접힘 영역 밖');
  check((reason.getClientRects().length > 0) === (summary.activity === 'failed'), '실패에서만 사유 표시');
  if (summary.activity === 'failed') {
    check(reason.textContent.trim().length > 0 && failureStage.textContent.trim().length > 0, '사유와 단계 또는 미기록 대체 문구');
    const error = summary.failure ? summary.failure.error : summary.lastInitError;
    if (error) check(reason.textContent === error, '임의 합성 오류 사유 전달');
  }
  check(!root.closest('[aria-live]'), '숫자까지 감싸는 live region 없음');
  button.focus();
  button.click();
  check(
    button.getAttribute('aria-expanded') === 'true' && getComputedStyle(panel).display !== 'none',
    '실제 펼침',
  );
  if (summary.updateRequired && (summary.activity === 'failed' || summary.activity === 'partial')) {
    for (const key of ['completed', 'processed', 'failed', 'partial', 'skipped']) {
      const value = root.querySelector(`.superpower-inside-indexing-value-${key}`).textContent;
      check(['기록되지 않음', 'Not recorded'].includes(value), `비활성 상세 ${key} 미기록`);
    }
    for (const key of ['pipelineEta', 'overallEta']) {
      const value = root.querySelector(`.superpower-inside-indexing-value-${key}`).textContent;
      check(['해당 없음', 'Not applicable'].includes(value), `비활성 상세 ${key} 해당 없음`);
    }
  }
  const before = headline.textContent;
  const mutations = [];
  const observer = new MutationObserver((records) => mutations.push(...records));
  observer.observe(headline, { childList: true, characterData: true, subtree: true });
  const changed = {
    ...summary,
    ...(summary.work ? { work: { ...summary.work, processedUnits: (summary.work.processedUnits ?? 0) + 128 } } : {}),
    completedFiles: Math.min(summary.completedFiles + 1, summary.totalFiles),
  };
  update(changed);
  await Promise.resolve();
  check(
    root.querySelector('button') === button && document.activeElement === button,
    '수치 갱신 후 동일 button과 실제 focus',
  );
  check(button.getAttribute('aria-expanded') === 'true', '갱신 후 open 유지');
  check(
    values.every((value, index) => value === root.querySelectorAll('dd')[index]),
    '동일 dl 행 유지',
  );
  check(
    headline.textContent === before && mutations.length === 0,
    '수치 갱신 시 헤드라인 재낭독 없음',
  );
  observer.disconnect();
  update({ ...summary, activity: 'failed' });
  check(
    root.querySelector('button') === button &&
      document.activeElement === button &&
      button.getAttribute('aria-expanded') === 'true',
    'terminal 전환에도 focus와 open 유지',
  );
  update(summary);
  for (const element of root.querySelectorAll('dt, dd, button')) {
    check(element.scrollWidth <= element.clientWidth + 1, '좁은 폭 라벨·값 줄바꿈');
  }
  check(container.scrollWidth <= container.clientWidth + 1, '패널 가로 넘침 없음');
  if (!expanded) button.click();
  check(button.getAttribute('aria-expanded') === String(expanded), '최종 접힘/펼침 상태');
  return checks;
}
