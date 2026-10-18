import { setIcon } from 'obsidian';
import { t, type I18nKeys } from '../i18n';
import { isDomInstance } from '../utils/dom';
import type { RetrievalProviderDiagnostic } from '../rag/retrieval-pipeline';
import { createCitationCardView } from './source-panel';
import type { ChatMessageWithMeta } from './types';
import { planResearchCitationIndicesRust } from '../rag/rust-core';

const sourceLabels: Record<RetrievalProviderDiagnostic['source'], keyof I18nKeys> = {
  embedding: 'answerDiagnosticsEmbedding',
  bm25: 'answerDiagnosticsBm25',
  vector: 'answerDiagnosticsVector',
  ann: 'answerDiagnosticsAnn',
  structural: 'answerDiagnosticsStructural',
  reranker: 'answerDiagnosticsReranker',
};

const statusLabels: Record<RetrievalProviderDiagnostic['status'], keyof I18nKeys> = {
  ok: 'answerDiagnosticsSuccess',
  timeout: 'answerDiagnosticsTimeout',
  error: 'answerDiagnosticsError',
  skipped: 'answerDiagnosticsSkipped',
};

let diagnosticsSequence = 0;

export function hasAnswerDiagnostics(message: ChatMessageWithMeta): boolean {
  return message.role === 'assistant';
}

