import { ItemView, Notice, TFile, WorkspaceLeaf } from 'obsidian';
import type SuperpowerInsidePlugin from '../../main';
import { t } from '../i18n';
import type {
  GraphEntityRecord,
  GraphRelationRecord,
  GraphCommunityRecord,
  GraphEvidenceRecord,
  GraphRejectedFactRecord,
} from './store';
import { DEFAULT_ONTOLOGY_SCHEMA } from '../ontology/schema';
import { buildRejectedFactCopyText, getRejectedFactPresentation } from './rejected-facts';

export const GRAPH_RAG_VIEW_TYPE = 'superpower-inside-graph-rag';

const BADGE_COLORS = [
  'var(--color-red)',
  'var(--color-orange)',
  'var(--color-yellow)',
  'var(--color-green)',
  'var(--color-cyan)',
  'var(--color-blue)',
  'var(--color-purple)',
  'var(--color-pink)',
];

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % BADGE_COLORS.length;
}

function getBadgeColor(typeId: string): string {
  return BADGE_COLORS[hashCode(typeId)];
}

function truncate(text: string, maxLen: number): string {
  return text.length <= maxLen ? text : text.slice(0, maxLen) + '...';
}

const LOAD_MORE_CHUNK = 100;
const SEARCH_DEBOUNCE_MS = 200;
const HIDDEN_CLASS = 'superpower-inside-hidden';
const GRAPH_PROGRESS_WIDTH_VAR = '--superpower-inside-graph-progress-width';

function setHidden(el: HTMLElement | null, hidden: boolean): void {
  if (!el) return;
  el.toggleClass(HIDDEN_CLASS, hidden);
}

export class GraphRagView extends ItemView {
  private plugin: SuperpowerInsidePlugin;
  private activeTab: 'entities' | 'relations' | 'evidence' | 'communities' | 'rejected' =
    'entities';
  private searchQuery = '';
  private headerEl: HTMLElement | null = null;
  private searchInputEl: HTMLInputElement | null = null;
  private tabBarEl: HTMLElement | null = null;
  private bodyEl: HTMLElement | null = null;
  private allEntities: GraphEntityRecord[] = [];
  private allRelations: GraphRelationRecord[] = [];
  private allEvidence: GraphEvidenceRecord[] = [];
  private allCommunities: GraphCommunityRecord[] = [];
  private allRejectedFacts: GraphRejectedFactRecord[] = [];
  private entityTypeInfoMap = new Map<string, { id: string; label: string }>();
  private relationTypeInfoMap = new Map<
    string,
    { id: string; label: string; sourceTypeIds: string[]; targetTypeIds: string[] }
  >();
  private minConfidence = 0;
  private detailEntity: GraphEntityRecord | null = null;
  private progressUnsubscriber: (() => void) | null = null;
  private progressEl: HTMLElement | null = null;
  private progressTextEl: HTMLElement | null = null;
  private progressBarEl: HTMLElement | null = null;
  private searchDebounceTimer: number | null = null;
  private renderedItemLimit = LOAD_MORE_CHUNK;

  constructor(leaf: WorkspaceLeaf, plugin: SuperpowerInsidePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return GRAPH_RAG_VIEW_TYPE;
  }

  getDisplayText(): string {
    return t('graphRagViewTabTitle');
  }

  getIcon(): string {
    return 'git-branch';
  }

