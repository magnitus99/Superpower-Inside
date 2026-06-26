import { beforeEach, describe, expect, it } from 'vitest';
import { setLanguage } from '../i18n';
import {
  createContextAttachmentViews,
  createContextBudgetSnapshot,
  createDataBoundarySnapshot,
} from './context-composer';
import type { ContextAttachment, SourceCitation } from './types';

describe('context composer contract', () => {
  beforeEach(() => {
    setLanguage('en');
  });

  const attachments: ContextAttachment[] = [
    {
      id: 'file:Notes/A.md',
      type: 'file',
      name: 'Notes/A.md',
      label: 'Notes/A.md',
      status: 'attached',
      reason: 'Explicit file mention',
      estimatedChars: 1200,
      actualChars: 1180,
      pinned: true,
      sourceIds: ['file-1'],
    },
    {
      id: 'rag:auto',
      type: 'rag',
      name: 'auto',
      label: 'Related notes',
      status: 'partial',
      detail: 'Some candidates left out',
      reason: 'Nearby notes for this question',
      estimatedChars: 4000,
      actualChars: 2200,
      sourceIds: ['rag-1'],
    },
    {
      id: 'mcp:search',
      type: 'mcp-server',
      name: 'search',
      label: 'search',
      status: 'missing',
      detail: 'Not connected',
      excluded: true,
    },
  ];

  const citations: SourceCitation[] = [
    { id: 'file-1', filePath: 'Notes/A.md', status: 'verified', preview: 'Evidence' },
    { id: 'rag-1', filePath: 'Notes/B.md', status: 'low-relevance', preview: 'Candidate' },
  ];

  it('creates composer attachment view state with status, reason, and size', () => {
    expect(createContextAttachmentViews(attachments)).toEqual([
      expect.objectContaining({
        id: 'file:Notes/A.md',
        statusText: 'Included',
        reasonText: 'Explicit file mention',
        sizeText: '1,180 chars',
        pinned: true,
      }),
      expect.objectContaining({
        id: 'rag:auto',
        statusText: 'Partially included',
        detail: 'Some candidates left out',
      }),
      expect.objectContaining({
        id: 'mcp:search',
        statusText: 'Excluded',
      }),
    ]);
  });

  it('stores included, excluded, and truncated state in a per-turn budget snapshot', () => {
    expect(
      createContextBudgetSnapshot({
        maxChars: 6000,
        usedChars: 6000,
        attachments,
        citations,
      }),
    ).toEqual({
      maxChars: 6000,
      usedChars: 6000,
      remainingChars: 0,
      attachmentCount: 3,
      citationCount: 2,
      truncated: true,
      includedAttachmentIds: ['file:Notes/A.md', 'rag:auto'],
      excludedAttachmentIds: ['mcp:search'],
    });
  });

  it('creates a per-turn data boundary snapshot in user-facing language', () => {
    expect(
      createDataBoundarySnapshot({
        providerLabel: 'Ollama',
        model: 'llama3.1',
        hasSystemPrompt: true,
        attachments,
        citations,
        mcpServerNames: ['search'],
      }),
    ).toEqual({
      providerLabel: 'Ollama',
      model: 'llama3.1',
      localOnly: ['Draft and source-card state', 'Source-card state'],
      sentToProvider: ['Answer instructions', '2 notes and references', '2 source previews'],
      sentToMcp: ['search'],
      privacyNotes: ['1 item was left out and was not sent.'],
    });
  });
});
