export type AssistantResponseTab = 'answer' | 'work' | 'sources';

export interface AssistantResponseLayoutLabels {
  answer: string;
  work: string;
  sources: (count: number) => string;
}

export interface AssistantResponseLayoutState {
  hasAnswer: boolean;
  hasWork: boolean;
  sourceCount: number;
  isComplete: boolean;
}

export interface AssistantResponseLayoutViewModelInput extends AssistantResponseLayoutState {
  labels: AssistantResponseLayoutLabels;
  manualActiveTab?: AssistantResponseTab | null;
}

export interface AssistantResponseTabViewModel {
  key: AssistantResponseTab;
  label: string;
  available: boolean;
  hidden: boolean;
  disabled: boolean;
  selected: boolean;
  tabIndex: 0 | -1;
}

export interface AssistantResponseLayoutViewModel {
  activeTab: AssistantResponseTab | null;
  sourceCount: number;
  tabs: readonly AssistantResponseTabViewModel[];
}

export interface AssistantResponseLayoutOptions {
  ariaLabel: string;
  labels: AssistantResponseLayoutLabels;
  state: AssistantResponseLayoutState;
  idPrefix?: string;
}

export interface AssistantResponseLayoutController {
  root: HTMLElement;
  tabList: HTMLElement;
  tabs: Readonly<Record<AssistantResponseTab, HTMLButtonElement>>;
  panels: Readonly<Record<AssistantResponseTab, HTMLElement>>;
  update: (state: AssistantResponseLayoutState) => AssistantResponseLayoutViewModel;
  getViewModel: () => AssistantResponseLayoutViewModel;
}

const TAB_ORDER: readonly AssistantResponseTab[] = ['answer', 'work', 'sources'];
let layoutSequence = 0;

function normalizeSourceCount(sourceCount: number): number {
  if (!Number.isFinite(sourceCount)) return 0;
  return Math.max(0, Math.floor(sourceCount));
}

function isAvailable(
  tab: AssistantResponseTab,
  state: Pick<AssistantResponseLayoutState, 'hasAnswer' | 'hasWork' | 'sourceCount'>,
): boolean {
  switch (tab) {
    case 'answer':
      return state.hasAnswer;
    case 'work':
      return state.hasWork;
    case 'sources':
      return state.sourceCount > 0;
  }
}

function chooseAutomaticTab(state: AssistantResponseLayoutState): AssistantResponseTab | null {
  if (state.isComplete && state.hasAnswer) return 'answer';
  if (!state.isComplete && !state.hasAnswer && state.hasWork) return 'work';
  if (state.hasAnswer) return 'answer';
  if (state.hasWork) return 'work';
  if (state.sourceCount > 0) return 'sources';
  return null;
}

export function createAssistantResponseLayoutViewModel(
  input: AssistantResponseLayoutViewModelInput,
): AssistantResponseLayoutViewModel {
  const sourceCount = normalizeSourceCount(input.sourceCount);
  const state: AssistantResponseLayoutState = {
    hasAnswer: input.hasAnswer,
    hasWork: input.hasWork,
    sourceCount,
    isComplete: input.isComplete,
  };
  const manualActiveTab =
    input.manualActiveTab && isAvailable(input.manualActiveTab, state)
      ? input.manualActiveTab
      : null;
  const activeTab = manualActiveTab ?? chooseAutomaticTab(state);
  const labels: Record<AssistantResponseTab, string> = {
    answer: input.labels.answer,
    work: input.labels.work,
    sources: input.labels.sources(sourceCount),
  };

  return {
    activeTab,
    sourceCount,
    tabs: TAB_ORDER.map((key) => {
      const available = isAvailable(key, state);
      const selected = key === activeTab;
      return {
        key,
        label: labels[key],
        available,
        hidden: !available,
        disabled: !available,
        selected,
        tabIndex: selected ? 0 : -1,
      };
    }),
  };
}

function createLayoutIdPrefix(explicitPrefix: string | undefined): string {
  if (explicitPrefix?.trim()) return explicitPrefix.trim();
  layoutSequence += 1;
  return `superpower-inside-assistant-response-${layoutSequence}`;
}