  async onOpen(): Promise<void> {
    await Promise.resolve();
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass('superpower-inside-graph-view');

    this.headerEl = container.createDiv({ cls: 'superpower-inside-graph-view-header' });

    this.searchInputEl = this.headerEl.createEl('input', {
      type: 'text',
      placeholder: t('graphRagViewSearchPlaceholder'),
    });
    this.searchInputEl.addClass('superpower-inside-graph-view-search');
    this.searchInputEl.addEventListener('input', () => {
      this.searchQuery = this.searchInputEl?.value ?? '';
      if (this.searchDebounceTimer !== null) clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = window.setTimeout(() => {
        this.renderedItemLimit = LOAD_MORE_CHUNK;
        this.renderContent();
      }, SEARCH_DEBOUNCE_MS);
    });

    this.progressEl = this.headerEl.createDiv({ cls: 'superpower-inside-graph-view-progress' });
    setHidden(this.progressEl, true);
    this.progressTextEl = this.progressEl.createSpan({
      cls: 'superpower-inside-graph-view-progress-text',
    });
    this.progressBarEl = this.progressEl.createDiv({
      cls: 'superpower-inside-graph-view-progress-bar',
    });
    const fill = this.progressBarEl.createDiv({
      cls: 'superpower-inside-graph-view-progress-fill',
    });
    fill.id = 'superpower-inside-graph-progress-fill';

    const bus = this.plugin.refreshBus;
    if (bus) {
      this.progressUnsubscriber = bus.on('graph-progress', (result: unknown) => {
        this.showProgress(
          result as {
            progress?: {
              processedFiles: number;
              failedFiles: number;
              selectedFiles: number;
              currentFile: string | null;
            };
          },
        );
      });
    }

    const filterBar = this.headerEl.createDiv({ cls: 'superpower-inside-graph-view-filter-bar' });
    filterBar.createSpan({ text: t('graphRagViewMinConfidence') });
    const confidenceInput = filterBar.createEl('input', {
      type: 'number',
      attr: { min: '0', max: '100', value: '0', step: '5' },
    });
    confidenceInput.addClass('superpower-inside-graph-view-confidence-filter');
    confidenceInput.addEventListener('input', () => {
      this.minConfidence = Number(confidenceInput.value) / 100;
      if (this.searchDebounceTimer !== null) clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = window.setTimeout(() => {
        this.renderedItemLimit = LOAD_MORE_CHUNK;
        this.renderContent();
      }, SEARCH_DEBOUNCE_MS);
    });
    filterBar.createSpan({
      cls: 'superpower-inside-graph-view-schema-version',
      text: `Ontology v${DEFAULT_ONTOLOGY_SCHEMA.version}`,
    });

    this.tabBarEl = container.createDiv({ cls: 'superpower-inside-graph-view-tabs' });
    const tabDefs: {
      id: 'entities' | 'relations' | 'evidence' | 'communities' | 'rejected';
      label: string;
    }[] = [
      { id: 'entities', label: t('graphRagViewTabEntities') },
      { id: 'relations', label: t('graphRagViewTabRelations') },
      { id: 'evidence', label: t('graphRagViewTabEvidence') },
      { id: 'communities', label: t('graphRagViewTabCommunities') },
      { id: 'rejected', label: t('graphRagViewTabRejected') },
    ];
    for (const tab of tabDefs) {
      const btn = this.tabBarEl.createEl('button', { text: tab.label });
      btn.addEventListener('click', () => {
        this.activeTab = tab.id;
        this.renderTabs();
        this.renderContent();
      });
      btn.dataset.tab = tab.id;
    }

    this.bodyEl = container.createDiv({ cls: 'superpower-inside-graph-view-content' });

    await this.loadData();
    this.renderTabs();
    this.renderContent();
  }

  async onClose(): Promise<void> {
    await Promise.resolve();
    this.progressUnsubscriber?.();
    this.progressUnsubscriber = null;
  }

  private addLoadMoreButton(total: number, shown: number): void {
    if (shown >= total || !this.bodyEl) return;
    this.bodyEl
      .createEl('button', {
        cls: 'superpower-inside-graph-view-load-more',
        text: t('graphRagViewLoadMore', { count: total - shown }),
      })
      .addEventListener('click', () => {
        this.renderedItemLimit += LOAD_MORE_CHUNK;
        this.renderContent();
      });
  }

  private async loadData(): Promise<void> {
    const store = this.plugin.knowledgeGraphStore;
    const vectorStore = this.plugin.vectorStore;
    if (!store || !vectorStore) {
      this.allEntities = [];
      this.allRelations = [];
      this.allEvidence = [];
      this.allCommunities = [];
      this.allRejectedFacts = [];
      return;
    }

    const schema = DEFAULT_ONTOLOGY_SCHEMA;
    this.entityTypeInfoMap.clear();
    for (const et of schema.entityTypes) {
      this.entityTypeInfoMap.set(et.id, { id: et.id, label: et.label });
    }
    this.relationTypeInfoMap.clear();
    for (const rt of schema.relationTypes) {
      this.relationTypeInfoMap.set(rt.id, {
        id: rt.id,
        label: rt.label,
        sourceTypeIds: rt.sourceTypeIds,
        targetTypeIds: rt.targetTypeIds,
      });
    }

    const [entities, relations, evidence, communities, rejectedFacts] = await Promise.all([
      store.getEntities(),
      store.getRelations(),
      store.getEvidence(),
      store.getCommunities().catch(() => [] as GraphCommunityRecord[]),
      store.getRejectedFacts().catch(() => [] as GraphRejectedFactRecord[]),
    ]);
    this.allEntities = entities;
    this.allRelations = relations;
    this.allEvidence = evidence;
    this.allCommunities = communities;
    this.allRejectedFacts = rejectedFacts;
  }

