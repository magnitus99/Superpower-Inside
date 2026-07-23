import { beforeEach, describe, expect, it } from 'vitest';
import { setLanguage } from '../i18n';
import {
  createCitationSectionView,
  createContextAttachmentChipViews,
  createContextBudgetView,
  createDataBoundaryView,
  createSourceWarningViews,
} from './source-panel';
import type {
  ContextAttachment,
  DataBoundarySnapshot,
  SourceCitation,
  SourceValidationWarning,
} from './types';

describe('SourcePanel view model contract', () => {
  beforeEach(() => {
    setLanguage('en');
  });

  it('presents sources as checked evidence instead of retrieval internals', () => {
    const citations: SourceCitation[] = [
      {
        id: 'rag-1',
        filePath: 'Notes/A.md',
        heading: 'Overview',
        line: 3,
        score: 0.8123,
        status: 'verified',
        preview: 'Grounded note excerpt',
        selectionReason: 'keyword-vector',
        previewTruncated: true,
      },
      {
        id: 'graph-1',
        filePath: 'graph://community/product-philosophy',
        status: 'verified',
        preview: 'Related themes are connected in the knowledge graph.',
        graphType: 'community',
        selectionReason: 'strong-graph-evidence',
      },
      {
        id: 'rag-2',
        filePath: 'Notes/Old.md',
        status: 'stale',
        detail: 'The note changed after this context was prepared.',
        preview: 'Older context preview',
      },
    ];

    const view = createCitationSectionView(citations);

    expect(view.labelText).toBe('2/3 sources checked');
    expect(view.collapsedByDefault).toBe(true);
    expect(view.cards[0]).toEqual(
      expect.objectContaining({
        statusText: 'Checked',
        headingText: ' # Overview',
        metaText: 'line 3 / strong text match / preview shortened',
      }),
    );
    expect(view.cards[1]).toEqual(
      expect.objectContaining({
        graphKindText: 'Knowledge theme',
        metaText: 'strong relationship match',
      }),
    );
    expect(view.cards[2]).toEqual(
      expect.objectContaining({
        statusText: 'Changed',
        detail: 'The note changed after this context was prepared.',
      }),
    );

    const renderedText = JSON.stringify(view);
    expect(renderedText).not.toContain('GraphRAG');
    expect(renderedText).not.toContain('vector');
    expect(renderedText).not.toContain('relevance 0.812');
  });

  it('summarizes context attachments in user-facing work language', () => {
    const attachments: ContextAttachment[] = [
      {
        id: 'rag:auto',
        type: 'rag',
        name: 'auto',
        label: 'Auto RAG 3',
        status: 'attached',
        sourceIds: ['rag-1', 'rag-2', 'rag-3'],
        detail: 'Automatically searched nearby vault notes for this question.',
      },
      {
        id: 'folder:Research',
        type: 'folder',
        name: 'Research',
        label: 'Research',
        status: 'partial',
        fileCount: 1,
        folderLimitReason: 'budget',
        detail: 'Only part of the folder was attached to fit the context budget.',
      },
      {
        id: 'graph-rag:auto',
        type: 'graph-rag',
        name: 'auto',
        label: 'GraphRAG 1 entity',
        status: 'attached',
        sourceIds: ['graph-1'],
      },
      {
        id: 'rag:skipped',
        type: 'rag',
        name: 'auto',
        label: 'Auto RAG',
        status: 'missing',
        autoRagReason: 'server-only',
        detail: 'Auto RAG is disabled for this turn.',
      },
    ];

    expect(createContextAttachmentChipViews(attachments)).toEqual([
      {
        id: 'rag:auto',
        className: 'superpower-inside-chat-context-chip rag attached',
        label: 'Checked 3 related notes',
        title: 'Found related notes automatically.',
      },
      {
        id: 'folder:Research',
        className: 'superpower-inside-chat-context-chip folder partial',
        label: 'Research: 1 note used',
        title: 'Only the part that fit was included.',
      },
      {
        id: 'graph-rag:auto',
        className: 'superpower-inside-chat-context-chip graph-rag attached',
        label: 'Checked knowledge graph',
        title: undefined,
      },
      {
        id: 'rag:skipped',
        className: 'superpower-inside-chat-context-chip rag skipped',
        label: 'Vault search skipped',
        title: 'Vault search was skipped for this question.',
      },
    ]);
  });

  it('keeps diagnostics available without turning the answer into an index dashboard', () => {
    expect(
      createContextBudgetView({
        maxChars: 4000,
        usedChars: 1200,
        attachmentCount: 4,
        citationCount: 2,
        truncated: true,
        includedAttachmentIds: ['file:a', 'rag:auto', 'graph:auto'],
        excludedAttachmentIds: ['rag:old'],
      }),
    ).toEqual({
      className: 'superpower-inside-chat-context-budget truncated',
      usageText: '3 context items prepared',
      detailText: '1 item left out',
      truncatedText: 'Some material was shortened.',
    });

    const boundary: DataBoundarySnapshot = {
      providerLabel: 'OpenAI',
      model: 'gpt-4.1',
      localOnly: ['Draft store', 'Source card UI state'],
      sentToProvider: ['System prompt', '3 context attachments', '2 source previews'],
      sentToMcp: ['search'],
      privacyNotes: ['1 excluded attachment is not sent to the provider.'],
    };

    expect(createDataBoundaryView(boundary)).toEqual({
      title: 'What this answer used',
      providerLabel: 'Sent to OpenAI / gpt-4.1',
      localLabel: 'Kept on this device',
      mcpLabel: 'Tools contacted',
      providerItems: ['Answer instructions', '3 notes and references', '2 source previews'],
      localItems: ['Draft and source-card state'],
      mcpItems: ['search'],
      privacyNotes: ['1 item was left out and was not sent.'],
    });
  });

  it('keeps source repair action explicit when an answer cites unchecked material', () => {
    const warnings: SourceValidationWarning[] = [
      {
        id: 'warn-1',
        label: 'Source rag-9',
        detail: 'This source ID is not in the checked evidence.',
        kind: 'unverified-source',
      },
    ];

    expect(createSourceWarningViews(warnings)).toEqual([
      {
        id: 'warn-1',
        className: 'superpower-inside-chat-source-warning unverified-source',
        label: 'Source rag-9',
        detail: 'This source ID is not in the checked evidence.',
        repairActionText: 'Check source',
      },
    ]);
  });
});