export function createAssistantResponseLayout(
  container: HTMLElement,
  options: AssistantResponseLayoutOptions,
): AssistantResponseLayoutController {
  const idPrefix = createLayoutIdPrefix(options.idPrefix);
  const root = container.createDiv({
    cls: 'superpower-inside-chat-assistant-response',
    attr: { id: `${idPrefix}-content` },
  });
  const tabList = root.createDiv({
    cls: 'superpower-inside-chat-assistant-response-tabs',
    attr: {
      role: 'tablist',
      'aria-label': options.ariaLabel,
    },
  });
  const canvas = root.createDiv({
    cls: 'superpower-inside-chat-assistant-response-canvas',
  });

  const answerTab = createTab(tabList, idPrefix, 'answer');
  const workTab = createTab(tabList, idPrefix, 'work');
  const sourcesTab = createTab(tabList, idPrefix, 'sources');
  const tabs: Record<AssistantResponseTab, HTMLButtonElement> = {
    answer: answerTab,
    work: workTab,
    sources: sourcesTab,
  };

  const answerPanel = createPanel(canvas, idPrefix, 'answer');
  const workPanel = createPanel(canvas, idPrefix, 'work');
  const sourcesPanel = createPanel(canvas, idPrefix, 'sources');
  const panels: Record<AssistantResponseTab, HTMLElement> = {
    answer: answerPanel,
    work: workPanel,
    sources: sourcesPanel,
  };

  let state = options.state;
  let manualActiveTab: AssistantResponseTab | null = null;
  let viewModel = createAssistantResponseLayoutViewModel({
    ...state,
    labels: options.labels,
  });

  const render = (): AssistantResponseLayoutViewModel => {
    if (manualActiveTab && !isAvailable(manualActiveTab, state)) {
      manualActiveTab = null;
    }
    viewModel = createAssistantResponseLayoutViewModel({
      ...state,
      labels: options.labels,
      manualActiveTab,
    });
    tabList.hidden = viewModel.tabs.filter((tab) => tab.available).length <= 1;

    for (const tabView of viewModel.tabs) {
      const tab = tabs[tabView.key];
      const panel = panels[tabView.key];
      tab.textContent = tabView.label;
      tab.hidden = tabView.hidden;
      tab.disabled = tabView.disabled;
      tab.tabIndex = tabView.tabIndex;
      tab.setAttribute('aria-selected', String(tabView.selected));
      tab.setAttribute('aria-disabled', String(tabView.disabled));
      panel.hidden = !tabView.selected;
    }

    return viewModel;
  };

  const activateManually = (tab: AssistantResponseTab): void => {
    const tabView = viewModel.tabs.find((candidate) => candidate.key === tab);
    if (!tabView?.available) return;
    manualActiveTab = tab;
    render();
  };

  const moveSelection = (currentTab: AssistantResponseTab, event: KeyboardEvent): void => {
    const availableTabs = viewModel.tabs.filter((tab) => tab.available).map((tab) => tab.key);
    if (availableTabs.length === 0) return;

    const currentIndex = Math.max(0, availableTabs.indexOf(currentTab));
    let target: AssistantResponseTab | undefined;
    switch (event.key) {
      case 'ArrowRight':
        target = availableTabs[(currentIndex + 1) % availableTabs.length];
        break;
      case 'ArrowLeft':
        target = availableTabs[(currentIndex - 1 + availableTabs.length) % availableTabs.length];
        break;
      case 'Home':
        target = availableTabs[0];
        break;
      case 'End':
        target = availableTabs.at(-1);
        break;
      default:
        return;
    }

    event.preventDefault();
    if (!target) return;
    activateManually(target);
    tabs[target].focus();
  };

  for (const key of TAB_ORDER) {
    tabs[key].addEventListener('click', () => {
      activateManually(key);
    });
    tabs[key].addEventListener('keydown', (event) => {
      moveSelection(key, event);
    });
  }

  render();

  return {
    root,
    tabList,
    tabs,
    panels,
    update: (nextState) => {
      state = nextState;
      return render();
    },
    getViewModel: () => viewModel,
  };
}

function createTab(
  tabList: HTMLElement,
  idPrefix: string,
  tab: AssistantResponseTab,
): HTMLButtonElement {
  return tabList.createEl('button', {
    cls: `superpower-inside-chat-assistant-response-tab is-${tab}`,
    attr: {
      id: `${idPrefix}-tab-${tab}`,
      type: 'button',
      role: 'tab',
      'aria-controls': `${idPrefix}-panel-${tab}`,
    },
  });
}

function createPanel(
  canvas: HTMLElement,
  idPrefix: string,
  tab: AssistantResponseTab,
): HTMLElement {
  return canvas.createDiv({
    cls: `superpower-inside-chat-assistant-response-panel is-${tab}`,
    attr: {
      id: `${idPrefix}-panel-${tab}`,
      role: 'tabpanel',
      'aria-labelledby': `${idPrefix}-tab-${tab}`,
      tabindex: '0',
    },
  });
}