  private renderTabs(): void {
    if (!this.tabBarEl) return;
    const buttons = Array.from(this.tabBarEl.querySelectorAll('button'));
    for (const btn of buttons) {
      if (btn.dataset.tab === this.activeTab) {
        btn.addClass('is-active');
      } else {
        btn.removeClass('is-active');
      }
    }
  }

  private renderContent(): void {
    if (!this.bodyEl) return;
    this.bodyEl.empty();

    if (
      this.allEntities.length === 0 &&
      this.allRelations.length === 0 &&
      this.allEvidence.length === 0 &&
      this.allCommunities.length === 0
    ) {
      this.bodyEl.createDiv({
        cls: 'superpower-inside-graph-view-empty',
        text: t('graphRagViewEmpty'),
      });
      return;
    }

    switch (this.activeTab) {
      case 'entities':
        this.renderEntities();
        break;
      case 'relations':
        this.renderRelations();
        break;
      case 'evidence':
        this.renderEvidence();
        break;
      case 'communities':
        this.renderCommunities();
        break;
      case 'rejected':
        this.renderRejected();
        break;
    }
  }

  private renderEntities(): void {
    if (!this.bodyEl) return;
    if (this.detailEntity) {
      this.renderEntityDetail(this.detailEntity);
      return;
    }

    const query = this.searchQuery.toLowerCase().trim();
    let filtered = query
      ? this.allEntities.filter(
          (e) =>
            e.canonicalName.toLowerCase().includes(query) ||
            e.aliases.some((a) => a.toLowerCase().includes(query)) ||
            e.description.toLowerCase().includes(query),
        )
      : this.allEntities;
    if (this.minConfidence > 0) {
      filtered = filtered.filter((e) => e.confidence >= this.minConfidence);
    }

    if (filtered.length === 0) {
      this.bodyEl.createDiv({
        cls: 'superpower-inside-graph-view-empty',
        text: t('graphRagViewNoSearchResults'),
      });
      return;
    }

    const groups = new Map<string, GraphEntityRecord[]>();
    for (const entity of filtered) {
      const list = groups.get(entity.typeId) ?? [];
      list.push(entity);
      groups.set(entity.typeId, list);
    }

    let shown = 0;
    let hasMore = false;
    for (const [typeId, entities] of groups) {
      const label = this.entityTypeInfoMap.get(typeId)?.label ?? typeId;
      const group = this.bodyEl.createDiv({ cls: 'superpower-inside-graph-view-group' });
      group.createDiv({
        cls: 'superpower-inside-graph-view-group-header',
        text: `${label} (${entities.length})`,
      });
      for (const entity of entities) {
        if (shown >= this.renderedItemLimit) {
          hasMore = true;
          break;
        }
        shown++;
        const item = group.createDiv({ cls: 'superpower-inside-graph-view-item' });
        item.addEventListener('click', () => {
          this.detailEntity = entity;
          this.renderContent();
        });
        const badge = item.createSpan({ cls: 'superpower-inside-graph-view-badge', text: label });
        badge.setCssProps({ '--badge-color': getBadgeColor(typeId) });
        const nameSpan = item.createSpan({
          cls: 'superpower-inside-graph-view-item-name',
          text: entity.canonicalName,
        });
        if (entity.aliases.length > 0) {
          nameSpan.createSpan({
            cls: 'superpower-inside-graph-view-item-aliases',
            text: ` (${entity.aliases.join(', ')})`,
          });
        }
        item.createSpan({
          cls: 'superpower-inside-graph-view-confidence',
          text: `${Math.round(entity.confidence * 100)}%`,
        });
        if (entity.description) {
          item.createDiv({
            cls: 'superpower-inside-graph-view-item-desc',
            text: truncate(entity.description, 120),
          });
        }
      }
      if (hasMore) break;
    }
    this.addLoadMoreButton(filtered.length, shown);
  }

