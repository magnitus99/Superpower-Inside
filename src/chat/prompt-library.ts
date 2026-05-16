import type { SuperObsidianSettings } from '../settings';
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

export const DEFAULT_OBSIDIAN_SYSTEM_PROMPT = [
  '당신은 Obsidian 볼트와 함께 작동하는 지식 작업 보조자입니다.',
  '사용자의 볼트를 개인 지식베이스로 존중하고, 제공된 Vault Context와 명시적으로 멘션된 파일/폴더를 우선 근거로 사용하세요.',
  '근거가 있는 내용과 추론을 구분하고, 확실하지 않은 내용은 꾸며내지 말고 필요한 추가 맥락을 요청하세요.',
  '답변은 사용자의 노트 작성 흐름에 바로 붙일 수 있도록 명확한 Markdown으로 작성하세요.',
  '가능하면 관련 노트명, 연결할 만한 링크 후보, 다음에 정리할 노트 구조를 제안하세요.',
  '코드리뷰, 번역, 단순 요약을 기본 역할로 삼지 말고, 사용자가 명시적으로 요청한 경우에만 해당 작업에 집중하세요.',
].join('\n');

export const PROMPT_DIRECTION_PRESETS: PromptDirectionPreset[] = [
  {
    id: 'knowledge-connection',
    label: '지식 연결',
    instruction:
      '볼트 안의 개념, 파일, 헤딩 사이의 연결을 적극적으로 찾아 사용자가 다음 노트 링크와 지식 구조를 만들 수 있게 돕는다.',
  },
  {
    id: 'research-notes',
    label: '연구 노트',
    instruction:
      '근거, 반론, 미해결 질문, 후속 조사 항목을 분리해 연구 노트로 재사용하기 쉬운 답변을 만든다.',
  },
  {
    id: 'project-notes',
    label: '프로젝트 노트',
    instruction:
      '결정 사항, 작업 항목, 리스크, 다음 행동을 분명히 나눠 프로젝트 운영 노트에 바로 옮길 수 있게 돕는다.',
  },
  {
    id: 'daily-review',
    label: '일일/회고',
    instruction:
      '사용자의 기록을 바탕으로 관찰, 패턴, 회고 질문, 다음 실험을 제안하되 과도한 해석은 피한다.',
  },
  {
    id: 'writing-draft',
    label: '글쓰기 초안',
    instruction:
      '볼트의 기존 표현과 논지를 존중하면서 초안, 개요, 문단 전개, 제목 후보를 제안한다.',
  },
];

export function createDefaultPromptEntry(now = new Date().toISOString()): PromptLibraryEntry {
  return {
    id: DEFAULT_OBSIDIAN_PROMPT_ID,
    title: 'Obsidian 지식 작업 기본',
    description: '볼트 컨텍스트, 노트 연결, 출처 기반 답변에 맞춘 기본 시스템 프롬프트',
    content: DEFAULT_OBSIDIAN_SYSTEM_PROMPT,
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
    title: input.title.trim() || '새 시스템 프롬프트',
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
      title: '이전 사용자 시스템 프롬프트',
      description: '기존 설정의 systemPrompt에서 가져온 프롬프트',
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

export function getActivePromptEntry(settings: SuperObsidianSettings): PromptLibraryEntry {
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
  settings: SuperObsidianSettings,
  sessionSystemPrompt?: string | null,
): string {
  const sessionPrompt = sessionSystemPrompt?.trim();
  if (sessionPrompt) return sessionPrompt;

  const activePrompt = getActivePromptEntry(settings).content.trim();
  if (activePrompt) return activePrompt;

  const legacyPrompt = settings.chat.systemPrompt?.trim();
  return legacyPrompt || DEFAULT_OBSIDIAN_SYSTEM_PROMPT;
}

export function buildVaultPromptGenerationMessages(input: {
  entries: VectorEntry[];
  directionPreset?: PromptDirectionPreset;
  directionText?: string;
}): ChatMessage[] {
  const summary = summarizeVectorEntries(input.entries);
  const directionLines = [
    input.directionPreset
      ? `방향성 프리셋: ${input.directionPreset.label}\n${input.directionPreset.instruction}`
      : '',
    input.directionText?.trim() ? `추가 방향성: ${input.directionText.trim()}` : '',
  ].filter(Boolean);

  return [
    {
      role: 'system',
      content:
        '당신은 Obsidian 볼트에 맞는 시스템 프롬프트를 설계하는 전문가입니다. 출력은 시스템 프롬프트 본문만 작성하고, 설명이나 머리말은 붙이지 마세요.',
    },
    {
      role: 'user',
      content: [
        '다음 임베딩 인덱스 요약을 바탕으로 이 볼트의 채팅 탭에서 사용할 한국어 시스템 프롬프트를 작성하세요.',
        '',
        '요구사항:',
        '- Obsidian 볼트 기반 지식 작업 보조자 역할을 중심에 둡니다.',
        '- Vault Context와 명시적 파일/폴더 멘션을 우선하도록 지시합니다.',
        '- 근거와 추론을 구분하고, 모르는 내용은 꾸며내지 않도록 지시합니다.',
        '- 관련 노트명, 링크 후보, 다음 정리 구조를 제안하도록 지시합니다.',
        '- 코드리뷰, 번역, 단순 요약을 기본 역할로 삼지 않습니다.',
        '- 900자 이내의 실사용 가능한 시스템 프롬프트로 작성합니다.',
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
    return '임베딩된 볼트 항목이 없습니다.';
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
    `총 청크: ${entries.length}`,
    '',
    '[상위 폴더]',
    formatTopCounts(folderCounts, 12),
    '',
    '[상위 파일]',
    formatTopCounts(fileCounts, 16),
    '',
    '[주요 헤딩]',
    formatTopCounts(headingCounts, 18),
    '',
    '[대표 청크 샘플]',
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
  return rows.length > 0 ? rows.join('\n') : '- 없음';
}

function compactWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
