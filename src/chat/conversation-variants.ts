import type { ChatMessageWithMeta } from './types';

export interface RegenerationDraft {
  text: string;
  previousUserId: string;
  variantOf: string;
  branchRoot: string;
}

export interface VariantComparisonRow {
  id: string;
  providerText: string;
  citationCount: number;
  sourceWarningCount: number;
  toolCallCount: number;
  stopReason: string;
  contextAttachmentCount: number;
  active: boolean;
}

export interface AssistantVariantGroup {
  rootId: string;
  variants: ChatMessageWithMeta[];
  activeId: string;
  activeIndex: number;
}

interface AssistantVariantIndex {
  rootIdByAssistantId: Map<string, string>;
  membersByRootId: Map<string, ChatMessageWithMeta[]>;
}

function buildAssistantVariantIndex(
  messages: readonly ChatMessageWithMeta[],
): AssistantVariantIndex {
  const byId = new Map(messages.map((message) => [message.id, message]));
  const rootIdByAssistantId = new Map<string, string>();
  const membersByRootId = new Map<string, ChatMessageWithMeta[]>();
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    let rootId = message.id;
    const visited = new Set([rootId]);
    for (;;) {
      const parentId = byId.get(rootId)?.variantOf;
      if (!parentId || visited.has(parentId) || !byId.has(parentId)) break;
      visited.add(parentId);
      rootId = parentId;
    }
    rootIdByAssistantId.set(message.id, rootId);
    const members = membersByRootId.get(rootId);
    if (members) {
      members.push(message);
    } else {
      membersByRootId.set(rootId, [message]);
    }
  }
  return { rootIdByAssistantId, membersByRootId };
}

function resolveActiveVariantId(
  members: readonly ChatMessageWithMeta[],
  preferredActiveId: string | undefined,
): string {
  const preferred = preferredActiveId
    ? members.find((message) => message.id === preferredActiveId)
    : undefined;
  return (preferred ?? members.at(-1))?.id ?? '';
}

function createGroup(
  index: AssistantVariantIndex,
  rootId: string,
  activeSelection: ReadonlyMap<string, string>,
): AssistantVariantGroup {
  const variants = index.membersByRootId.get(rootId) ?? [];
  const activeId = resolveActiveVariantId(variants, activeSelection.get(rootId));
  return {
    rootId,
    variants: [...variants],
    activeId,
    activeIndex: Math.max(
      0,
      variants.findIndex((message) => message.id === activeId),
    ),
  };
}

/** variantOf 체인을 끝까지 걸어 재생성 응답의 루트 답변 id를 찾는다. */
export function resolveAssistantVariantRoot(
  messages: readonly ChatMessageWithMeta[],
  assistantMessageId: string,
): string {
  return (
    buildAssistantVariantIndex(messages).rootIdByAssistantId.get(assistantMessageId) ??
    assistantMessageId
  );
}

export function createAssistantVariantGroup(
  messages: readonly ChatMessageWithMeta[],
  assistantMessageId: string,
  activeSelection: ReadonlyMap<string, string>,
): AssistantVariantGroup | null {
  const index = buildAssistantVariantIndex(messages);
  const rootId = index.rootIdByAssistantId.get(assistantMessageId);
  if (!rootId) return null;
  return createGroup(index, rootId, activeSelection);
}

export function createAssistantVariantGroupByRoot(
  messages: readonly ChatMessageWithMeta[],
  rootId: string,
  activeSelection: ReadonlyMap<string, string>,
): AssistantVariantGroup | null {
  const index = buildAssistantVariantIndex(messages);
  if (!index.membersByRootId.has(rootId)) return null;
  return createGroup(index, rootId, activeSelection);
}

/**
 * 표시와 provider 전송에 함께 쓰는 대화 시퀀스.
 * variant 그룹은 active 응답 하나만 루트 답변의 원래 위치에 두고, 재생성 사본 user 메시지는 숨긴다.
 */