  private renderEntityDetail(entity: GraphEntityRecord): void {
    if (!this.bodyEl) return;
    this.bodyEl
      .createEl('button', {
        cls: 'superpower-inside-graph-view-back',
        text: t('graphRagViewBackToList'),
      })
      .addEventListener('click', () => {
        this.detailEntity = null;
        this.renderContent();
      });

    const header = this.bodyEl.createDiv({ cls: 'superpower-inside-graph-view-detail-header' });
    const badge = header.createSpan({
      cls: 'superpower-inside-graph-view-badge',
      text: this.entityTypeInfoMap.get(entity.typeId)?.label ?? entity.typeId,
    });
    badge.setCssProps({ '--badge-color': getBadgeColor(entity.typeId) });
    header.createDiv({
      cls: 'superpower-inside-graph-view-detail-heading',
      text: entity.canonicalName,
    });
    if (entity.aliases.length > 0) {
      header.createDiv({
        cls: 'superpower-inside-graph-view-item-aliases',
        text: t('graphRagViewAliases') + entity.aliases.join(', '),
      });
    }
    header.createSpan({
      cls: 'superpower-inside-graph-view-confidence',
      text: t('graphRagViewConfidence', { percent: Math.round(entity.confidence * 100) }),
    });
    if (entity.description) header.createDiv({ text: entity.description });

    const entityMap = new Map(this.allEntities.map((e) => [e.id, e]));
    const related = this.allRelations.filter(
      (r) => r.sourceEntityId === entity.id || r.targetEntityId === entity.id,
    );
    if (related.length > 0) {
      const section = this.bodyEl.createDiv({ cls: 'superpower-inside-graph-view-detail-section' });
      section.createDiv({
        cls: 'superpower-inside-graph-view-detail-section-heading',
        text: t('graphRagViewRelationsCount', { count: related.length }),
      });
      for (const rel of related) {
        const item = section.createDiv({ cls: 'superpower-inside-graph-view-item' });
        const src = entityMap.get(rel.sourceEntityId);
        const tgt = entityMap.get(rel.targetEntityId);
        const srcName = src?.canonicalName ?? rel.sourceEntityId;
        const tgtName = tgt?.canonicalName ?? rel.targetEntityId;
        const rtLabel =
          this.relationTypeInfoMap.get(rel.relationTypeId)?.label ?? rel.relationTypeId;
        const srcEl = item.createSpan({
          cls: 'superpower-inside-graph-view-entity-link',
          text: srcName,
        });
        srcEl.addEventListener('click', (e) => {
          e.stopPropagation();
          if (src) {
            this.detailEntity = src;
            this.renderContent();
          }
        });
        item.createSpan({ cls: 'superpower-inside-graph-view-relation-arrow', text: ' → ' });
        item.createSpan({ cls: 'superpower-inside-graph-view-relation-type', text: rtLabel });
        item.createSpan({ cls: 'superpower-inside-graph-view-relation-arrow', text: ' → ' });
        const tgtEl = item.createSpan({
          cls: 'superpower-inside-graph-view-entity-link',
          text: tgtName,
        });
        tgtEl.addEventListener('click', (e) => {
          e.stopPropagation();
          if (tgt) {
            this.detailEntity = tgt;
            this.renderContent();
          }
        });
        if (rel.description)
          item.createDiv({
            cls: 'superpower-inside-graph-view-item-desc',
            text: truncate(rel.description, 200),
          });
      }
    }

    const evidence = this.allEvidence.filter((e) => entity.evidenceIds.includes(e.id));
    if (evidence.length > 0) {
      const section = this.bodyEl.createDiv({ cls: 'superpower-inside-graph-view-detail-section' });
      section.createDiv({
        cls: 'superpower-inside-graph-view-detail-section-heading',
        text: t('graphRagViewEvidenceCount', { count: evidence.length }),
      });
      for (const ev of evidence) {
        const item = section.createDiv({ cls: 'superpower-inside-graph-view-item' });
        item.addEventListener('click', () => {
          const file = this.app.vault.getAbstractFileByPath(ev.filePath);
          if (file instanceof TFile) {
            void this.app.workspace.openLinkText(ev.filePath, '', true);
          }
        });
        const lineInfo = ev.endLine ? `L${ev.startLine}-${ev.endLine}` : `L${ev.startLine}`;
        item.createSpan({
          cls: 'superpower-inside-graph-view-evidence-lines',
          text: `${ev.filePath}:${lineInfo}`,
        });
        item.createDiv({
          cls: 'superpower-inside-graph-view-item-desc',
          text: truncate(ev.quote, 200),
        });
      }
    }
  }

