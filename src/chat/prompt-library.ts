import { isLocalizedValue, t } from '../i18n';
import type { SuperpowerInsideSettings } from '../settings';
import type { ChatMessage } from '../llm/providers';
import {
  planPromptLibrarySummaryRust,
  type RustPromptLibrarySummary,
  type RustPromptLibrarySummaryInput,
} from '../rag/rust-core';
import type { VectorEntry } from '../rag/store';

export type PromptLibrarySource = 'default' | 'user' | 'generated';

export interface PromptLibraryEntry {
  id: string;
  title: string;
  description?: string;
  content: string;
  source: PromptLibrarySource;
  directionPreset?: string;
  directionText?: string;
  model?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PromptDirectionPreset {
  id: string;
  label: string;
  instruction: string;
}

export const DEFAULT_OBSIDIAN_PROMPT_ID = 'default-obsidian-knowledge-work';

export function getDefaultObsidianSystemPrompt(): string {
  return t('defaultObsidianSystemPrompt');
}

export function getPromptDirectionPresets(): PromptDirectionPreset[] {
  return [
    {
      id: 'knowledge-connection',
      label: t('promptPresetKnowledgeConnectionLabel'),
      instruction: t('promptPresetKnowledgeConnectionInstruction'),
    },
    {
      id: 'research-notes',
      label: t('promptPresetResearchNotesLabel'),
      instruction: t('promptPresetResearchNotesInstruction'),
    },
    {
      id: 'project-notes',
      label: t('promptPresetProjectNotesLabel'),
      instruction: t('promptPresetProjectNotesInstruction'),
    },
    {
      id: 'daily-review',
      label: t('promptPresetDailyReviewLabel'),
      instruction: t('promptPresetDailyReviewInstruction'),
    },
    {
      id: 'writing-draft',
      label: t('promptPresetWritingDraftLabel'),
      instruction: t('promptPresetWritingDraftInstruction'),
    },
  ];
}

export function createDefaultPromptEntry(now = new Date().toISOString()): PromptLibraryEntry {
  return {
    id: DEFAULT_OBSIDIAN_PROMPT_ID,
    title: t('promptDefaultTitle'),
    description: t('promptDefaultDescription'),
    content: t('defaultObsidianSystemPrompt'),
    source: 'default',
    createdAt: now,
    updatedAt: now,
  };
}

export function createPromptEntry(input: {
  title: string;
  description?: string;
  content: string;
  source: PromptLibrarySource;
  directionPreset?: string;
  directionText?: string;
  model?: string;
  now?: string;
}): PromptLibraryEntry {
  const now = input.now ?? new Date().toISOString();
  return {
    id: `prompt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: input.title.trim() || t('promptNewSystemPromptTitle'),
    description: input.description?.trim() || undefined,
    content: input.content.trim(),
    source: input.source,
    directionPreset: input.directionPreset || undefined,
    directionText: input.directionText?.trim() || undefined,
    model: input.model || undefined,
    createdAt: now,
    updatedAt: now,
  };
}

export function normalizePromptLibrary(
  entries: unknown,
  activePromptId: unknown,
  legacySystemPrompt?: string,
): { promptLibrary: PromptLibraryEntry[]; activePromptId: string } {
  const now = new Date().toISOString();
  const normalized: PromptLibraryEntry[] = [];
  const seen = new Set<string>();

  const pushEntry = (entry: PromptLibraryEntry): void => {
    if (!entry.content.trim() || seen.has(entry.id)) return;
    normalized.push(entry);
    seen.add(entry.id);
  };

  if (Array.isArray(entries)) {
    for (const item of entries) {
      const entry = normalizePromptEntry(item);
      if (!entry) continue;
      if (entry.id === DEFAULT_OBSIDIAN_PROMPT_ID && entry.source === 'default') {
        pushEntry({
          ...createDefaultPromptEntry(now),
          createdAt: entry.createdAt,
        });
        continue;
      }
      pushEntry(entry);
    }
  }

  if (!seen.has(DEFAULT_OBSIDIAN_PROMPT_ID)) {
    pushEntry(createDefaultPromptEntry(now));
  }

  const legacyPrompt = legacySystemPrompt?.trim();
  let legacyEntryId: string | null = null;
  if (
    legacyPrompt &&
    legacyPrompt !== getDefaultObsidianSystemPrompt() &&
    !isLocalizedValue('defaultObsidianSystemPrompt', legacyPrompt)
  ) {
    legacyEntryId = 'legacy-user-system-prompt';
    pushEntry({
      id: legacyEntryId,
      title: t('promptLegacyTitle'),
      description: t('promptLegacyDescription'),
      content: legacyPrompt,
      source: 'user',
      createdAt: now,
      updatedAt: now,
    });
  }

  const activeId = typeof activePromptId === 'string' ? activePromptId : '';
  const fallbackActiveId =
    legacyEntryId && seen.has(legacyEntryId) ? legacyEntryId : DEFAULT_OBSIDIAN_PROMPT_ID;
  return {
    promptLibrary: normalized,
    activePromptId: seen.has(activeId) ? activeId : fallbackActiveId,
  };
}

export function getActivePromptEntry(settings: SuperpowerInsideSettings): PromptLibraryEntry {
  const normalized = normalizePromptLibrary(
    settings.chat.promptLibrary,
    settings.chat.activePromptId,
    settings.chat.systemPrompt,
  );
  const active =
    normalized.promptLibrary.find((entry) => entry.id === normalized.activePromptId) ??
    normalized.promptLibrary[0];
  return active ?? createDefaultPromptEntry();
}

export function getEffectiveSystemPrompt(
  settings: SuperpowerInsideSettings,
  sessionSystemPrompt?: string | null,
): string {
  const sessionPrompt = sessionSystemPrompt?.trim();
  if (sessionPrompt) return sessionPrompt;

  const activePrompt = getActivePromptEntry(settings).content.trim();
  if (activePrompt) return activePrompt;

  const legacyPrompt = settings.chat.systemPrompt?.trim();
  return legacyPrompt || t('defaultObsidianSystemPrompt');
}

export function buildVaultPromptGenerationMessages(input: {
  entries: VectorEntry[];
  directionPreset?: PromptDirectionPreset;
  directionText?: string;
}): ChatMessage[] {
  const summary = summarizeVectorEntries(input.entries);
  const directionLines = [
    input.directionPreset
      ? t('promptDirectionPresetLine', {
          label: input.directionPreset.label,
          instruction: input.directionPreset.instruction,
        })
      : '',
    input.directionText?.trim()
      ? t('promptAdditionalDirectionLine', { text: input.directionText.trim() })
      : '',
  ].filter(Boolean);

  return [
    {
      role: 'system',
      content: t('promptGenerationSystemInstruction'),
    },
    {
      role: 'user',
      content: [
        t('promptGenerationUserIntro'),
        '',
        t('promptGenerationRequirementsHeader'),
        t('promptGenerationRequirementRole'),
        t('promptGenerationRequirementContext'),
        t('promptGenerationRequirementEvidence'),
        t('promptGenerationRequirementLinks'),
        t('promptGenerationRequirementNoDefaultTasks'),
        t('promptGenerationRequirementLength'),
        '',
        directionLines.join('\n\n'),
        '',
        '[Vault Index Summary]',
        summary,
      ]
        .filter(Boolean)
        .join('\n'),
    },
  ];
}

export function summarizeVectorEntries(entries: VectorEntry[], maxChars = 12_000): string {
  if (entries.length === 0) {
    return t('promptNoEmbeddedVaultEntries');
  }

  const summaryInputs: RustPromptLibrarySummaryInput[] = entries.map((entry) => ({
    filePath: entry.metadata.filePath,
    heading: entry.metadata.heading ?? '',
    text: entry.metadata.text,
  }));

  const summary = planPromptLibrarySummaryRust(summaryInputs);
  if (!summary) {
    const fallback = [
      t('promptSummaryTotalChunks', { count: entries.length }),
      '',
      t('promptSummaryTopFolders'),
      t('promptSummaryNone'),
      '',
      t('promptSummaryTopFiles'),
      t('promptSummaryNone'),
      '',
      t('promptSummaryTopHeadings'),
      t('promptSummaryNone'),
      '',
      t('promptSummaryRepresentativeSamples'),
      t('promptSummaryNone'),
    ].join('\n');

    return fallback.length > maxChars ? fallback.slice(0, maxChars) : fallback;
  }

  const text = [
    t('promptSummaryTotalChunks', { count: summary.totalChunks }),
    '',
    t('promptSummaryTopFolders'),
    formatTopCountsFromRust(summary.topFolders),
    '',
    t('promptSummaryTopFiles'),
    formatTopCountsFromRust(summary.topFiles),
    '',
    t('promptSummaryTopHeadings'),
    formatTopCountsFromRust(summary.topHeadings),
    '',
    t('promptSummaryRepresentativeSamples'),
    formatSamplesFromRust(summary),
  ].join('\n');

  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

function formatTopCountsFromRust(counts: RustPromptLibrarySummary['topFolders']): string {
  return (
    counts
      .map((row) => `- ${row.label}: ${row.count}`)
      .filter((line) => line)
      .join('\n') || t('promptSummaryNone')
  );
}

function formatSamplesFromRust(summary: RustPromptLibrarySummary): string {
  return summary.samples
    .map((sample, index) => {
      const heading = sample.heading ? ` # ${sample.heading}` : '';
      return `${index + 1}. ${sample.filePath}${heading}\n${sample.preview}`;
    })
    .join('\n\n');
}

function normalizePromptEntry(value: unknown): PromptLibraryEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const id = typeof item.id === 'string' ? item.id.trim() : '';
  const title = typeof item.title === 'string' ? item.title.trim() : '';
  const content = typeof item.content === 'string' ? item.content.trim() : '';
  const source = item.source;
  if (!id || !title || !content) return null;
  return {
    id,
    title,
    description: typeof item.description === 'string' ? item.description.trim() : undefined,
    content,
    source: source === 'default' || source === 'generated' || source === 'user' ? source : 'user',
    directionPreset:
      typeof item.directionPreset === 'string' ? item.directionPreset.trim() : undefined,
    directionText: typeof item.directionText === 'string' ? item.directionText.trim() : undefined,
    model: typeof item.model === 'string' ? item.model.trim() : undefined,
    createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
    updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : new Date().toISOString(),
  };
}