export function selectActiveConversationMessages(
  messages: readonly ChatMessageWithMeta[],
  activeSelection: ReadonlyMap<string, string>,
): ChatMessageWithMeta[] {
  const index = buildAssistantVariantIndex(messages);
  const activeIdByRootId = new Map<string, string>();
  for (const [rootId, members] of index.membersByRootId) {
    if (members.length < 2) continue;
    activeIdByRootId.set(rootId, resolveActiveVariantId(members, activeSelection.get(rootId)));
  }
  const lastMessageId = messages.at(-1)?.id;
  const selected: ChatMessageWithMeta[] = [];
  for (const message of messages) {
    if (message.role === 'assistant') {
      const rootId = index.rootIdByAssistantId.get(message.id);
      const activeId = rootId ? activeIdByRootId.get(rootId) : undefined;
      if (rootId && activeId) {
        if (message.id === rootId) {
          const active = index.membersByRootId
            .get(rootId)
            ?.find((member) => member.id === activeId);
          if (active) selected.push(active);
        }
        continue;
      }
      selected.push(message);
      continue;
    }
    // 진행 중인 마지막 사본(아직 응답이 없는 순간)만 provider가 답할 대상으로 남긴다.
    if (message.role === 'user' && message.variantOf && message.id !== lastMessageId) {
      continue;
    }
    selected.push(message);
  }
  return selected;
}

/**
 * 편집 후 전송은 기존 응답을 보관하지 않는다.
 * 수정된 메시지 이전까지만 남긴 시퀀스를 반환하고, 무변경·대상 없음이면 null.
 */
export function createEditResendPlan(
  messages: readonly ChatMessageWithMeta[],
  userMessageId: string,
  editedText: string,
): ChatMessageWithMeta[] | null {
  const index = messages.findIndex(
    (message) => message.id === userMessageId && message.role === 'user',
  );
  if (index < 0) return null;
  if (messages[index].content === editedText) return null;
  return messages.slice(0, index);
}

export function createRegenerationDraft(
  messages: readonly ChatMessageWithMeta[],
  assistantMessageId: string,
): RegenerationDraft | null {
  const index = messages.findIndex((message) => message.id === assistantMessageId);
  if (index <= 0) return null;
  const previousUser = [...messages.slice(0, index)]
    .reverse()
    .find((message) => message.role === 'user');
  if (!previousUser) return null;
  return {
    text: previousUser.content,
    previousUserId: previousUser.id,
    variantOf: resolveAssistantVariantRoot(messages, assistantMessageId),
    branchRoot: previousUser.branchRoot ?? previousUser.id,
  };
}

export function createVariantComparisonRows(
  messages: readonly ChatMessageWithMeta[],
  activeMessageId: string,
): VariantComparisonRow[] {
  const active = messages.find((message) => message.id === activeMessageId);
  if (!active || active.role !== 'assistant') return [];
  const index = buildAssistantVariantIndex(messages);
  const rootId = index.rootIdByAssistantId.get(activeMessageId) ?? activeMessageId;
  const variants = index.membersByRootId.get(rootId) ?? [];
  if (variants.length < 2) return [];
  return variants.map((message) => ({
    id: message.id,
    providerText: [message.providerLabel, message.model].filter(Boolean).join(' / ') || '-',
    citationCount: message.citations?.length ?? 0,
    sourceWarningCount: message.sourceWarnings?.length ?? 0,
    toolCallCount: message.toolCalls?.length ?? 0,
    stopReason: message.stopReason ?? '-',
    contextAttachmentCount: message.contextAttachments?.length ?? 0,
    active: message.id === activeMessageId,
  }));
}

export function selectPreviousUserQuestions(
  messages: readonly ChatMessageWithMeta[],
  beforeUserMessageId?: string,
): string[] {
  const boundaryIndex = beforeUserMessageId
    ? messages.findIndex((message) => message.id === beforeUserMessageId && message.role === 'user')
    : messages.length;
  if (boundaryIndex < 0) return [];

  const previousUser = [...messages.slice(0, boundaryIndex)]
    .reverse()
    .find((message) => message.role === 'user' && message.content.trim().length > 0);
  return previousUser ? [previousUser.content.trim()] : [];
}

export function markMessageRegenerated(
  message: ChatMessageWithMeta,
  at = new Date().toISOString(),
): ChatMessageWithMeta {
  const history = message.actionHistory ?? [];
  return {
    ...message,
    updatedAt: at,
    actionHistory: [
      ...history,
      {
        id: `action-${at}-${history.length}`,
        action: 'regenerate',
        at,
      },
    ],
  };
}