  private renderRelations(): void {
    if (!this.bodyEl) return;
    const entityMap = new Map(this.allEntities.map((e) => [e.id, e]));
    const query = this.searchQuery.toLowerCase().trim();
    let filtered = query
      ? this.allRelations.filter((r) => {
          const src = entityMap.get(r.sourceEntityId);
          const tgt = entityMap.get(r.targetEntityId);
          const srcName = src?.canonicalName ?? r.sourceEntityId;
          const tgtName = tgt?.canonicalName ?? r.targetEntityId;
          const rtLabel = this.relationTypeInfoMap.get(r.relationTypeId)?.label ?? r.relationTypeId;
          return (
            srcName.toLowerCase().includes(query) ||
            tgtName.toLowerCase().includes(query) ||
            rtLabel.toLowerCase().includes(query) ||
            r.description.toLowerCase().includes(query)
          );
        })
      : this.allRelations;
    if (this.minConfidence > 0) {
      filtered = filtered.filter((r) => r.confidence >= this.minConfidence);
    }

    if (filtered.length === 0) {
      this.bodyEl.createDiv({
        cls: 'superpower-inside-graph-view-empty',
        text: t('graphRagViewNoSearchResults'),
      });
      return;
    }

    const groups = new Map<string, GraphRelationRecord[]>();
    for (const rel of filtered) {
      const list = groups.get(rel.relationTypeId) ?? [];
      list.push(rel);
      groups.set(rel.relationTypeId, list);
    }

    let shown = 0;
    let hasMore = false;
    for (const [typeId, rels] of groups) {
      const label = this.relationTypeInfoMap.get(typeId)?.label ?? typeId;
      const group = this.bodyEl.createDiv({ cls: 'superpower-inside-graph-view-group' });
      group.createDiv({
        cls: 'superpower-inside-graph-view-group-header',
        text: `${label} (${rels.length})`,
      });
      for (const rel of rels) {
        if (shown >= this.renderedItemLimit) {
          hasMore = true;
          break;
        }
        shown++;
        const item = group.createDiv({ cls: 'superpower-inside-graph-view-item' });
        const src = entityMap.get(rel.sourceEntityId);
        const tgt = entityMap.get(rel.targetEntityId);
        const srcName = src?.canonicalName ?? rel.sourceEntityId;
        const tgtName = tgt?.canonicalName ?? rel.targetEntityId;
        const rtLabel =
          this.relationTypeInfoMap.get(rel.relationTypeId)?.label ?? rel.relationTypeId;
        const srcEl = item.createSpan({
          cls: 'superpower-inside-graph-view-entity-link',
          text: srcName,
        });
        srcEl.addEventListener('click', (e) => {
          e.stopPropagation();
          this.navigateToEntity(src ?? null);
        });
        item.createSpan({ cls: 'superpower-inside-graph-view-relation-arrow', text: ' → ' });
        item.createSpan({ cls: 'superpower-inside-graph-view-relation-type', text: rtLabel });
        item.createSpan({ cls: 'superpower-inside-graph-view-relation-arrow', text: ' → ' });
        const tgtEl = item.createSpan({
          cls: 'superpower-inside-graph-view-entity-link',
          text: tgtName,
        });
        tgtEl.addEventListener('click', (e) => {
          e.stopPropagation();
          this.navigateToEntity(tgt ?? null);
        });
        if (rel.description)
          item.createDiv({
            cls: 'superpower-inside-graph-view-item-desc',
            text: truncate(rel.description, 120),
          });
      }
      if (hasMore) break;
    }
    this.addLoadMoreButton(filtered.length, shown);
  }

