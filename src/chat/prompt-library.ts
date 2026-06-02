import { t } from '../i18n';
import type { SuperpowerInsideSettings } from '../settings';
import type { ChatMessage } from '../llm/providers';
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

export const DEFAULT_OBSIDIAN_SYSTEM_PROMPT = t('defaultObsidianSystemPrompt');

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

export const PROMPT_DIRECTION_PRESETS: PromptDirectionPreset[] = getPromptDirectionPresets();

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
      if (entry) pushEntry(entry);
    }
  }

  if (!seen.has(DEFAULT_OBSIDIAN_PROMPT_ID)) {
    pushEntry(createDefaultPromptEntry(now));
  }

  const legacyPrompt = legacySystemPrompt?.trim();
  let legacyEntryId: string | null = null;
  if (legacyPrompt && legacyPrompt !== DEFAULT_OBSIDIAN_SYSTEM_PROMPT) {
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

  const fileCounts = new Map<string, number>();
  const folderCounts = new Map<string, number>();
  const headingCounts = new Map<string, number>();
  for (const entry of entries) {
    const path = entry.metadata.filePath;
    fileCounts.set(path, (fileCounts.get(path) ?? 0) + 1);
    const folder = path.includes('/') ? path.split('/').slice(0, -1).join('/') : '(root)';
    folderCounts.set(folder, (folderCounts.get(folder) ?? 0) + 1);
    const heading = entry.metadata.heading?.trim();
    if (heading) headingCounts.set(heading, (headingCounts.get(heading) ?? 0) + 1);
  }

  const samples = selectRepresentativeEntries(entries, 24).map((entry, index) => {
    const heading = entry.metadata.heading ? ` # ${entry.metadata.heading}` : '';
    const preview = compactWhitespace(entry.metadata.text).slice(0, 320);
    return `${index + 1}. ${entry.metadata.filePath}${heading}\n${preview}`;
  });

  const text = [
    t('promptSummaryTotalChunks', { count: entries.length }),
    '',
    t('promptSummaryTopFolders'),
    formatTopCounts(folderCounts, 12),
    '',
    t('promptSummaryTopFiles'),
    formatTopCounts(fileCounts, 16),
    '',
    t('promptSummaryTopHeadings'),
    formatTopCounts(headingCounts, 18),
    '',
    t('promptSummaryRepresentativeSamples'),
    samples.join('\n\n'),
  ].join('\n');

  return text.length > maxChars ? text.slice(0, maxChars) : text;
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

function selectRepresentativeEntries(entries: VectorEntry[], limit: number): VectorEntry[] {
  if (entries.length <= limit) return entries;
  const selected: VectorEntry[] = [];
  const used = new Set<number>();
  const step = Math.max(1, Math.floor(entries.length / limit));
  for (let index = 0; index < entries.length && selected.length < limit; index += step) {
    selected.push(entries[index]);
    used.add(index);
  }
  for (let index = 0; index < entries.length && selected.length < limit; index++) {
    if (!used.has(index)) selected.push(entries[index]);
  }
  return selected;
}

function formatTopCounts(counts: Map<string, number>, limit: number): string {
  const rows = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'))
    .slice(0, limit)
    .map(([name, count]) => `- ${name}: ${count}`);
  return rows.length > 0 ? rows.join('\n') : t('promptSummaryNone');
}

function compactWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