/** 펼침 버튼은 유지하여 스트리밍 갱신으로 포커스나 사용자의 선택을 잃지 않습니다. */
export function renderAnswerDiagnostics(
  container: HTMLElement,
  message: ChatMessageWithMeta,
): void {
  if (!hasAnswerDiagnostics(message)) return;
  let section = container.querySelector('.superpower-inside-answer-diagnostics');
  if (!isDomInstance(section, HTMLElement)) {
    section = container.createDiv({ cls: 'superpower-inside-answer-diagnostics' });
    container.prepend(section);
    const button = section.createEl('button', {
      cls: 'superpower-inside-answer-diagnostics-toggle',
      attr: { type: 'button', 'aria-expanded': 'false' },
    });
    const icon = button.createSpan({
      cls: 'superpower-inside-answer-diagnostics-icon',
      attr: { 'aria-hidden': 'true' },
    });
    setIcon(icon, 'chevron-right');
    button.createSpan({ cls: 'superpower-inside-answer-diagnostics-title' });
    section.createDiv({ cls: 'superpower-inside-answer-diagnostics-summary' });
    const content = section.createDiv({ cls: 'superpower-inside-answer-diagnostics-content' });
    content.id = `answer-diagnostics-${++diagnosticsSequence}`;
    content.hidden = true;
    button.setAttribute('aria-controls', content.id);
    button.addEventListener('click', () => {
      const expanded = button.getAttribute('aria-expanded') !== 'true';
      button.setAttribute('aria-expanded', String(expanded));
      setIcon(icon, expanded ? 'chevron-down' : 'chevron-right');
      content.hidden = !expanded;
    });
  }

  const button = section.querySelector('.superpower-inside-answer-diagnostics-toggle');
  const summary = section.querySelector('.superpower-inside-answer-diagnostics-summary');
  const content = section.querySelector('.superpower-inside-answer-diagnostics-content');
  if (
    !isDomInstance(button, HTMLElement) ||
    !isDomInstance(summary, HTMLElement) ||
    !isDomInstance(content, HTMLElement)
  )
    return;
  const title = button.querySelector('.superpower-inside-answer-diagnostics-title');
  if (isDomInstance(title, HTMLElement)) title.setText(t('answerDiagnosticsTitle'));
  const usage = message.usageSnapshot;
  const totals: string[] = [];
  if (usage?.inputTokens !== undefined)
    totals.push(t('answerDiagnosticsInput', { count: usage.inputTokens }));
  if (usage?.outputTokens !== undefined)
    totals.push(t('answerDiagnosticsOutput', { count: usage.outputTokens }));
  if (usage?.totalTokens !== undefined)
    totals.push(t('answerDiagnosticsTotal', { count: usage.totalTokens }));
  const summaryParts = [
    totals.length > 0 ? totals.join(' · ') : t('answerDiagnosticsUsageMissing'),
  ];
  if (usage && usage.reportedRequests < usage.requests) {
    summaryParts.push(
      t('answerDiagnosticsUsagePartial', {
        reported: usage.reportedRequests,
        requests: usage.requests,
      }),
    );
  } else if (usage?.partial) {
    summaryParts.push(t('answerDiagnosticsUsageFieldsPartial'));
  }
  summary.setText(summaryParts.join(' · '));

  content.empty();
  if (message.status === 'pending' || message.status === 'streaming') {
    content.createDiv({
      cls: 'superpower-inside-answer-diagnostics-note',
      text: t('answerDiagnosticsCollecting'),
    });
  }
  if (usage && usage.requests > 0 && usage.reportedRequests === usage.requests) {
    content.createDiv({
      cls: 'superpower-inside-answer-diagnostics-note',
      text: t('answerDiagnosticsUsageReported', {
        reported: usage.reportedRequests,
        requests: usage.requests,
      }),
    });
  }
  if (usage?.cacheReadTokens !== undefined) {
    content.createDiv({
      cls: 'superpower-inside-answer-diagnostics-note',
      text: t('answerDiagnosticsCached', { count: usage.cacheReadTokens }),
    });
  }
  if (usage?.reasoningTokens !== undefined) {
    content.createDiv({
      cls: 'superpower-inside-answer-diagnostics-note',
      text: t('answerDiagnosticsReasoning', { count: usage.reasoningTokens }),
    });
  }
  content.createDiv({
    cls: 'superpower-inside-answer-diagnostics-note',
    text: t('answerDiagnosticsEmbeddingUsageMissing'),
  });

  const flow = content.createEl('ol', { cls: 'superpower-inside-answer-diagnostics-flow' });
  const search = flow.createEl('li', { cls: 'superpower-inside-answer-diagnostics-step' });
  search.createDiv({
    cls: 'superpower-inside-answer-diagnostics-heading',
    text: t('answerDiagnosticsSearch'),
  });
  search.createDiv({
    cls: 'superpower-inside-answer-diagnostics-note',
    text: t('answerDiagnosticsSearchHelp'),
  });
  if (!message.retrievalTrace?.length) {
    search.createDiv({
      cls: 'superpower-inside-answer-diagnostics-note',
      text: t(
        message.retrievalTrace !== undefined
          ? message.status === 'pending' || message.status === 'streaming'
            ? 'answerDiagnosticsCollecting'
            : 'answerDiagnosticsSearchNotRun'
          : 'answerDiagnosticsSearchMissing',
      ),
    });
  }
  for (const record of message.retrievalTrace ?? []) {
    const query = search.createDiv({ cls: 'superpower-inside-answer-diagnostics-query' });
    query.createDiv({
      cls: 'superpower-inside-answer-diagnostics-heading',
      text: t('answerDiagnosticsQuery', { query: record.query }),
    });
    if (record.status === 'error') {
      query.createDiv({
        cls: 'superpower-inside-answer-diagnostics-note',
        text: t('answerDiagnosticsSearchFailed'),
      });
    }
    for (const diagnostic of record.diagnostics) {
      const row = query.createDiv({
        cls: `superpower-inside-answer-diagnostics-row is-${diagnostic.status}`,
      });
      row.createSpan({
        cls: 'superpower-inside-answer-diagnostics-label',
        text: t(sourceLabels[diagnostic.source]),
      });
      row.createSpan({
        cls: 'superpower-inside-answer-diagnostics-value',
        text: [
          t(statusLabels[diagnostic.status]),
          ...(diagnostic.source === 'embedding'
            ? []
            : [t('answerDiagnosticsCandidates', { count: diagnostic.candidateCount })]),
          t('answerDiagnosticsDuration', { count: diagnostic.durationMs }),
        ].join(' · '),
      });
      if (diagnostic.skippedReason || diagnostic.error) {
        row.createDiv({
          cls: 'superpower-inside-answer-diagnostics-note',
          text: t(
            diagnostic.status === 'skipped'
              ? 'answerDiagnosticsProviderSkipped'
              : 'answerDiagnosticsProviderFailed',
          ),
        });
      }
    }
    query.createDiv({
      cls: 'superpower-inside-answer-diagnostics-note',
      text: t('answerDiagnosticsReturned', { count: record.results.length }),
    });
    for (const result of record.results) {
      const row = query.createDiv({ cls: 'superpower-inside-answer-diagnostics-result' });
      row.createDiv({ cls: 'superpower-inside-answer-diagnostics-path', text: result.filePath });
      const values = [t('answerDiagnosticsCandidate')];
      const sourceMeta = createCitationCardView({
        ...result,
        id: '',
        preview: '',
        status: 'candidate',
      }).metaText;
      if (sourceMeta) values.push(sourceMeta);
      if (result.bm25Score !== undefined)
        values.push(t('answerDiagnosticsBm25Score', { score: result.bm25Score }));
      if (result.vectorScore !== undefined)
        values.push(t('answerDiagnosticsVectorScore', { score: result.vectorScore }));
      row.createDiv({ cls: 'superpower-inside-answer-diagnostics-note', text: values.join(' · ') });
    }
  }
  search.createDiv({
    cls: 'superpower-inside-answer-diagnostics-note',
    text: t('answerDiagnosticsScoreHelp'),
  });

  const sources = flow.createEl('li', { cls: 'superpower-inside-answer-diagnostics-step' });
  sources.createDiv({
    cls: 'superpower-inside-answer-diagnostics-heading',
    text: t('answerDiagnosticsSources'),
  });
  if (!message.citations?.length)
    sources.createDiv({
      cls: 'superpower-inside-answer-diagnostics-note',
      text: t('answerDiagnosticsSourcesMissing'),
    });
  for (const citation of message.citations ?? []) {
    const view = createCitationCardView(citation);
    const row = sources.createDiv({ cls: 'superpower-inside-answer-diagnostics-row' });
    row.createSpan({ cls: 'superpower-inside-answer-diagnostics-path', text: citation.filePath });
    row.createSpan({ cls: 'superpower-inside-answer-diagnostics-value', text: view.statusText });
    const scores = [view.metaText ?? ''];
    if (citation.bm25Score !== undefined)
      scores.push(t('answerDiagnosticsBm25Score', { score: citation.bm25Score }));
    if (citation.vectorScore !== undefined)
      scores.push(t('answerDiagnosticsVectorScore', { score: citation.vectorScore }));
    if (scores.some(Boolean))
      row.createDiv({
        cls: 'superpower-inside-answer-diagnostics-note',
        text: scores.filter(Boolean).join(' · '),
      });
  }
  const answer = flow.createEl('li', { cls: 'superpower-inside-answer-diagnostics-step' });
  answer.createDiv({
    cls: 'superpower-inside-answer-diagnostics-heading',
    text: t('answerDiagnosticsAnswer'),
  });
  answer.createDiv({
    cls: 'superpower-inside-answer-diagnostics-note',
    text: t('answerDiagnosticsAnswerHelp'),
  });
  const cited = answer.createDiv({ cls: 'superpower-inside-answer-diagnostics-cited' });
  const citations = message.citations ?? [];
  const indices = planResearchCitationIndicesRust(
    message.content,
    citations.map((item) => item.id),
    citations.map((item) => item.filePath),
    0,
  );
  if (!indices?.length) {
    cited.createDiv({
      cls: 'superpower-inside-answer-diagnostics-note',
      text: t(
        indices === null
          ? 'answerDiagnosticsCitationsUnavailable'
          : 'answerDiagnosticsCitationsEmpty',
      ),
    });
  }
  for (const index of indices ?? []) {
    const citation = citations[index];
    if (citation)
      cited.createDiv({
        cls: 'superpower-inside-answer-diagnostics-path',
        text: citation.filePath,
      });
  }
}