  private renderEvidence(): void {
    if (!this.bodyEl) return;
    const query = this.searchQuery.toLowerCase().trim();
    const filtered = query
      ? this.allEvidence.filter(
          (e) => e.filePath.toLowerCase().includes(query) || e.quote.toLowerCase().includes(query),
        )
      : this.allEvidence;

    if (filtered.length === 0) {
      this.bodyEl.createDiv({
        cls: 'superpower-inside-graph-view-empty',
        text: t('graphRagViewNoSearchResults'),
      });
      return;
    }

    const groups = new Map<string, GraphEvidenceRecord[]>();
    for (const ev of filtered) {
      const list = groups.get(ev.filePath) ?? [];
      list.push(ev);
      groups.set(ev.filePath, list);
    }

    let shown = 0;
    let hasMore = false;
    for (const [filePath, evidence] of groups) {
      const group = this.bodyEl.createDiv({ cls: 'superpower-inside-graph-view-group' });
      const header = group.createDiv({ cls: 'superpower-inside-graph-view-group-header' });
      header.createSpan({ text: `${filePath} ` });
      header.createSpan({
        cls: 'superpower-inside-graph-view-group-count',
        text: `(${evidence.length})`,
      });
      for (const ev of evidence) {
        if (shown >= this.renderedItemLimit) {
          hasMore = true;
          break;
        }
        shown++;
        const item = group.createDiv({ cls: 'superpower-inside-graph-view-item' });
        item.addEventListener('click', () => {
          const file = this.app.vault.getAbstractFileByPath(ev.filePath);
          if (file instanceof TFile) {
            void this.app.workspace.openLinkText(ev.filePath, '', true);
          }
        });
        const lineInfo = ev.endLine ? `L${ev.startLine}-${ev.endLine}` : `L${ev.startLine}`;
        item.createSpan({ cls: 'superpower-inside-graph-view-evidence-lines', text: lineInfo });
        item.createDiv({
          cls: 'superpower-inside-graph-view-item-desc',
          text: truncate(ev.quote, 200),
        });
      }
      if (hasMore) break;
    }
    this.addLoadMoreButton(filtered.length, shown);
  }

  private renderCommunities(): void {
    if (!this.bodyEl) return;
    if (this.allCommunities.length === 0) {
      this.bodyEl.createDiv({
        cls: 'superpower-inside-graph-view-empty',
        text: t('graphRagViewNoCommunities'),
      });
      return;
    }

    const query = this.searchQuery.toLowerCase().trim();
    const filtered = query
      ? this.allCommunities.filter(
          (c) => c.title.toLowerCase().includes(query) || c.summary.toLowerCase().includes(query),
        )
      : this.allCommunities;

    const groups = new Map<number, GraphCommunityRecord[]>();
    for (const c of filtered) {
      const list = groups.get(c.level) ?? [];
      list.push(c);
      groups.set(c.level, list);
    }

    let shown = 0;
    let hasMore = false;
    for (const [level, communities] of groups) {
      const group = this.bodyEl.createDiv({ cls: 'superpower-inside-graph-view-group' });
      group.createDiv({
        cls: 'superpower-inside-graph-view-group-header',
        text: `Level ${level} (${communities.length})`,
      });
      for (const c of communities) {
        if (shown >= this.renderedItemLimit) {
          hasMore = true;
          break;
        }
        shown++;
        const item = group.createDiv({ cls: 'superpower-inside-graph-view-item' });
        item.createSpan({ cls: 'superpower-inside-graph-view-item-name', text: c.title });
        item.createDiv({
          cls: 'superpower-inside-graph-view-item-desc',
          text: truncate(c.summary, 200),
        });
      }
      if (hasMore) break;
    }
    this.addLoadMoreButton(filtered.length, shown);
  }

  private renderRejected(): void {
    if (!this.bodyEl) return;
    const query = this.searchQuery.toLowerCase().trim();
    const filtered = query
      ? this.allRejectedFacts.filter(
          (r) => r.filePath.toLowerCase().includes(query) || r.reason.toLowerCase().includes(query),
        )
      : this.allRejectedFacts;

    if (filtered.length === 0) {
      this.bodyEl.createDiv({
        cls: 'superpower-inside-graph-view-empty',
        text: query ? t('graphRagViewNoSearchResults') : t('graphRagViewNoRejectedFacts'),
      });
      return;
    }

    const groups = new Map<string, GraphRejectedFactRecord[]>();
    for (const r of filtered) {
      const list = groups.get(r.filePath) ?? [];
      list.push(r);
      groups.set(r.filePath, list);
    }

    let shown = 0;
    let hasMore = false;
    for (const [filePath, facts] of groups) {
      const group = this.bodyEl.createDiv({ cls: 'superpower-inside-graph-view-group' });
      const header = group.createDiv({ cls: 'superpower-inside-graph-view-group-header' });
      header.createSpan({ text: `${filePath} ` });
      header.createSpan({
        cls: 'superpower-inside-graph-view-group-count',
        text: `(${facts.length})`,
      });
      for (const fact of facts) {
        if (shown >= this.renderedItemLimit) {
          hasMore = true;
          break;
        }
        shown++;
        const presentation = getRejectedFactPresentation(fact);
        const item = group.createDiv({ cls: 'superpower-inside-graph-view-item' });
        item.createSpan({
          cls: 'superpower-inside-graph-view-item-date',
          text: new Date(fact.updatedAt).toLocaleString(),
        });
        item.createDiv({
          cls: 'superpower-inside-graph-view-item-name',
          text: `${presentation.errorCode} · ${presentation.title}`,
        });
        item.createDiv({
          cls: 'superpower-inside-graph-view-item-desc',
          text: presentation.description,
        });
        item.createDiv({
          cls: 'superpower-inside-graph-view-item-desc',
          text: t('graphRagViewRawResponse', { preview: presentation.rawPreview }),
        });
        const details = item.createEl('details', {
          cls: 'superpower-inside-graph-view-rejected-details',
        });
        details.createEl('summary', { text: t('graphRagViewDetails') });
        details.createEl('pre', {
          cls: 'superpower-inside-graph-view-rejected-raw',
          text: presentation.rawText,
        });
        const actions = item.createDiv({ cls: 'superpower-inside-graph-view-item-actions' });
        const copyDetailBtn = actions.createEl('button', { text: t('graphRagViewCopyDetails') });
        copyDetailBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          void this.copyRejectedFactDetail(fact);
        });
        const copyRawBtn = actions.createEl('button', { text: t('graphRagViewCopyResponse') });
        copyRawBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          void this.copyText(presentation.rawText, t('graphRagViewRawCopied'));
        });
        const retryBtn = actions.createEl('button', {
          cls: 'mod-cta',
          text: t('graphRagViewRetry'),
        });
        retryBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          retryBtn.setText(t('graphRagViewProcessing'));
          retryBtn.setAttr('disabled', 'true');
          void this.plugin.runGraphRagIndexing();
        });
      }
      if (hasMore) break;
    }
    this.addLoadMoreButton(filtered.length, shown);
  }

  private async copyRejectedFactDetail(fact: GraphRejectedFactRecord): Promise<void> {
    await this.copyText(buildRejectedFactCopyText(fact), t('graphRagViewErrorCopied'));
  }

  private async copyText(text: string, successMessage: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      new Notice(successMessage, 3000);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      new Notice(t('graphRagViewCopyFailed', { message: msg }), 5000);
    }
  }

  private navigateToEntity(entity: GraphEntityRecord | null): void {
    if (!entity) return;
    this.searchQuery = entity.canonicalName;
    if (this.searchInputEl) {
      this.searchInputEl.value = entity.canonicalName;
    }
    this.activeTab = 'entities';
    this.renderTabs();
    this.renderContent();
  }

  private showProgress(result: {
    progress?: {
      processedFiles: number;
      failedFiles: number;
      selectedFiles: number;
      currentFile: string | null;
    };
  }): void {
    if (!this.progressEl || !this.progressTextEl || !this.progressBarEl) return;
    const progress = result.progress;
    if (!progress) {
      setHidden(this.progressEl, true);
      return;
    }
    const done = progress.processedFiles + progress.failedFiles;
    const pct = progress.selectedFiles > 0 ? Math.round((done / progress.selectedFiles) * 100) : 0;
    setHidden(this.progressEl, false);
    this.progressTextEl.setText(
      t('graphRagViewIndexingProgress', {
        done,
        total: progress.selectedFiles,
        percent: pct,
      }),
    );
    const fill = this.progressBarEl.querySelector<HTMLElement>(
      '#superpower-inside-graph-progress-fill',
    );
    fill?.setCssProps({ [GRAPH_PROGRESS_WIDTH_VAR]: `${pct}%` });
  }
}
