export type Language = 'ko' | 'en';

export interface I18nKeys {
  // 일반 탭
  autoSaveSettings: string;
  autoSaveSettingsDesc: string;
  autoSaveDelay: string;
  autoSaveDelayDesc: string;
  autoSaveSuccessNotice: string;
  autoSaveMcpFailedNotice: string;
  autoSaveFailedNotice: string;
  autoSaveUnknownError: string;
  delayMs: string;
  defaultModel: string;
  defaultModelDesc: string;
  refreshModelList: string;
  refreshing: string;
  refreshComplete: string;
  actionCompletedNotice: string;
  actionPartialNotice: string;
  actionNoopNotice: string;
  actionCancelledNotice: string;
  actionFailedWithMessage: string;
  noModelsEnabled: string;
  pluginAwareGeneration: string;
  pluginAwareGenerationDesc: string;
  pluginAwareGenerationLimitNotice: string;
  pluginAwareContext7MissingWarning: string;
  language: string;
  languageDesc: string;
  langKo: string;
  langEn: string;
  languageChangeConfirm: string;
  generalStatusTitle: string;
  generalStatusDesc: string;
  generalAllReady: string;
  generalBasicsTitle: string;
  generalBasicsDesc: string;
  generalDiagnosticsTitle: string;
  generalDiagnosticsDesc: string;
  generalDiagnosticsDisclosureTitle: string;
  generalDiagnosticsDisclosureDesc: string;
  generalAdvancedTitle: string;
  generalAdvancedDesc: string;
  generalAutoSaveDisclosureTitle: string;
  generalAutoSaveDisclosureDesc: string;
  generalDangerDisclosureDesc: string;
  chatStatusTitle: string;
  chatStatusDesc: string;
  chatActiveStatus: string;
  chatEnabledStatus: string;
  chatDisabledStatus: string;
  chatSelectedStatus: string;
  chatStatusPromptDetail: string;
  chatStatusAutosaveOnDetail: string;
  chatStatusAutosaveOffDetail: string;
  chatStatusToolsDetail: string;
  chatPromptSectionTitle: string;
  chatPromptSectionDesc: string;
  chatPromptLibraryDesc: string;
  chatPromptShortcutsTitle: string;
  chatPromptShortcutsDesc: string;
  chatApplyPreset: string;
  chatPromptResetDesc: string;
  chatStorageSectionTitle: string;
  chatStorageSectionDesc: string;
  chatStorageDetailsTitle: string;
  chatStorageDetailsDesc: string;
  chatToolsSectionTitle: string;
  chatToolsSectionDesc: string;
  chatToolDetailsTitle: string;
  chatToolDetailsDesc: string;
  chatAlwaysAutoWarning: string;
  mcpStatusSectionTitle: string;
  mcpStatusSectionDesc: string;
  mcpServersSectionTitle: string;
  mcpServersSectionDesc: string;
  mcpEnvironmentSectionTitle: string;
  mcpEnvironmentSectionDesc: string;
  mcpEnvironmentDetailsTitle: string;
  mcpEnvironmentDetailsDesc: string;
  mcpStatusNoServersDetail: string;
  mcpStatusSummaryDetail: string;
  mcpReconnectDesc: string;
  mcpStatusServerDetail: string;
  advancedPluginAwareTitle: string;
  advancedPluginAwareDesc: string;
  advancedEnabledStatus: string;
  advancedDisabledStatus: string;
  advancedPluginAwareOnDetail: string;
  advancedPluginAwareOffDetail: string;
  loggingMinLevel: string;
  loggingMirrorConsole: string;
  loggingMaxEntries: string;
  loggingViewerTitle: string;
  loggingViewerDesc: string;
  loggingCopyVisible: string;
  loggingClear: string;
  loggingFilterLevel: string;
  loggingFilterAllLevels: string;
  loggingFilterSource: string;
  loggingFilterSourcePlaceholder: string;
  loggingVisibleCount: string;
  loggingEmpty: string;
  loggingCopied: string;
  loggingCopyFailed: string;
  agentDiagnosticsPanelTitle: string;
  agentDiagnosticsPanelDesc: string;
  agentDiagnosticsToggle: string;
  agentDiagnosticsToggleDesc: string;
  agentDiagnosticsOpenView: string;
  agentDiagnosticsOpenViewDesc: string;
  agentDiagnosticsOpenViewButton: string;
  agentDiagnosticsFilePath: string;
  agentDiagnosticsWriteSnapshot: string;
  agentDiagnosticsWriteSnapshotDesc: string;
  agentDiagnosticsWriteButton: string;
  agentDiagnosticsClearDetailedLogging: string;
  agentDiagnosticsClearDetailedLoggingDesc: string;
  agentDiagnosticsClearButton: string;
  agentDiagnosticsViewTitle: string;
  agentDiagnosticsViewDesc: string;
  agentDiagnosticsRefreshButton: string;
  agentDiagnosticsCopyButton: string;
  agentDiagnosticsEnabledStatus: string;
  agentDiagnosticsDisabledStatus: string;
  agentDiagnosticsWriteDone: string;
  agentDiagnosticsClearDone: string;
  agentDiagnosticsCopied: string;
  agentDiagnosticsCopyFailed: string;

  // 프로바이더 탭
  apiKey: string;
  baseUrl: string;
  validateApiKey: string;
  valid: string;
  modelsFound: string;
  invalid: string;
  error: string;
  noModelsFound: string;
  enabled: string;
  providerCapabilityToolCalling: string;
  providerCapabilityToolCallingDesc: string;
  providerCapabilityReasoning: string;
  providerCapabilityReasoningDesc: string;
  providerCapabilityLiveStreaming: string;
  providerCapabilityLiveStreamingDesc: string;
  providerCapabilityNativeAbort: string;
  providerCapabilityNativeAbortDesc: string;
  providerCapabilityMaxToolRounds: string;
  providerCapabilityMaxToolRoundsDesc: string;
  providerCapabilityBufferedNoTools: string;
  providerCapabilityBuffered: string;
  providerCapabilityNoTools: string;
  providerCapabilityStreamingReasoning: string;
  providerCapabilityStreaming: string;
  providerToolCallingUnsupportedNotice: string;
  providerWaitBufferedHeadline: string;
  providerWaitBufferedDetail: string;
  providerWaitElapsedSeconds: string;
  reasoningProvidedLabel: string;
  chatRecoveryRetrySameContext: string;
  chatRecoverySwitchProvider: string;
  chatRecoveryReconnectMcp: string;
  chatRecoveryEditToolArgs: string;
  chatRecoverySkipFailedTool: string;
  chatRecoverySendWithoutRag: string;
  chatRecoverySendWithoutSourceValidation: string;
  chatRecoveryCopyDebug: string;
  turnStageDraft: string;
  turnStageBuildingContext: string;
  turnStageWaitingProvider: string;
  turnStageStreamingReasoning: string;
  turnStageStreamingAnswer: string;
  turnStagePlanningTools: string;
  turnStageAwaitingToolApproval: string;
  turnStageRunningTools: string;
  turnStageFinalizingAfterTools: string;
  turnStageComplete: string;
  turnStageCancelled: string;
  turnStageError: string;

  // RAG 탭
  embeddingProvider: string;
  embeddingProviderDesc: string;
  embeddingModel: string;
  embeddingModelDesc: string;
  embeddingModelId: string;
  embeddingModelIdDesc: string;
  save: string;
  cancel: string;
  confirmLabel: string;
  embeddingChangedNotice: string;
  embeddingSavedNotice: string;
  testConnection: string;
  testing: string;
  connectionSuccess: string;
  connectionFailed: string;
  connectionError: string;

  // RAG 통계
  indexStats: string;
  totalFiles: string;
  totalFilesDesc: string;
  indexedFiles: string;
  indexedFilesDesc: string;
  pendingFiles: string;
  pendingFilesDesc: string;
  totalVectors: string;
  totalVectorsDesc: string;
  targetFileTypes: string;
  targetFileTypesDesc: string;
  targetFileTypesEmpty: string;
  excludeRecommendations: string;
  excludeRecommendationEmpty: string;
  addExcludeExtension: string;
  addExcludeExtensionDone: string;
  refresh: string;
  loadStatsFailed: string;
  enableProviderFirst: string;
  enterApiKeyFirst: string;
  selectAndSaveModel: string;
  enterModelId: string;
  connectionFailedGeneric: string;

  // RAG 제어
  indexingControls: string;
  updatePendingFiles: string;
  reindexAll: string;
  clearEmbeddingData: string;
  confirmClear: string;
  clearSuccess: string;
  clearFailed: string;
  indexerNotInit: string;
  indexingStarted: string;
  indexingDone: string;
  indexingFailed: string;
  reindexingStarted: string;
  reindexingDone: string;
  reindexingFailed: string;
  autoUpdateIndexingStarted: string;
  autoUpdateIndexingDone: string;
  autoUpdateIndexingFailed: string;

  // RAG 옵션
  autoUpdate: string;
  autoUpdateDesc: string;
  autoUpdateInterval: string;
  autoUpdateIntervalDesc: string;
  intervalMinutes: string;
  excludePaths: string;
  excludeChatFolder: string;
  excludeChatFolderDesc: string;
  excludePathsDesc: string;
  excludeExts: string;
  excludeExtsDesc: string;
  excludeListAdd: string;
  excludeListRemove: string;
  excludeListEmpty: string;
  excludeExtFileCount: string;
  excludeExtTotalFileCount: string;
  excludePathPlaceholder: string;
  excludeExtPlaceholder: string;
  excludeInputEmpty: string;
  excludeInputTrimmed: string;
  excludeInputDuplicate: string;
  excludeInputComma: string;
  excludePathBackslash: string;
  excludePathLeadingSlash: string;
  excludePathMissingWarning: string;
  excludeExtLeadingDot: string;
  excludeExtInvalid: string;
  excludeExtProtectedDocument: string;
  chunkSize: string;
  chunkSizeDesc: string;
  ragChunkSizeOllamaWarning: string;
  ollamaEmbeddingContextError: string;
  minScore: string;
  minScoreDesc: string;
  enableBM25: string;
  enableBM25Desc: string;
  bm25Weight: string;
  bm25WeightDesc: string;
  bm25Guidance: string;

  // RAG 상태 대시보드
  ragStatusTotalDocs: string;
  ragStatusHealthy: string;
  ragStatusUpdateRequired: string;
  ragStatusTotalVectors: string;
  ragStatusCurrentState: string;
  ragStatusAutoUpdate: string;

  // RAG 배너
  ragBannerNeedsUpdate: string;
  ragBannerIndexing: string;
  ragBannerLatest: string;
  ragBannerNoDocs: string;
  ragBannerPaused: string;
  ragWorkflowStatusTitle: string;
  ragWorkflowStatusDetail: string;
  ragWorkflowEmbeddingTitle: string;
  ragWorkflowEmbeddingDetail: string;
  ragWorkflowIndexTitle: string;
  ragWorkflowIndexDetail: string;
  ragWorkflowTuneTitle: string;
  ragWorkflowTuneDetail: string;
  ragLocalEmbeddingTitle: string;
  ragLocalEmbeddingDetail: string;
  ragStatusSectionDescription: string;
  ragFoundationTitle: string;
  ragFoundationDescription: string;
  ragGraphSectionDescription: string;
  ragGraphDisclosureTitle: string;
  ragGraphDisclosureDescription: string;
  ragDiagnosticsTitle: string;
  ragDiagnosticsDescription: string;
  ragDiagnosticsDisclosureTitle: string;
  ragOverviewTitle: string;
  ragOverviewReady: string;
  ragOverviewNeedsUpdate: string;
  ragOverviewEmpty: string;
  ragOverviewDetail: string;
  ragOverviewUnavailable: string;
  ragOverviewFixEmbedding: string;
  ragOverviewCheckProvider: string;
  ragRecoverySummary: string;
  ragRecoveryDescription: string;
  graphRagOverviewTitle: string;
  graphRagOverviewDetail: string;
  graphRagDetailsSummary: string;
  graphRagQueryModeLabel: string;
  graphRagQueryAutoLabel: string;
  graphRagQueryLocalLabel: string;
  graphRagQueryGlobalLabel: string;
  graphRagQueryHybridLabel: string;
  graphRagMergeThresholdLabel: string;
  graphRagPendingMergeLabel: string;
  graphRagModularityDetail: string;

  // RAG 버튼
  btnUpdatePending: string;
  btnReindexAll: string;
  btnCancelIndexing: string;
  btnResumeIndexing: string;
  btnResetEmbeddings: string;

  // RAG 필터
  filterAll: string;
  filterMissing: string;
  filterStale: string;
  filterUnknown: string;
  loadMore: string;
  loadAll: string;

  // RAG 배치
  batchAddExclude: string;
  selectAll: string;
  deselectAll: string;

  // 연결 배지
  connectionConnected: string;
  connectionTesting: string;

  // 진행률
  progressLabel: string;

  // 채팅 탭
  chatTabTitle: string;
  toolbarTools: string;
  sendButton: string;
  chatSaveFolder: string;
  chatSaveFolderDesc: string;
  systemPrompt: string;
  systemPromptDesc: string;
  systemPromptPlaceholder: string;
  promptLibraryOpen: string;
  mcpToolExecutionPolicy: string;
  mcpToolExecutionPolicyDesc: string;
  mcpToolExecutionMentionedAuto: string;
  mcpToolExecutionAlwaysManual: string;
  mcpToolExecutionAlwaysAuto: string;
  resetToDefault: string;
  chatClear: string;
  chatScrollToBottom: string;
  chatTyping: string;
  copyCode: string;
  copied: string;
  toolResult: string;
  executeTool: string;
  toolArgs: string;
  selectTool: string;
  noToolsAvailable: string;
  messageUser: string;
  messageAssistant: string;
  messageSystem: string;
  messageTool: string;
  timestampJustNow: string;
  timestampMinutesAgo: string;
  timestampHoursAgo: string;
  timestampDaysAgo: string;
  sessionPromptModified: string;
  mcpToolRunning: string;
  mcpToolSuccess: string;
  mcpToolError: string;
  mcpToolValidationError: string;
  mcpToolInvalidField: string;
  mcpMentionServers: string;
  mcpMentionFiles: string;
  mcpMentionFolders: string;
  reasoningLabel: string;
  toolCallLabel: string;
  answerLabel: string;
  thinkingPlaceholder: string;
  enforceMcpTools: string;
  enforceMcpToolsDesc: string;
  modelSelector: string;
  mcpRefresh: string;
  mcpReconnect: string;
  mcpRefreshing: string;
  mcpConnecting: string;
  mcpPartialError: string;
  mcpNoActiveServers: string;
  mcpActiveServers: string;
  quickPresetGeneral: string;
  quickPresetCodeReview: string;
  quickPresetTranslate: string;
  quickPresetSummarize: string;
  chatMcpReconnectFailedNotice: string;
  chatMcpReconnectFailedDetail: string;
  chatMcpReconnectCompleteNotice: string;
  chatSearchButton: string;
  chatMessageSearchAria: string;
  chatInputPlaceholder: string;
  chatMessageSearchPrompt: string;
  chatAutoRagChip: string;
  chatFolderMentionChip: string;
  chatFileMentionChip: string;
  chatReadinessProviderMissing: string;
  chatReadinessProviderMissingDetail: string;
  chatReadinessModelMissing: string;
  chatReadinessModelMissingDetail: string;
  chatReadinessRagIndexing: string;
  chatReadinessRagIndexingDetail: string;
  chatReadinessRagNotReady: string;
  chatReadinessRagNotReadyDetail: string;
  chatReadinessPrepareDocuments: string;
  chatReadinessSelectModelAction: string;
  chatReadinessConfigureProviderAction: string;
  chatEmptyStateTitle: string;
  chatEmptyStateDetail: string;
  chatEmptyStatePromptSummary: string;
  chatEmptyStatePromptConnections: string;
  chatReadinessMcpPartial: string;
  chatReadinessMcpPartialDetail: string;
  chatReadinessSaveFolderMissing: string;
  chatReadinessSaveFolderMissingDetail: string;
  chatReadinessReady: string;
  chatReadinessBlocked: string;
  chatReadinessDegraded: string;
  composerDraftRestoredNotice: string;
  chatToolMentionChip: string;
  contextAttachmentAttached: string;
  contextAttachmentPartial: string;
  contextAttachmentMissing: string;
  contextAttachmentError: string;
  contextAttachmentLowRelevance: string;
  contextAttachmentExcluded: string;
  contextAttachmentChars: string;
  contextNoteSingular: string;
  contextNotePlural: string;
  contextItemSingular: string;
  contextItemPlural: string;
  contextChipRelatedNotes: string;
  contextChipNoRelatedNotes: string;
  contextChipVaultSearchSkipped: string;
  contextChipKnowledgeGraph: string;
  contextChipKnowledgeGraphMissing: string;
  contextChipFolderNotesUsed: string;
  contextChipFileAttached: string;
  contextChipReferenceAttached: string;
  contextChipToolReady: string;
  contextChipToolUnavailable: string;
  contextChipDetailAuto: string;
  contextChipDetailSkipped: string;
  contextChipDetailShortened: string;
  contextBudgetItemsPrepared: string;
  contextBudgetItemsLeftOut: string;
  contextBudgetUsage: string;
  contextBudgetTruncated: string;
  contextBudgetIncludedExcluded: string;
  dataBoundaryTitle: string;
  dataBoundaryProvider: string;
  dataBoundaryMcp: string;
  dataBoundaryLocal: string;
  dataBoundarySystemPrompt: string;
  dataBoundaryAttachedContext: string;
  dataBoundaryCitationPreview: string;
  dataBoundaryDraftStore: string;
  dataBoundarySourceCardState: string;
  dataBoundaryExcludedAttachmentNote: string;
  dataBoundaryExcludedAttachmentNoteSingular: string;
  dataBoundaryExcludedAttachmentNotePlural: string;
  sourceStatusVerified: string;
  sourceStatusCandidate: string;
  sourceStatusMissing: string;
  sourceStatusStale: string;
  sourceStatusLowRelevance: string;
  sourceRepairAction: string;
  sourceRepairPrompt: string;
  sourceGraphEntity: string;
  sourceGraphRelation: string;
  sourceGraphCommunity: string;
  sourceLineMeta: string;
  sourceEndLineMeta: string;
  sourceRelevanceMeta: string;
  sourcePreviewTruncated: string;
  sourceReasonStrongGraph: string;
  sourceReasonGraphStructural: string;
  sourceReasonKeywordVector: string;
  sourceReasonKeyword: string;
  sourceReasonVector: string;
  sourceReasonHybrid: string;
  citationMarkerAria: string;
  variantCompareTitle: string;
  variantCompareActive: string;
  variantCompareRow: string;
  chatGenerationStopped: string;
  vaultResearchProgress: string;
  vaultResearchPhaseInventory: string;
  vaultResearchPhaseMap: string;
  vaultResearchPhaseReduce: string;
  vaultResearchPhaseComplete: string;
  nativeVaultActionSearch: string;
  nativeVaultActionRead: string;
  nativeVaultActionList: string;
  nativeVaultActionLinks: string;
  nativeVaultActionStats: string;
  nativeVaultPlanUnavailable: string;
  nativeVaultInvalidJson: string;
  nativeVaultUnsupportedAction: string;
  nativeVaultQueryRequired: string;
  nativeVaultPathRequired: string;
  nativeVaultInvalidPath: string;
  nativeVaultInvalidLineRange: string;
  nativeVaultInvalidDirection: string;
  nativeVaultInvalidArguments: string;
  nativeVaultSearchDisplay: string;
  nativeVaultReadDisplay: string;
  nativeVaultListDisplay: string;
  nativeVaultLinksDisplay: string;
  nativeVaultStatsDisplay: string;
  nativeVaultFileNotFound: string;
  nativeVaultReadRangeFailed: string;
  nativeVaultListFailed: string;
  nativeVaultStatsFailed: string;
  nativeVaultSearchScopeFailed: string;
  vaultResearchListStalled: string;
  vaultResearchBatchPlanFailed: string;
  vaultResearchEmptySummary: string;
  vaultResearchInvalidListResult: string;
  vaultResearchInvalidListItem: string;
  vaultResearchInvalidListPage: string;
  vaultResearchInvalidReadResult: string;
  vaultResearchCancelled: string;
  vaultResearchCoverageWarning: string;
  vaultResearchFailurePlanFailed: string;
  toolLoopPolicyUnavailable: string;
  repeatedToolCallBlocked: string;
  chatGeneratingResponse: string;
  assistantQuestionReasoningTitle: string;
  assistantQuestionSelectionTitle: string;
  assistantQuestionFreeTextPlaceholder: string;
  assistantQuestionCompleteSelection: string;
  assistantQuestionSendAnswer: string;
  assistantQuestionRequiredNotice: string;
  toolApproveExecution: string;
  sourceVerifiedCount: string;
  sourceCitationSelectionFailed: string;
  sourceSearchVerifiedCount: string;
  sourceOpenAction: string;
  sourceCopyLinkAction: string;
  sourceInsertIntoNoteAction: string;
  sourceOpenedNotice: string;
  sourceOpenFailedNotice: string;
  sourceCopyLinkFailedNotice: string;
  sourceInsertFailedNotice: string;
  sourceUnverifiedCount: string;
  sourceFileNotFound: string;
  sourceUnverifiedCandidate: string;
  sourceInsertedNotice: string;
  sourceInsertBlock: string;
  messageCopyAction: string;
  messageRetryAction: string;
  messageInsertIntoNoteAction: string;
  messageNewNoteAction: string;
  messageBranchAction: string;
  messageEditAndSendAction: string;
  activeNoteMissingNotice: string;
  messageInsertedNotice: string;
  messageCopyFailedNotice: string;
  messageInsertFailedNotice: string;
  sourceWarningIncluded: string;
  aiAnswerTitle: string;
  savedAsNewNoteNotice: string;
  savedAsNewNoteFailedNotice: string;
  branchSessionCreatedNotice: string;
  branchSessionMissingNotice: string;
  branchSessionFailedNotice: string;
  regenerationTargetMissingNotice: string;
  chatStatusIdle: string;
  chatStatusRunning: string;
  chatStatusDone: string;
  chatStatusError: string;
  deletedSessionResetNotice: string;
  chatAutoSaveFailedLog: string;
  chatLoadFailedNotice: string;
  providerPathRequiredSuffix: string;
  defaultModelMissingNotice: string;
  modelSettingInvalid: string;
  customModelSettingInvalid: string;
  customProviderDisabled: string;
  noActiveProviderNotice: string;
  mcpRetryToolUseNotice: string;
  mcpRetryNoToolUseNotice: string;
  mcpApprovalRequiredNotice: string;
  llmApiError: string;
  stopButton: string;
  stopAllButton: string;
  chatRunActive: string;
  assistantQuestionProviderContent: string;
  mcpToolFinalAnswerMissing: string;
  cancelledLabel: string;
  tooManyToolCalls: string;
  mcpResultMessageMissing: string;
  customProviderNotFound: string;
  validationNeedsNumber: string;
  validationMinValue: string;
  validationMaxValue: string;
  validationRequiredValue: string;
  validationPatternDetail: string;
  mcpValidationSchemaFailed: string;
  mcpValidationRequiredMissing: string;
  apiHintBadRequest: string;
  apiHintUnauthorized: string;
  apiHintPaymentRequired: string;
  apiHintForbidden: string;
  apiHintNotFound: string;
  apiHintRateLimited: string;
  apiHintServerError: string;
  apiHintBadGateway: string;
  apiHintServiceUnavailable: string;
  apiHintFetchCors: string;
  apiErrorCode: string;
  apiErrorLikelyCause: string;
  apiErrorRaw: string;

  chatNewSession: string;
  chatHistory: string;
  chatSessionTitle: string;
  chatRenameSession: string;
  chatDeleteSession: string;
  chatDeleteConfirm: string;
  chatLoadSession: string;
  chatAutoSave: string;
  chatAutoSaveDesc: string;
  chatAutoSaveDelay: string;
  chatAutoSaveDelayDesc: string;
  chatNoSavedSessions: string;
  chatUnsavedChanges: string;
  chatGroupToday: string;
  chatGroupYesterday: string;
  chatGroupThisWeek: string;
  chatGroupThisMonth: string;
  chatGroupOlder: string;
  chatSearchPlaceholder: string;
  chatNoSearchResults: string;
  chatCurrentSession: string;
  chatSessionCount: string;
  chatMessageUnit: string;
  chatDaysAgo: string;
  chatSessionRenamedNotice: string;
  chatSessionRenameFailedNotice: string;
  chatSessionRenameNoChangeNotice: string;
  chatSessionRenameEmptyNotice: string;
  chatSessionDeletedNotice: string;
  chatSessionDeleteFailedNotice: string;

  settingsAuto001: string;
  settingsAuto002: string;
  settingsAuto003: string;
  settingsAuto004: string;
  settingsAuto005: string;
  settingsAuto006: string;
  settingsAuto007: string;
  settingsAuto008: string;
  settingsAuto022: string;
  settingsAuto024: string;
  settingsAuto025: string;
  settingsAuto026: string;
  settingsAuto027: string;
  settingsAuto028: string;
  settingsAuto029: string;
  settingsAuto030: string;
  settingsAuto030Desc: string;
  settingsAuto031: string;
  settingsAuto032: string;
  settingsAuto033: string;
  settingsAuto034: string;
  settingsAuto035: string;
  settingsAuto036: string;
  settingsAuto036Desc: string;
  settingsAuto037: string;
  settingsAuto038: string;
  settingsAuto039: string;
  settingsAuto040: string;
  settingsAuto041: string;
  settingsAuto042: string;
  settingsAuto043: string;
  settingsAuto044: string;
  settingsAuto045: string;
  settingsAuto046: string;
  settingsAuto047: string;
  settingsAuto048: string;
  settingsAuto049: string;
  settingsAuto050: string;
  settingsAuto051: string;
  settingsAuto052: string;
  settingsAuto053: string;
  settingsAuto054: string;
  settingsAuto055: string;
  graphRagConcurrentRequestsLabel: string;
  graphRagConcurrentRequestsDesc: string;
  settingsAuto056: string;
  settingsAuto057: string;
  settingsAuto058: string;
  settingsAuto059: string;
  settingsAuto060: string;
  settingsAuto061: string;
  settingsAuto062: string;
  settingsAuto063: string;
  settingsAuto064: string;
  settingsAuto065: string;
  settingsAuto066: string;
  settingsAuto067: string;
  settingsAuto068: string;
  settingsAuto069: string;
  settingsAuto070: string;
  settingsAuto071: string;
  settingsAuto072: string;
  settingsAuto073: string;
  settingsAuto074: string;
  settingsAuto075: string;
  settingsAuto076: string;
  settingsAuto077: string;
  settingsAuto078: string;
  settingsAuto079: string;
  settingsAuto080: string;
  settingsAuto081: string;
  settingsAuto082: string;
  settingsAuto083: string;
  settingsAuto084: string;
  settingsAuto085: string;
  settingsAuto086: string;
  settingsAuto087: string;
  settingsAuto088: string;
  settingsAuto089: string;
  settingsAuto090: string;
  settingsAuto091: string;
  settingsAuto092: string;
  settingsAuto093: string;
  settingsAuto094: string;
  settingsAuto095: string;
  settingsAuto096: string;
  settingsAuto097: string;
  settingsAuto098: string;
  settingsAuto099: string;
  settingsAuto100: string;
  settingsAuto101: string;
  settingsAuto102: string;
  settingsAuto103: string;
  settingsAuto104: string;
  settingsAuto105: string;
  settingsAuto106: string;
  settingsAuto107: string;
  settingsAuto108: string;
  settingsAuto109: string;
  settingsAuto110: string;
  settingsAuto111: string;
  settingsAuto112: string;
  settingsAuto113: string;
  settingsAuto114: string;
  settingsAuto115: string;
  settingsAuto116: string;
  settingsAuto117: string;
  settingsAuto118: string;
  settingsAuto119: string;
  settingsAuto120: string;
  settingsAuto121: string;
  settingsAuto122: string;
  settingsAuto123: string;
  settingsAuto124: string;
  settingsAuto125: string;
  settingsAuto126: string;
  settingsAuto127: string;
  settingsAuto128: string;
  settingsAuto129: string;
  settingsAuto130: string;
  settingsAuto131: string;
  settingsAuto132: string;
  settingsAuto133: string;
  settingsAuto134: string;
  settingsAuto135: string;
  settingsAuto136: string;
  settingsAuto137: string;
  settingsAuto138: string;
  settingsAuto139: string;
  settingsAuto140: string;
  settingsAuto141: string;
  settingsAuto142: string;
  settingsAuto143: string;
  settingsAuto144: string;
  settingsAuto145: string;
  settingsAuto146: string;
  settingsAuto147: string;
  settingsAuto148: string;
  settingsAuto149: string;
  settingsAuto150: string;
  settingsAuto151: string;
  settingsAuto152: string;
  settingsAuto153: string;
  settingsAuto154: string;
  settingsAuto155: string;
  settingsAuto156: string;
  settingsAuto157: string;
  settingsAuto158: string;
  settingsAuto159: string;
  settingsAuto160: string;
  settingsAuto161: string;
  settingsAuto162: string;
  settingsAuto163: string;
  settingsAuto164: string;
  settingsAuto165: string;
  settingsAuto166: string;
  settingsAuto167: string;
  settingsAuto168: string;
  settingsAuto169: string;
  settingsAuto170: string;
  settingsAuto171: string;
  settingsAuto172: string;
  settingsAuto173: string;
  settingsAuto174: string;
  settingsAuto175: string;
  settingsAuto176: string;
  settingsAuto177: string;
  settingsAuto178: string;
  settingsAuto179: string;
  settingsAuto180: string;
  settingsAuto181: string;
  settingsAuto182: string;
  settingsAuto183: string;
  settingsAuto184: string;
  settingsAuto185: string;
  settingsAuto186: string;
  settingsAuto187: string;
  settingsAuto188: string;
  settingsAuto189: string;
  settingsAuto190: string;
  settingsAuto191: string;
  settingsAuto192: string;
  settingsAuto193: string;
  settingsAuto194: string;
  settingsAuto195: string;
  settingsAuto196: string;
  settingsAuto197: string;
  settingsAuto198: string;
  settingsAuto199: string;
  settingsAuto200: string;
  settingsAuto201: string;
  settingsAuto202: string;
  settingsAuto203: string;
  settingsAuto204: string;
  settingsAuto205: string;
  settingsAuto206: string;
  settingsAuto207: string;
  settingsAuto208: string;
  settingsAuto209: string;
  settingsAuto210: string;
  settingsAuto211: string;
  settingsAuto212: string;
  settingsAuto213: string;
  settingsAuto214: string;
  settingsAuto215: string;
  settingsAuto216: string;
  settingsAuto217: string;
  settingsAuto218: string;
  settingsAuto219: string;
  settingsAuto220: string;
  settingsAuto221: string;
  settingsAuto222: string;
  settingsAuto223: string;
  settingsAuto224: string;
  settingsAuto225: string;
  settingsAuto226: string;
  settingsAuto227: string;
  settingsAuto228: string;
  settingsAuto229: string;
  settingsAuto230: string;
  settingsAuto231: string;
  settingsAuto232: string;
  settingsAuto233: string;
  settingsAuto234: string;
  settingsAuto235: string;
  settingsAuto236: string;
  settingsAuto237: string;
  settingsAuto238: string;
  settingsAuto239: string;
  settingsAuto240: string;
  settingsAuto241: string;
  settingsAuto242: string;
  settingsAuto243: string;
  settingsAuto244: string;
  settingsAuto245: string;
  settingsAuto246: string;
  settingsAuto247: string;
  settingsAuto248: string;
  settingsAuto249: string;
  settingsAuto250: string;
  settingsAuto251: string;
  settingsAuto252: string;
  settingsAuto253: string;
  settingsAuto254: string;
  settingsAuto255: string;
  settingsAuto256: string;
  settingsAuto257: string;
  settingsAuto258: string;
  settingsAuto259: string;
  settingsAuto260: string;
  settingsAuto261: string;
  settingsAuto262: string;
  settingsAuto263: string;
  settingsAuto264: string;
  settingsAuto265: string;
  settingsAuto266: string;
  settingsAuto267: string;
  settingsAuto268: string;
  settingsAuto269: string;
  settingsAuto270: string;
  settingsAuto271: string;
  settingsAuto272: string;
  settingsAuto273: string;
  settingsAuto274: string;

  // MCP PATH
  mcpPathTitle: string;
  mcpPathDesc: string;
  mcpPathFetch: string;
  mcpPathFetching: string;
  mcpPathFetchSuccess: string;
  mcpPathFetchError: string;
  mcpPathFetchErrorHelp: string;
  mcpPathPlaceholder: string;
  mcpPathCommandNotFoundHint: string;
  mcpIncludeWslPath: string;
  mcpIncludeWslPathDesc: string;

  // MCP 탭
  mcpCommand: string;
  mcpCommandDesc: string;
  mcpArgs: string;
  mcpArgsDesc: string;
  addMcpServer: string;
  deleteMcpServer: string;
  mcpStatus: string;
  mcpTotalActive: string;
  mcpConnected: string;
  mcpDisconnected: string;
  mcpConnectionFailed: string;
  mcpConnectionHealth: string;
  mcpNoServers: string;
  mcpInitFailed: string;
  mcpStatusConnected: string;
  mcpStatusConnecting: string;
  mcpStatusDisconnected: string;
  mcpStatusError: string;
  mcpJsonEditor: string;
  mcpJsonSaved: string;
  mcpJsonInvalid: string;
  mcpJsonInvalidObject: string;
  mcpJsonMissingMcpServers: string;
  mcpJsonInvalidMcpServers: string;
  mcpJsonInvalidServerValue: string;
  mcpJsonServerNeedsCommand: string;
  mcpJsonInvalidArgs: string;
  mcpJsonInvalidEnv: string;
  mcpJsonInvalidArray: string;
  mcpJsonLinting: string;
  mcpJsonLintOk: string;
  mcpJsonLintError: string;
  mcpJsonSchemaError: string;
  mcpJsonLine: string;
  mcpJsonAutoSave: string;
  mcpJsonAutoSaveDesc: string;
  totalLabel: string;

  // 설정 헤더
  settingsTitle: string;
  securityWarning: string;

  // 탭
  tabGeneral: string;
  tabProviders: string;
  // Providers tab common actions
  collapseAll: string;
  expandAll: string;
  modelCountBadge: string;
  noProviderEnabledBanner: string;
  providerConnectionSection: string;
  providerDetailContextLabel: string;
  providerModelsSection: string;
  providerActionsSection: string;
  selectedOnly: string;
  fetchModels: string;
  testGeneration: string;
  providerCommandCenterTitle: string;
  providerCommandCenterDesc: string;
  providerConnectionTitle: string;
  providerSummaryLine: string;
  providerSummaryNoProfiles: string;
  providerStatusSectionTitle: string;
  providerStatusSectionDesc: string;
  providerStatusNone: string;
  providerStatusNeedsSetup: string;
  providerStatusSummaryDetail: string;
  providerAttentionTitle: string;
  providerContinueSetup: string;
  providerAddTitle: string;
  providerAddDesc: string;
  providerConnectionsSectionTitle: string;
  providerConnectionsSectionDesc: string;
  providerConnectionsEmpty: string;
  providerNewName: string;
  providerDangerTitle: string;
  providerDangerDesc: string;
  providerRemoveWarning: string;
  providerRemoveConfirm: string;
  providerRemoved: string;
  providerModelCountLine: string;
  providerApiKeyShow: string;
  providerApiKeyHide: string;
  providerDashboardReady: string;
  providerDashboardReadyDetail: string;
  providerDashboardAttention: string;
  providerDashboardAttentionDetail: string;
  providerDashboardEnabled: string;
  providerDashboardEnabledDetail: string;
  providerDashboardModels: string;
  providerDashboardModelsDetail: string;
  providerSetupEnableTitle: string;
  providerSetupEnableDetail: string;
  providerSetupAuthTitle: string;
  providerSetupAuthDetail: string;
  providerSetupModelsTitle: string;
  providerSetupModelsDetail: string;
  providerSetupValidateTitle: string;
  providerSetupValidateDetail: string;
  providerStatusReady: string;
  providerStatusNeedsKey: string;
  providerStatusNeedsModels: string;
  providerStatusOff: string;
  providerSummaryReady: string;
  providerSummaryNeedsKey: string;
  providerSummaryNeedsModels: string;
  providerSummaryOff: string;
  providerKeyReady: string;
  providerKeyMissing: string;
  providerKeyNotRequired: string;
  providerModelChatVerified: string;
  providerModelChatUnknown: string;
  providerModelChatFailed: string;
  providerModelEmbeddingVerified: string;
  providerModelEmbeddingUnknown: string;
  providerModelEmbeddingFailed: string;
  providerTestChatModel: string;
  providerTestEmbeddingModel: string;
  providerEmbeddingUnsupported: string;
  providerModelsSelected: string;
  providerNoModelsShort: string;
  providerTypeBuiltIn: string;
  providerTypeCustom: string;
  providerQuickKey: string;
  providerQuickModels: string;
  providerQuickType: string;
  providerCustomDockTitle: string;
  providerCustomDockDesc: string;
  providerStrategyLabel: string;
  providerStrategyDesc: string;
  providerBaseUrl: string;
  providerGeneralModels: string;
  providerEmbeddingModels: string;
  providerGeneralModelsDesc: string;
  providerEmbeddingModelsDesc: string;
  providerAddGeneralModel: string;
  providerAddEmbeddingModel: string;
  providerImportModelsTitle: string;
  providerImportModelsDesc: string;
  providerImportSearchPlaceholder: string;
  providerImportAddSelected: string;
  providerImportCount: string;
  providerImportNoNewModels: string;
  providerImportNoMatches: string;
  providerImportContext: string;
  providerImportMoreResults: string;
  providerImportAdded: string;
  tabRag: string;
  tabChat: string;
  tabMcp: string;
  tabAdvanced: string;

  // 명령어
  mcpAutoConnectFailedCount: string;
  mcpAutoConnectFailedMessage: string;
  ragIndexerNotInitializedBase: string;
  ragIndexerEnableProvider: string;
  ragIndexerEnterApiKey: string;
  ragIndexerSelectEmbeddingModel: string;
  ragIndexerConnectionFailed: string;
  ragIndexerLastInitError: string;
  ragIndexerLastInitSkipped: string;
  ragRuntimeInitStepTimedOut: string;
  vaultIndexingStarted: string;
  vaultIndexingDone: string;
  indexingCancelled: string;
  indexingFailedWithMessage: string;
  ragIdle: string;
  ragStatsFailed: string;
  graphRagAutoSyncStarted: string;
  graphRagAutoSyncDone: string;
  graphRagStaleSyncStatusNotice: string;
  graphRagRunNoopNotice: string;
  graphRagFailedRetryNoopNotice: string;
  graphRagStaleSyncNoopNotice: string;
  ragPerformancePaused: string;
  ragPerformanceThrottled: string;
  ragIndexingInProgress: string;
  ragIndexingRunning: string;
  ragIndexingRunningWithEta: string;
  ragIndexingRunningWithApproxEta: string;
  ragIndexingRunningEtaCalculating: string;
  ragIndexingRunningWithEtaReason: string;
  ragIndexingRunningWithApproxEtaReason: string;
  ragIndexingRunningEtaCalculatingReason: string;
  ragEtaReasonComplete: string;
  ragEtaReasonPlannedStable: string;
  ragEtaReasonPlannedVariableRate: string;
  ragEtaReasonPlannedPartial: string;
  ragEtaReasonInsufficientSamples: string;
  ragEtaReasonCalibrationVariable: string;
  ragEtaReasonCalibratedEstimate: string;
  ragEtaReasonBatchRateOnly: string;
  ragEtaReasonElapsedRateOnly: string;
  ragIndexingResult: string;
  ragPhaseFile: string;
  ragPhasePending: string;
  ragPhaseAll: string;
  ragPhaseIdle: string;
  ragAutoUpdateAlreadyRunning: string;
  ragAutoUpdatePausedRetry: string;
  ragAutoUpdateNoTargets: string;
  vectorStoreDescriptionJson: string;
  vectorStoreDescriptionIndexedDb: string;
  vectorStoreTransferToIndexedDb: string;
  vectorStoreTransferToJson: string;
  unsetLabel: string;
  chatFolderExcludeCurrentDesc: string;
  ragNoUpdates: string;
  ragNoDocuments: string;
  ragNoPendingUpdatesNotice: string;
  ragNoDocumentsNotice: string;
  ragIndexCancelRequestedNotice: string;
  ragIndexResumeRequestedNotice: string;
  ragNoRunningIndexing: string;
  ragNotPerformancePaused: string;
  graphRagStatusDisabledLabel: string;
  graphRagStatusDisabledDesc: string;
  graphRagStatusNotBuiltLabel: string;
  graphRagStatusNotBuiltDesc: string;
  graphRagStatusBuildingLabel: string;
  graphRagStatusBuildingDesc: string;
  graphRagStatusReadyLabel: string;
  graphRagStatusReadyDesc: string;
  graphRagStatusStaleLabel: string;
  graphRagStatusStaleDesc: string;
  graphRagStatusPartialLabel: string;
  graphRagStatusPartialDesc: string;
  graphRagDisabledReason: string;
  graphRagProviderMissingReason: string;
  graphRagModelMissingReason: string;
  graphRagAlreadyRunningReason: string;
  graphRagNoFilesReason: string;
  graphRagNoRunningReason: string;
  graphRagNoFailedReason: string;
  graphRagLiveStatusRunningTitle: string;
  graphRagLiveStatusIdleTitle: string;
  graphRagLiveStatusIdleDetail: string;
  graphRagLiveChunkDetail: string;
  graphRagLiveChunkDetailWithFailed: string;
  graphRagLiveStorageDetail: string;
  graphRagPhaseIdle: string;
  graphRagPhaseSelectingFiles: string;
  graphRagPhaseCheckingCache: string;
  graphRagPhaseApiWaiting: string;
  graphRagPhaseApiResponseReceived: string;
  graphRagPhaseApiResponseNormalizing: string;
  graphRagPhaseStoringResults: string;
  graphRagPhaseFileCompleted: string;
  graphRagPhaseBuildingCommunities: string;
  graphRagPhaseCompleted: string;
  graphRagPhaseCancelled: string;
  graphRagStartScopeLimited: string;
  graphRagStartScopeAll: string;
  graphRagActionExtract: string;
  graphRagStartAll: string;
  graphRagStartDescription: string;
  graphRagCancel: string;
  graphRagCancelDesc: string;
  graphRagResumeFailed: string;
  graphRagResumeFailedWithCount: string;
  graphRagResumeFailedDesc: string;
  graphRagSyncStale: string;
  graphRagSyncStaleWithCount: string;
  graphRagSyncStaleDesc: string;
  graphRagMaintain: string;
  graphRagBuildCommunities: string;
  graphRagBuildCommunitiesDesc: string;
  graphRagResetData: string;
  graphRagResetDataDesc: string;
  graphRagResetDataConfirm: string;
  graphRagResetDataDone: string;
  graphRagResetDataFailed: string;
  graphRagInspect: string;
  graphRagOpenExplorer: string;
  graphRagOpenExplorerDesc: string;
  graphRagCostLocal: string;
  graphRagCostRemote: string;
  embeddingDimensionsLabel: string;
  embeddingProviderModelDesc: string;
  embeddingCurrentLabel: string;
  embeddingCurrentDesc: string;
  overviewProviderOff: string;
  overviewProviderKeyNeeded: string;
  overviewProviderNoModels: string;
  overviewReady: string;
  overviewModelsCount: string;
  overviewDisabled: string;
  overviewProviderMissingKeyDetail: string;
  overviewProviderNoModelsDetail: string;
  overviewProviderModelsSelected: string;
  overviewProviderDisabledDetail: string;
  overviewProviderCheckModels: string;
  overviewProviderSummaryDetail: string;
  overviewProviderNoneActive: string;
  overviewRunning: string;
  overviewBeforeCalculation: string;
  overviewRagNotCalculatedDetail: string;
  overviewNoTargets: string;
  overviewNeedsCount: string;
  overviewLatest: string;
  overviewNoIndexingTargetFiles: string;
  overviewRagNeedsDetail: string;
  overviewRagHealthyDetail: string;
  overviewSyncRequired: string;
  overviewGraphRagDisabledDetail: string;
  overviewNeedsSetup: string;
  overviewGraphRagRunnerMissing: string;
  overviewGraphRagExtractingDetail: string;
  overviewGraphRagNotCalculated: string;
  overviewGraphRagEvidenceReady: string;
  overviewGraphRagStaleValue: string;
  overviewGraphRagStaleDetail: string;
  overviewGraphRagPartialDetail: string;
  overviewNotReady: string;
  overviewGraphRagNeedIndexing: string;
  overviewToolCallReady: string;
  overviewConnectionCheck: string;
  overviewNone: string;
  overviewNoServers: string;
  overviewPartialError: string;
  overviewError: string;
  overviewConnected: string;
  overviewConnecting: string;
  overviewDisconnected: string;
  overviewMcpNoServersDetail: string;
  overviewMcpErrorsDetail: string;
  overviewMcpAllConnected: string;
  overviewMcpSomeDisconnected: string;
  overviewChatDefaultModel: string;
  overviewChatDefaultUnavailable: string;
  overviewProviderApiKeyNeeded: string;
  overviewChatModelAttention: string;
  overviewRagSyncAttention: string;
  overviewMcpErrorAttention: string;
  overviewGraphRagErrorAttention: string;
  overviewEmbeddingLabel: string;
  overviewOpenProviders: string;
  overviewOpenGeneral: string;
  overviewOpenRag: string;
  overviewOpenMcp: string;
  pluginDataResetTitle: string;
  pluginDataResetDesc: string;
  pluginDataResetWarning: string;
  pluginDataResetScope: string;
  pluginDataResetButton: string;
  pluginDataResetRunning: string;
  pluginDataResetConfirm: string;
  pluginDataResetSecondConfirm: string;
  pluginDataResetDone: string;
  pluginDataResetFailed: string;
  mcpToolNotFoundInConnectedServers: string;
  mcpServerNotConnected: string;
  mcpRegistryUnavailableNotice: string;
  mcpClientUnavailableNotice: string;
  mcpToolErrorPrefix: string;
  mcpToolEmptyResult: string;
  mcpValidationPattern: string;
  mcpValidationField: string;
  mcpValidationGeneric: string;
  refreshAlreadyRunning: string;
  refreshFailedWithMessage: string;
  refreshCancelled: string;
  mcpNoExecutableShell: string;
  mcpNoPowerShellPath: string;
  mcpDesktopOnly: string;
  apiKeyUnauthorizedError: string;
  endpointOrModelNotFoundError: string;
  serverStatusError: string;
  apiStatusError: string;
  connectionFailedNoServer: string;
  customProviderBaseUrlHint: string;
  customProviderBaseUrlRequired: string;
  ollamaEmbeddingContextTooLong: string;
  ragStatusMissingReason: string;
  ragStatusLegacyReason: string;
  ragStatusStaleFileReason: string;
  ragStatusEmbeddingChangedReason: string;
  ragStatusHealthyReason: string;
  perfGuardResumed: string;
  perfEventLoopLag: string;
  perfIndexingBatch: string;
  perfSlowDetected: string;
  perfPausedWithReason: string;
  ragExcludeSensitiveReason: string;
  ragExcludeUnreadableReason: string;
  noExtensionLabel: string;
  assistantQuestionPrefix: string;
  assistantQuestionSelectedItems: string;
  assistantQuestionAdditionalInput: string;
  editMessageTitle: string;
  sourceUnverifiedIdWarning: string;
  sourceMissingVaultLinkWarning: string;
  referenceMissingWarning: string;
  referenceReadFailedWarning: string;
  pluginAwareContext7FirstRule: string;
  pluginAwareContext7NoGuessRule: string;
  defaultChatTitle: string;
  chatSaveEmptyAssistantWarning: string;
  fileNotFoundError: string;
  toolResultTruncatedLabel: string;
  toolApprovalPendingSuffix: string;
  rejectedFactInvalidJsonTitle: string;
  rejectedFactInvalidJsonDesc: string;
  rejectedFactUnknownEntityTitle: string;
  rejectedFactUnknownEntityDesc: string;
  rejectedFactSchemaShapeTitle: string;
  rejectedFactSchemaShapeDesc: string;
  rejectedFactUnknownRelationEntityTitle: string;
  rejectedFactUnknownRelationEntityDesc: string;
  rejectedFactRelationMismatchTitle: string;
  rejectedFactRelationMismatchDesc: string;
  rejectedFactUnknownClaimTitle: string;
  rejectedFactUnknownClaimDesc: string;
  rejectedFactExtractionErrorTitle: string;
  rejectedFactExtractionErrorDesc: string;
  rejectedFactDefaultTitle: string;
  rejectedFactDefaultDesc: string;
  rejectedFactEmptyResponse: string;
  defaultObsidianSystemPrompt: string;
  promptPresetKnowledgeConnectionLabel: string;
  promptPresetKnowledgeConnectionInstruction: string;
  promptPresetResearchNotesLabel: string;
  promptPresetResearchNotesInstruction: string;
  promptPresetProjectNotesLabel: string;
  promptPresetProjectNotesInstruction: string;
  promptPresetDailyReviewLabel: string;
  promptPresetDailyReviewInstruction: string;
  promptPresetWritingDraftLabel: string;
  promptPresetWritingDraftInstruction: string;
  promptDefaultTitle: string;
  promptDefaultDescription: string;
  promptNewSystemPromptTitle: string;
  promptLegacyTitle: string;
  promptLegacyDescription: string;
  promptDirectionPresetLine: string;
  promptAdditionalDirectionLine: string;
  promptGenerationSystemInstruction: string;
  promptGenerationUserIntro: string;
  promptGenerationRequirementsHeader: string;
  promptGenerationRequirementRole: string;
  promptGenerationRequirementContext: string;
  promptGenerationRequirementEvidence: string;
  promptGenerationRequirementLinks: string;
  promptGenerationRequirementNoDefaultTasks: string;
  promptGenerationRequirementLength: string;
  promptNoEmbeddedVaultEntries: string;
  promptSummaryTotalChunks: string;
  promptSummaryTopFolders: string;
  promptSummaryTopFiles: string;
  promptSummaryTopHeadings: string;
  promptSummaryRepresentativeSamples: string;
  promptSummaryNone: string;
  contextRuleNoSourceOutsideVault: string;
  contextRuleSeparateSuggestions: string;
  contextRuleNoEvidence: string;
  contextAutoRagDetail: string;
  contextImplicitFolderDetail: string;
  contextImplicitFolderNoMatch: string;
  contextImplicitFolderReason: string;
  contextRejectedCandidatesExcluded: string;
  contextNoRelevantDocs: string;
  contextRagLoadFailed: string;
  contextAutoRagTitle: string;
  contextAutoRagReasonNoMentions: string;
  contextAutoRagReasonServerOnly: string;
  contextAutoRagReasonServerAndVault: string;
  contextAutoRagReasonVaultMention: string;
  contextAutoRagReasonImplicit: string;
  contextAutoRagReasonDisabled: string;
  contextDiagnosticProviderSummary: string;
  contextDiagnosticRerankerSummary: string;
  contextRerankStatusApplied: string;
  contextRerankStatusEmpty: string;
  contextRerankStatusInvalidJson: string;
  contextRerankStatusError: string;
  contextSearchDiagnostic: string;
  contextFileMissing: string;
  contextLegacyIndexNeedsReindex: string;
  contextFileModified: string;
  contextHashChanged: string;
  contextLineMismatch: string;
  contextUnsupportedGraphRagSource: string;
  contextPartialBudget: string;
  contextFolderNotFound: string;
  contextFolderAttachedLimited: string;
  contextFolderPartialMaxFiles: string;
  contextFolderPartialBudget: string;
  contextFolderPartialReadError: string;
  contextMcpDisconnected: string;
  contextMcpNoTools: string;
  contextMcpServerBlock: string;
  contextGraphRagEntitiesTitle: string;
  contextGraphRagEntityNotFound: string;
  contextGraphRagEntitiesDetail: string;
  contextGraphRagRelationsDetail: string;
  contextGraphContributionTitle: string;
  contextGraphContributionDetail: string;
  graphRagViewMinConfidence: string;
  graphRagViewTabCommunities: string;
  graphRagViewTabRejected: string;
  graphRagViewLoadMore: string;
  graphRagViewNoSearchResults: string;
  graphRagViewBackToList: string;
  graphRagViewAliases: string;
  graphRagViewConfidence: string;
  graphRagViewRelationsCount: string;
  graphRagViewEvidenceCount: string;
  graphRagViewNoCommunities: string;
  graphRagViewNoRejectedFacts: string;
  graphRagViewPendingMerges: string;
  graphRagViewPendingMergesDescription: string;
  graphRagViewPendingMergeConfidence: string;
  graphRagViewMergeEntities: string;
  graphRagViewKeepEntitiesSeparate: string;
  graphRagViewPendingMergeUnavailable: string;
  graphRagViewRawResponse: string;
  graphRagViewDetails: string;
  graphRagViewCopyDetails: string;
  graphRagViewCopyResponse: string;
  graphRagViewRawCopied: string;
  graphRagViewRetry: string;
  graphRagViewProcessing: string;
  graphRagViewRetryFailed: string;
  graphRagViewErrorCopied: string;
  graphRagViewCopyFailed: string;
  graphRagViewIndexingProgress: string;
  promptLibraryTitle: string;
  closeLabel: string;
  settingsSaveMcpReconnectFailed: string;
  manualPromptDescription: string;
  promptDeleteConfirm: string;
  promptBodyRequired: string;
  promptSavedNotice: string;
  promptAppliedToSessionNotice: string;
  promptSetGlobalDefaultNotice: string;
  promptGenerationModelRequired: string;
  promptRagStoreMissing: string;
  generating: string;
  promptNoEmbeddedVaultInfo: string;
  promptEmptyModelResponse: string;
  vaultBasedPromptTitle: string;
  customLabel: string;
  generatedPromptDescription: string;
  vaultBasedPromptGeneratedNotice: string;
  promptGenerationFailed: string;
  vaultBasedGeneration: string;
  newPromptButton: string;
  promptEmptyState: string;
  titleLabel: string;
  descriptionLabel: string;
  applyToCurrentSession: string;
  globalDefault: string;
  setGlobalDefault: string;
  deleteLabel: string;
  embeddedVaultGenerateTitle: string;
  promptDirectionPlaceholder: string;
  promptSourceDefault: string;
  promptSourceGenerated: string;
  promptSourceUser: string;
  cmdOpenAiChat: string;
  cmdReindexVault: string;
  cmdOpenGraphRagView: string;
  cmdOpenAgentDiagnosticsView: string;
  graphRagViewTabTitle: string;
  graphRagViewTabEntities: string;
  graphRagViewTabRelations: string;
  graphRagViewTabEvidence: string;
  graphRagViewEmpty: string;
  graphRagViewSearchPlaceholder: string;
}

const ko: I18nKeys = {
  agentDiagnosticsPanelTitle: '진단',
  agentDiagnosticsPanelDesc:
    'Codex와 opencode가 문제 원인을 확인할 수 있도록 런타임 상태를 기록합니다. 일반 사용에서는 기본적으로 꺼져 있습니다.',
  agentDiagnosticsToggle: '에이전트 진단 사용',
  agentDiagnosticsToggleDesc:
    '이번 플러그인 세션의 heartbeat, 새로고침 이벤트, 최근 로그와 런타임 상태를 수집합니다.',
  agentDiagnosticsOpenView: '진단 상태 창',
  agentDiagnosticsOpenViewDesc: '기계 판독 가능한 진단 화면을 엽니다.',
  agentDiagnosticsOpenViewButton: '진단 열기',
  agentDiagnosticsFilePath: '진단 파일: {path}',
  agentDiagnosticsWriteSnapshot: '현재 상태 기록',
  agentDiagnosticsWriteSnapshotDesc: '현재 진단 상태를 JSON 파일에 즉시 기록합니다.',
  agentDiagnosticsWriteButton: '상태 기록',
  agentDiagnosticsClearDetailedLogging: '상세 진단 기록 정리',
  agentDiagnosticsClearDetailedLoggingDesc:
    '에이전트 진단 버퍼와 최근 로그를 비우고 진단 JSON 파일을 제거합니다.',
  agentDiagnosticsClearButton: '진단 기록 정리',
  agentDiagnosticsViewTitle: 'Agent Diagnostics',
  agentDiagnosticsViewDesc: 'Machine-readable Superpower Inside runtime status for coding agents.',
  agentDiagnosticsRefreshButton: 'Refresh',
  agentDiagnosticsCopyButton: 'Copy JSON',
  agentDiagnosticsEnabledStatus: '사용 중이며 {path}에 기록합니다.',
  agentDiagnosticsDisabledStatus: '꺼져 있습니다. 문제가 있을 때만 펼쳐서 켜세요.',
  agentDiagnosticsWriteDone: 'Agent diagnostics snapshot written.',
  agentDiagnosticsClearDone: 'Agent diagnostics detailed logging cleaned.',
  agentDiagnosticsCopied: 'Agent diagnostics JSON copied.',
  agentDiagnosticsCopyFailed: 'Failed to copy agent diagnostics JSON: {message}',
  cmdOpenAgentDiagnosticsView: 'Open Agent Diagnostics',
  // General
  autoSaveSettings: '설정 자동 저장',
  autoSaveSettingsDesc: '변경 사항 후 자동으로 설정 저장 (디스크 I/O 감소)',
  autoSaveDelay: '설정 변경 자동 저장 딜레이',
  autoSaveDelayDesc: '설정 값을 변경한 후 자동으로 저장되기까지 대기 시간 (0–5000 ms)',
  autoSaveSuccessNotice: '설정이 자동 저장되었습니다.',
  autoSaveMcpFailedNotice: '설정은 저장되었지만 MCP 서버 {count}개 재연결에 실패했습니다.',
  autoSaveFailedNotice: '설정 자동 저장 실패: {message}',
  autoSaveUnknownError: '알 수 없는 오류',
  delayMs: 'ms',
  defaultModel: '기본 모델',
  defaultModelDesc: '채팅 및 명령어에 사용할 기본 모델',
  refreshModelList: '모델 목록 새로고침',
  refreshing: '새로고침 중...',
  refreshComplete: '새로고침 완료',
  actionCompletedNotice: '완료되었습니다.',
  actionPartialNotice: '일부만 완료되었습니다.',
  actionNoopNotice: '변경 사항이 없습니다.',
  actionCancelledNotice: '취소했습니다.',
  actionFailedWithMessage: '실패했습니다: {message}',
  noModelsEnabled: '활성화된 모델 없음',
  pluginAwareGeneration: '플러그인 인식 생성 활성화',
  pluginAwareGenerationDesc:
    'LLM 프롬프트에 활성 플러그인 목록을 포함하여 호환 문법을 유도합니다. (비공식 API 사용)',
  pluginAwareGenerationLimitNotice:
    '현재 이 기능은 활성 플러그인의 이름, 버전, 설명을 프롬프트에 포함하고 Context7 문서 조회를 유도합니다. DataviewJS 같은 플러그인의 data.json 세부 설정, 실행 결과, 볼트별 인덱스 상태까지 읽거나 검증하지는 않습니다.',
  pluginAwareContext7MissingWarning:
    'Context7 MCP가 설정되어 있지 않아 플러그인 문서 기반 생성이 작동하지 않습니다. MCP 탭 JSON 편집기에 context7 서버를 추가하세요.',
  language: '언어',
  languageDesc: '플러그인 전체 UI 언어를 선택합니다',
  langKo: '한국어',
  langEn: 'English',
  languageChangeConfirm:
    '언어를 변경하시겠습니까? 변경 사항을 적용하려면 Obsidian을 다시 로드해야 합니다.',
  generalStatusTitle: '현재 상태',
  generalStatusDesc: '채팅과 검색을 바로 사용할 수 있는지 확인하고 필요한 다음 행동만 안내합니다.',
  generalAllReady: '현재 바로 처리할 항목이 없습니다.',
  generalBasicsTitle: '기본 설정',
  generalBasicsDesc: '언어, 기본 모델, 설정 저장 방식을 정합니다.',
  generalDiagnosticsTitle: '진단',
  generalDiagnosticsDesc: '문제가 있을 때만 런타임 상태와 상세 기록을 확인합니다.',
  generalDiagnosticsDisclosureTitle: '진단 도구 보기',
  generalDiagnosticsDisclosureDesc: '상태 기록, 진단 화면, 로그 정리 작업을 펼칩니다.',
  generalAdvancedTitle: '고급 및 복구',
  generalAdvancedDesc: '평소에는 바꿀 필요 없는 저장 세부값과 복구 작업입니다.',
  generalAutoSaveDisclosureTitle: '저장 세부 설정',
  generalAutoSaveDisclosureDesc: '설정 변경 후 저장하기까지의 대기 시간을 조정합니다.',
  generalDangerDisclosureDesc: '되돌릴 수 없는 전체 초기화 작업이 포함되어 있습니다.',
  chatStatusTitle: '현재 동작',
  chatStatusDesc: '새 대화에 적용되는 응답, 저장, 도구 사용 방식을 요약합니다.',
  chatActiveStatus: '적용 중',
  chatEnabledStatus: '사용 중',
  chatDisabledStatus: '꺼짐',
  chatSelectedStatus: '선택됨',
  chatStatusPromptDetail: '새 대화의 기본 응답 방식입니다.',
  chatStatusAutosaveOnDetail: '대화가 지정한 볼트 폴더에 자동으로 저장됩니다.',
  chatStatusAutosaveOffDetail: '대화는 사용자가 직접 저장할 때만 보관됩니다.',
  chatStatusToolsDetail: 'MCP 도구 실행 전 확인 범위를 결정합니다.',
  chatPromptSectionTitle: '응답 기본값',
  chatPromptSectionDesc: 'AI의 기본 역할과 응답 방식을 정합니다.',
  chatPromptLibraryDesc: '저장된 프롬프트를 선택하고 이름·설명·내용을 관리합니다.',
  chatPromptShortcutsTitle: '빠른 시작과 초기화',
  chatPromptShortcutsDesc: '프리셋을 새 기본값으로 적용하거나 기본 프롬프트로 되돌립니다.',
  chatApplyPreset: '적용',
  chatPromptResetDesc: '사용자 지정 전역 프롬프트를 기본 지식 작업 프롬프트로 되돌립니다.',
  chatStorageSectionTitle: '대화 저장',
  chatStorageSectionDesc: '대화를 보관할 위치와 자동 저장 여부를 정합니다.',
  chatStorageDetailsTitle: '저장 세부 조정',
  chatStorageDetailsDesc: '자동 저장이 시작되기 전 대기 시간을 조정합니다.',
  chatToolsSectionTitle: '도구 사용',
  chatToolsSectionDesc: 'MCP 도구를 언제 자동 실행하고 언제 확인할지 정합니다.',
  chatToolDetailsTitle: '도구 세부 조정',
  chatToolDetailsDesc: '모델이 요청된 도구를 사용하지 않았을 때의 재시도를 조정합니다.',
  chatAlwaysAutoWarning:
    '항상 자동 실행을 선택하면 멘션하지 않은 일반 MCP 도구도 별도 승인 없이 실행될 수 있습니다.',
  mcpStatusSectionTitle: '현재 연결',
  mcpStatusSectionDesc: 'MCP 서버 연결 상태와 필요한 복구 행동을 확인합니다.',
  mcpServersSectionTitle: '서버 설정',
  mcpServersSectionDesc: '표준 mcpServers JSON으로 사용할 서버를 관리합니다.',
  mcpEnvironmentSectionTitle: '실행 환경',
  mcpEnvironmentSectionDesc: '서버 명령을 찾는 데 필요한 로컬 실행 환경을 관리합니다.',
  mcpEnvironmentDetailsTitle: '실행 환경 세부 조정',
  mcpEnvironmentDetailsDesc: 'PATH 자동 탐지와 수동 값을 문제 해결이 필요할 때 조정합니다.',
  mcpStatusNoServersDetail: '서버 설정에 mcpServers 항목을 추가하면 연결을 시작합니다.',
  mcpStatusSummaryDetail: '전체 {total}개 중 {connected}개 서버가 연결되어 있습니다.',
  mcpReconnectDesc: '현재 서버 설정으로 연결을 다시 시도합니다.',
  mcpStatusServerDetail: '현재 서버 명령과 연결 상태입니다.',
  advancedPluginAwareTitle: '플러그인 인식 생성',
  advancedPluginAwareDesc: '활성 플러그인 정보를 활용해 Obsidian 문법 호환성을 높입니다.',
  advancedEnabledStatus: '사용 중',
  advancedDisabledStatus: '꺼짐',
  advancedPluginAwareOnDetail: '새 요청에 활성 플러그인 정보가 제한된 범위로 포함됩니다.',
  advancedPluginAwareOffDetail: '새 요청에 활성 플러그인 정보를 추가하지 않습니다.',
  loggingMinLevel: '최소 로그 레벨',
  loggingMirrorConsole: '콘솔에도 출력',
  loggingMaxEntries: '로그 보존 개수',
  loggingViewerTitle: '진단 로그',
  loggingViewerDesc:
    '플러그인 런타임, RAG, GraphRAG, MCP, 임베딩 오류를 에이전트 진단 화면에서 확인합니다.',
  loggingCopyVisible: '보이는 로그 복사',
  loggingClear: '로그 비우기',
  loggingFilterLevel: '레벨',
  loggingFilterAllLevels: '전체',
  loggingFilterSource: '출처',
  loggingFilterSourcePlaceholder: '예: embedding, rag, mcp',
  loggingVisibleCount: '표시 {count}개',
  loggingEmpty: '표시할 로그가 없습니다.',
  loggingCopied: '로그를 복사했습니다.',
  loggingCopyFailed: '로그 복사 실패: {message}',

  // Providers
  apiKey: 'API 키',
  baseUrl: '기본 URL',
  validateApiKey: 'API 키 검증',
  valid: '유효함',
  modelsFound: '개 모델 발견',
  invalid: '유효하지 않음',
  error: '오류',
  noModelsFound: '모델을 찾을 수 없습니다.',
  enabled: '활성화',
  providerCapabilityToolCalling: '툴 호출 지원',
  providerCapabilityToolCallingDesc:
    '이 custom OpenAI-compatible endpoint가 tool schema와 tool call delta를 안정적으로 지원할 때만 켭니다.',
  providerCapabilityReasoning: 'reasoning/thinking 표시 지원',
  providerCapabilityReasoningDesc:
    'provider가 명시적으로 reasoning 또는 thinking 필드를 제공할 때만 켭니다.',
  providerCapabilityLiveStreaming: '실시간 스트리밍 지원',
  providerCapabilityLiveStreamingDesc:
    '토큰이 실시간으로 도착하는 endpoint일 때만 켭니다. requestUrl 경로는 보통 buffered입니다.',
  providerCapabilityNativeAbort: '네이티브 취소 지원',
  providerCapabilityNativeAbortDesc:
    'AbortSignal로 요청을 실제 중단할 수 있을 때 켭니다. requestUrl은 best-effort입니다.',
  providerCapabilityMaxToolRounds: '최대 툴 라운드',
  providerCapabilityMaxToolRoundsDesc:
    '이 provider에서 한 답변 중 허용할 tool loop 라운드 수입니다. 툴 호출 미지원이면 0으로 둡니다.',
  providerCapabilityBufferedNoTools: 'buffered · tools off',
  providerCapabilityBuffered: 'buffered',
  providerCapabilityNoTools: 'tools off',
  providerCapabilityStreamingReasoning: 'streaming · reasoning',
  providerCapabilityStreaming: 'streaming',
  providerToolCallingUnsupportedNotice:
    '{provider}는 현재 툴 호출 capability가 꺼져 있어 MCP tools를 이번 요청에 보내지 않습니다.',
  providerWaitBufferedHeadline: '{provider} / {model} 응답 대기 중',
  providerWaitBufferedDetail:
    '실시간 토큰 없이 완료된 응답을 한 번에 표시합니다. 취소는 provider에 따라 이미 진행 중인 요청을 즉시 멈추지 못할 수 있습니다.',
  providerWaitElapsedSeconds: '{seconds}초',
  reasoningProvidedLabel: '모델이 제공한 thinking',
  chatRecoveryRetrySameContext: '같은 맥락으로 다시 시도',
  chatRecoverySwitchProvider: 'Provider/모델 변경',
  chatRecoveryReconnectMcp: 'MCP 다시 연결',
  chatRecoveryEditToolArgs: '툴 인자 수정',
  chatRecoverySkipFailedTool: '실패한 툴 건너뛰기',
  chatRecoverySendWithoutRag: 'RAG 없이 전송',
  chatRecoverySendWithoutSourceValidation: '출처 검증 없이 전송',
  chatRecoveryCopyDebug: '디버그 복사',
  turnStageDraft: '초안',
  turnStageBuildingContext: '컨텍스트 준비',
  turnStageWaitingProvider: 'provider 대기',
  turnStageStreamingReasoning: 'reasoning 수신',
  turnStageStreamingAnswer: '답변 수신',
  turnStagePlanningTools: '툴 계획',
  turnStageAwaitingToolApproval: '툴 승인 대기',
  turnStageRunningTools: '툴 실행',
  turnStageFinalizingAfterTools: '툴 결과 반영',
  turnStageComplete: '완료',
  turnStageCancelled: '취소됨',
  turnStageError: '오류',

  // RAG
  embeddingProvider: '임베딩 프로바이더',
  embeddingProviderDesc: '임베딩에 사용할 프로바이더를 선택하세요',
  embeddingModel: '임베딩 모델',
  embeddingModelDesc: '사용할 임베딩 모델을 선택하세요',
  embeddingModelId: '모델 ID',
  embeddingModelIdDesc: '임베딩 모델 ID를 직접 입력하세요',
  save: '저장',
  cancel: '취소',
  confirmLabel: '확인',
  embeddingChangedNotice: '임베딩 설정 변경이 취소되었습니다.',
  embeddingSavedNotice: '임베딩 설정이 저장되었습니다.',
  testConnection: '연결 테스트',
  testing: '🔄 테스트 중...',
  connectionSuccess: '연결 성공!',
  connectionFailed: '연결 실패',
  connectionError: '오류 발생',

  // RAG Stats
  indexStats: '인덱스 통계',
  totalFiles: '전체 파일',
  totalFilesDesc: '현재 설정 기준 RAG 대상 파일 수',
  indexedFiles: '인덱싱 완료',
  indexedFilesDesc: '임베딩 처리된 파일 수',
  pendingFiles: '대기 중',
  pendingFilesDesc: '아직 인덱싱되지 않은 파일 수',
  totalVectors: '전체 벡터',
  totalVectorsDesc: '저장된 임베딩 벡터 개수',
  targetFileTypes: '대상 파일 형식',
  targetFileTypesDesc: '현재 설정 기준으로 RAG 후보인 파일 형식과 파일 수입니다.',
  targetFileTypesEmpty: '현재 설정 기준으로 RAG 대상 파일이 없습니다.',
  excludeRecommendations: '제외 추천',
  excludeRecommendationEmpty: '추가로 제외할 파일 형식 추천이 없습니다.',
  addExcludeExtension: '제외 확장자에 추가',
  addExcludeExtensionDone: '제외 확장자에 추가했습니다',
  refresh: '새로고침',
  loadStatsFailed: '통계를 불러올 수 없습니다.',
  enableProviderFirst: 'Providers 탭에서 "{provider}"의 Enabled 토글을 켜주세요.',
  enterApiKeyFirst: 'Providers 탭에서 "{provider}"의 API Key를 입력하세요.',
  selectAndSaveModel:
    '임베딩 모델이 선택되지 않았습니다. Embedding Provider 섹션에서 모델을 선택하고 "저장" 버튼을 클릭하세요.',
  enterModelId: '임베딩 모델 ID를 직접 입력하고 "저장" 버튼을 클릭하세요.',
  connectionFailedGeneric:
    '프로바이더 "{provider}"({model}) 연결에 실패했습니다. Base URL이나 API Key를 확인하세요.',

  // RAG Controls
  indexingControls: '인덱싱 제어',
  updatePendingFiles: '대기 중인 파일 업데이트',
  reindexAll: '전체 재인덱싱',
  clearEmbeddingData: '임베딩 데이터 초기화',
  confirmClear: '모든 임베딩 데이터를 삭제하시겠습니까? 복구할 수 없습니다.',
  clearSuccess: '모든 임베딩 데이터가 초기화되었습니다.',
  clearFailed: '초기화 실패',
  indexerNotInit: 'RAG 인덱서가 초기화되지 않았습니다.',
  indexingStarted: '대기 중인 파일 인덱싱 시작...',
  indexingDone: '개 파일 인덱싱 완료',
  indexingFailed: '인덱싱 실패',
  reindexingStarted: '전체 재인덱싱 시작...',
  reindexingDone: '개 파일 재인덱싱 완료',
  reindexingFailed: '재인덱싱 실패',
  autoUpdateIndexingStarted: '자동 인덱싱 시작...',
  autoUpdateIndexingDone: '개 파일 자동 인덱싱 완료',
  autoUpdateIndexingFailed: '자동 인덱싱 실패',

  // RAG Options
  autoUpdate: '자동 업데이트',
  autoUpdateDesc: '설정된 간격으로 새 파일을 자동으로 인덱싱합니다',
  autoUpdateInterval: '자동 업데이트 간격',
  autoUpdateIntervalDesc: '자동 인덱싱 간격 (1~99분, 자연수)',
  intervalMinutes: '분',
  excludePaths: '제외할 경로',
  excludePathsDesc: '인덱싱에서 제외할 폴더나 경로 패턴을 목록으로 관리합니다.',
  excludeExts: '제외할 확장자',
  excludeExtsDesc: '인덱싱에서 제외할 파일 확장자를 목록으로 관리합니다.',
  excludeListAdd: '추가',
  excludeListRemove: '삭제',
  excludeListEmpty: '등록된 항목이 없습니다.',
  excludeExtFileCount: '{count}개',
  excludeExtTotalFileCount: '총 {count}개 파일 제외 대상',
  excludePathPlaceholder: '예: Archive 또는 **/drafts',
  excludeExtPlaceholder: '예: pdf 또는 .png',
  excludeInputEmpty: '값을 입력하세요.',
  excludeInputTrimmed: '앞뒤 공백은 저장 시 제거됩니다.',
  excludeInputDuplicate: '이미 목록에 있습니다.',
  excludeInputComma: '쉼표 대신 항목을 하나씩 추가하세요.',
  excludePathBackslash: '경로 구분자는 / 를 사용하세요.',
  excludePathLeadingSlash: '볼트 기준 상대 경로로 입력하세요. 앞의 / 는 제외합니다.',
  excludePathMissingWarning:
    '현재 볼트에서 찾을 수 없습니다. 패턴이라면 그대로 저장할 수 있습니다.',
  excludeExtLeadingDot: '앞의 점은 저장 시 제거됩니다.',
  excludeExtInvalid: '확장자는 영문/숫자/하이픈/밑줄만 입력하세요.',
  excludeExtProtectedDocument:
    'Obsidian 핵심 문서 확장자는 제외할 수 없습니다. 문제가 있는 파일은 경로나 폴더로 제외하세요.',
  excludeChatFolder: '채팅 저장 폴더 RAG 제외',
  excludeChatFolderDesc: '채팅 저장 폴더를 RAG 인덱싱 대상에서 자동으로 제외합니다',
  chunkSize: '청크 크기',
  chunkSizeDesc: '문서 청크당 최대 문자 수 (100~5000)',
  ragChunkSizeOllamaWarning:
    'Ollama 로컬 임베딩 모델 중 일부는 컨텍스트 길이 제한이 작습니다. 400 오류가 발생하면 이 값을 500 이하로 줄여보세요.',
  ollamaEmbeddingContextError:
    'Ollama 임베딩 모델의 최대 컨텍스트 길이를 초과했습니다. 설정 > RAG > 청크 크기(chunkSize)를 줄이고 다시 인덱싱해보세요.',
  minScore: '최소 유사도 점수',
  minScoreDesc:
    '임베딩 검색 결과 중 이 점수(0~1) 미만은 제외합니다. 낮을수록 더 많은 결과를 포함하지만 품질이 떨어질 수 있습니다.',
  enableBM25: 'BM25 키워드 검색 활성화',
  enableBM25Desc:
    '임베딩 유사도와 BM25 키워드 매칭을 결합한 하이브리드 검색을 사용합니다. 한국어 검색 정확도 향상에 도움이 됩니다.',
  bm25Weight: 'BM25 가중치',
  bm25WeightDesc:
    '0~1 사이. 0에 가까울수록 임베딩 유사도 위주, 1에 가까울수록 키워드 매칭 위주로 검색합니다.',
  bm25Guidance:
    '💡 BM25는 키워드 기반 검색으로, 임베딩 유사도만으로는 잡아내기 어려운 한국어 키워드 매칭을 보완합니다. RAG 컨텍스트가 빈번하게 무관한 결과를 반환한다면 BM25를 활성화하고 가중치를 조정해보세요.',

  // RAG 상태 대시보드
  ragStatusTotalDocs: '전체 문서',
  ragStatusHealthy: '정상',
  ragStatusUpdateRequired: '업데이트 필요',
  ragStatusTotalVectors: '전체 벡터',
  ragStatusCurrentState: '현재 상태',
  ragStatusAutoUpdate: '자동 업데이트',

  // RAG 배너
  ragBannerNeedsUpdate:
    '업데이트가 필요한 문서가 있습니다. RAG 검색 품질을 위해 필요 문서 업데이트를 실행하세요.',
  ragBannerIndexing:
    '인덱싱이 실행 중입니다. 오래 걸리거나 Obsidian이 느려지면 중단할 수 있습니다.',
  ragBannerLatest:
    '현재 인덱스는 최신입니다. 모델이나 저장소를 바꾼 경우에만 전체 재인덱싱이 필요합니다.',
  ragBannerNoDocs:
    '현재 설정 기준으로 RAG 대상 문서가 없습니다. 제외 경로나 파일 형식을 확인하세요.',
  ragBannerPaused: '성능 보호 때문에 잠시 대기 중입니다. 원인: {reason}',
  ragWorkflowStatusTitle: '상태 확인',
  ragWorkflowStatusDetail: '현재 인덱스가 최신인지 먼저 확인합니다.',
  ragWorkflowEmbeddingTitle: '임베딩 선택',
  ragWorkflowEmbeddingDetail: '기본값은 내장 Ternlight이고, 필요하면 원격 provider로 바꿉니다.',
  ragWorkflowIndexTitle: '인덱싱 실행',
  ragWorkflowIndexDetail: '변경분만 갱신하고, 모델을 바꿨을 때만 전체 재인덱싱합니다.',
  ragWorkflowTuneTitle: '고급 조정',
  ragWorkflowTuneDetail: '검색 품질과 GraphRAG는 기본 흐름이 안정된 뒤 조정합니다.',
  ragLocalEmbeddingTitle: '기본 제공: Ternlight 온디바이스 임베딩',
  ragLocalEmbeddingDetail:
    '노트는 기기를 벗어나지 않으며 API 키나 Ollama 서버가 필요 없습니다. 모델 파일이 없으면 한 번 자동으로 내려받아 무결성을 확인한 뒤 오프라인으로 사용합니다.',
  ragStatusSectionDescription: '검색 준비 상태와 지금 필요한 행동을 확인합니다.',
  ragFoundationTitle: '검색 기반 설정',
  ragFoundationDescription: '검색에 사용할 모델과 인덱싱 범위를 정합니다.',
  ragGraphSectionDescription: '연결 정보를 보강하며, 세부 추출과 운영 도구는 필요할 때만 펼칩니다.',
  ragGraphDisclosureTitle: '세부 설정과 작업',
  ragGraphDisclosureDescription: '모델, 동기화, 추출과 결과 확인을 관리합니다.',
  ragDiagnosticsTitle: '진단 및 복구',
  ragDiagnosticsDescription: '일상 사용에 필요하지 않은 통계와 복구 도구입니다.',
  ragDiagnosticsDisclosureTitle: '세부 진단 보기',
  ragOverviewTitle: '일반 검색',
  ragOverviewReady: '최신',
  ragOverviewNeedsUpdate: '{count}개 업데이트 필요',
  ragOverviewEmpty: '인덱싱 대상 없음',
  ragOverviewDetail: '{healthy}/{total}개 문서 최신 · 자동 업데이트 {auto}',
  ragOverviewUnavailable: '연결 필요',
  ragOverviewFixEmbedding: '임베딩 모델 선택',
  ragOverviewCheckProvider: '프로바이더 확인',
  ragRecoverySummary: '문제 해결 및 복구',
  ragRecoveryDescription: '전체 재인덱싱과 데이터 초기화는 문제가 있을 때만 사용합니다.',
  graphRagOverviewTitle: '연결 기반 검색 (GraphRAG)',
  graphRagOverviewDetail: '대상 {total} · 증거 {done} · 동기화 {stale} · 실패 {failed}',
  graphRagDetailsSummary: 'GraphRAG 세부 설정 및 복구',
  graphRagQueryModeLabel: 'GraphRAG 검색 방식',
  graphRagQueryAutoLabel: '자동',
  graphRagQueryLocalLabel: '로컬',
  graphRagQueryGlobalLabel: '글로벌',
  graphRagQueryHybridLabel: '하이브리드',
  graphRagMergeThresholdLabel: '병합 기준',
  graphRagPendingMergeLabel: '병합 검토 대기',
  graphRagModularityDetail: '모듈성 {value}',

  // RAG 버튼
  btnUpdatePending: '필요 문서 업데이트',
  btnReindexAll: '전체 재인덱싱',
  btnCancelIndexing: '인덱싱 중단',
  btnResumeIndexing: '지금 재개',
  btnResetEmbeddings: '임베딩 데이터 초기화',

  // RAG 필터
  filterAll: '전체',
  filterMissing: '미인덱싱',
  filterStale: '수정됨',
  filterUnknown: '확인 필요',
  loadMore: '10개 더 보기',
  loadAll: '모두 펼치기',

  // RAG 배치
  batchAddExclude: '선택 항목 제외 목록에 추가',
  selectAll: '전체 선택',
  deselectAll: '선택 해제',

  // 연결 배지
  connectionConnected: '연결됨 ({count}개 모델)',
  connectionTesting: '테스트 중...',

  // 진행률
  progressLabel: '진행률',

  // Chat
  chatTabTitle: 'AI 채팅',
  toolbarTools: '도구',
  sendButton: '전송',
  chatSaveFolder: '채팅 저장 폴더',
  chatSaveFolderDesc: '대화를 저장할 볼트 내 폴더 경로',
  systemPrompt: '시스템 프롬프트',
  systemPromptDesc:
    'AI의 역할과 응답 방식을 정의하는 글로벌 시스템 프롬프트입니다. 비워두면 기본 프롬프트가 사용됩니다.',
  systemPromptPlaceholder: '예: 당신은 Obsidian 노트 작성을 돕는 전문가 어시스턴트입니다...',
  promptLibraryOpen: '프롬프트 보관함 열기',
  mcpToolExecutionPolicy: 'MCP 툴 실행 정책',
  mcpToolExecutionPolicyDesc:
    '멘션한 MCP 서버는 사용자가 신뢰하고 사용 의사를 표시한 서버로 간주해 일반 툴을 자동 실행합니다. 툴 결과는 최종 답변 생성을 위해 LLM provider로 다시 전달될 수 있으며, 위험하거나 미멘션된 툴은 승인 대기로 둡니다.',
  mcpToolExecutionMentionedAuto: '멘션 서버 자동 실행',
  mcpToolExecutionAlwaysManual: '항상 수동 승인',
  mcpToolExecutionAlwaysAuto: '항상 자동 실행',
  resetToDefault: '기본값으로 초기화',
  chatClear: '대화 지우기',
  chatScrollToBottom: '최신 답변으로',
  chatTyping: 'AI가 생각 중...',
  copyCode: '복사',
  copied: '복사됨',
  toolResult: '툴 결과',
  executeTool: '실행',
  toolArgs: '인자',
  selectTool: '툴 선택',
  noToolsAvailable: '사용 가능한 MCP 툴이 없습니다.',
  messageUser: '사용자',
  messageAssistant: 'AI',
  messageSystem: '시스템',
  messageTool: '툴',
  timestampJustNow: '방금',
  timestampMinutesAgo: '{count}분 전',
  timestampHoursAgo: '{count}시간 전',
  timestampDaysAgo: '{count}일 전',
  sessionPromptModified: '수정됨',
  mcpToolRunning: '툴 실행 중...',
  mcpToolSuccess: '툴 실행 성공',
  mcpToolError: '툴 실행 실패',
  mcpToolValidationError: '입력값이 잘못되었습니다.',
  mcpToolInvalidField: '필드 "{field}"의 값이 올바르지 않습니다. {detail}',
  mcpMentionServers: '도구',
  mcpMentionFiles: '볼트 파일',
  mcpMentionFolders: '폴더',
  reasoningLabel: '생각 과정',
  toolCallLabel: '툴 호출',
  answerLabel: '답변',
  thinkingPlaceholder: '생각 중...',
  enforceMcpTools: 'MCP 도구 미사용 감지 및 재시도',
  enforceMcpToolsDesc:
    '@mention한 MCP 서버가 있음에도 모델이 도구를 호출하지 않고 답변을 생성하면, 자동으로 시스템 프롬프트에 도구 사용을 강제하는 지시를 추가하여 재시도합니다.',
  modelSelector: '모델',
  mcpRefresh: '새로고침',
  mcpReconnect: '재연결',
  mcpRefreshing: '재연결 중...',
  mcpConnecting: 'MCP 연결 중...',
  mcpPartialError: '일부 MCP 서버 실패',
  mcpNoActiveServers: '활성 MCP 서버 없음',
  mcpActiveServers: '활성 {count} / 전체 {total}',
  quickPresetGeneral: '일반',
  quickPresetCodeReview: '코드 리뷰',
  quickPresetTranslate: '번역',
  quickPresetSummarize: '요약',
  chatMcpReconnectFailedNotice: 'MCP 재연결 중 {count}개 서버 실패',
  chatMcpReconnectFailedDetail: '{count}개 실패',
  chatMcpReconnectCompleteNotice: 'MCP 서버 재연결 완료',
  chatSearchButton: '검색',
  chatMessageSearchAria: '메시지 검색',
  chatInputPlaceholder: '메시지를 입력하세요...',
  chatMessageSearchPrompt: '검색할 메시지 내용을 입력하세요.',
  chatAutoRagChip: '관련 노트',
  chatFolderMentionChip: '폴더 {name}',
  chatFileMentionChip: '파일 {name}',
  chatReadinessProviderMissing: 'Provider 설정 필요',
  chatReadinessProviderMissingDetail:
    '설정에서 최소 하나의 LLM Provider를 활성화해야 전송할 수 있습니다.',
  chatReadinessModelMissing: '모델 선택 필요',
  chatReadinessModelMissingDetail: '활성 Provider에 사용할 모델을 하나 이상 등록하세요.',
  chatReadinessRagIndexing: 'RAG 인덱싱 중',
  chatReadinessRagIndexingDetail:
    '이번 질문은 보낼 수 있지만 최신 볼트 컨텍스트가 일부 빠질 수 있습니다.',
  chatReadinessRagNotReady: 'RAG 준비 안 됨',
  chatReadinessRagNotReadyDetail: '인덱스를 만들거나 갱신하면 자동 컨텍스트 품질이 좋아집니다.',
  chatReadinessPrepareDocuments: '문서 준비',
  chatReadinessSelectModelAction: '모델 선택',
  chatReadinessConfigureProviderAction: 'Provider 설정',
  chatEmptyStateTitle: '볼트에 대해 물어보세요',
  chatEmptyStateDetail:
    '관련 문서는 내장 검색으로 자동 참조하고 답변 아래에 출처를 표시합니다. MCP는 필요하지 않습니다.',
  chatEmptyStatePromptSummary: '이 볼트의 핵심 주제를 근거와 함께 요약해줘',
  chatEmptyStatePromptConnections: '최근 노트와 연결되는 관련 문서를 찾아줘',
  chatReadinessMcpPartial: 'MCP 일부 연결 필요',
  chatReadinessMcpPartialDetail: '연결됨 {connected}/{total}. 필요한 서버를 재연결하세요.',
  chatReadinessSaveFolderMissing: '저장 폴더 없음',
  chatReadinessSaveFolderMissingDetail:
    '세션 replay와 draft 복구를 위해 채팅 저장 폴더를 설정하세요.',
  chatReadinessReady: '채팅 준비 완료',
  chatReadinessBlocked: 'Provider 설정 필요',
  chatReadinessDegraded: '일부 기능 준비 필요',
  composerDraftRestoredNotice: '전송이 끝나지 않아 초안을 복원했습니다.',
  chatToolMentionChip: '도구 {name}',
  contextAttachmentAttached: '포함됨',
  contextAttachmentPartial: '일부 포함',
  contextAttachmentMissing: '누락',
  contextAttachmentError: '오류',
  contextAttachmentLowRelevance: '관련 낮음',
  contextAttachmentExcluded: '제외됨',
  contextAttachmentChars: '{count}자',
  contextNoteSingular: '노트',
  contextNotePlural: '노트',
  contextItemSingular: '항목',
  contextItemPlural: '항목',
  contextChipRelatedNotes: '관련 노트 {count}개 확인',
  contextChipNoRelatedNotes: '가까운 노트를 찾지 못함',
  contextChipVaultSearchSkipped: '볼트 검색 건너뜀',
  contextChipKnowledgeGraph: '지식 그래프 확인',
  contextChipKnowledgeGraphMissing: '지식 그래프에서 찾지 못함',
  contextChipFolderNotesUsed: '{name}: 노트 {count}개 사용',
  contextChipFileAttached: '{name}',
  contextChipReferenceAttached: '연결된 노트 {name}',
  contextChipToolReady: '도구 준비됨: {name}',
  contextChipToolUnavailable: '도구 사용 불가: {name}',
  contextChipDetailAuto: '관련 노트를 자동으로 찾았습니다.',
  contextChipDetailSkipped: '이 질문에서는 볼트 검색을 건너뛰었습니다.',
  contextChipDetailShortened: '들어가는 만큼만 포함했습니다.',
  contextBudgetItemsPrepared: '컨텍스트 {count}개 준비됨',
  contextBudgetItemsLeftOut: '{count}개 제외됨',
  contextBudgetUsage: '컨텍스트 {used}/{max}자',
  contextBudgetTruncated: '일부 자료를 줄였습니다.',
  contextBudgetIncludedExcluded: '포함 {included}개 · 제외 {excluded}개',
  dataBoundaryTitle: '이번 답변에 사용한 자료',
  dataBoundaryProvider: '전송됨',
  dataBoundaryMcp: '연결한 도구',
  dataBoundaryLocal: '이 기기에만 보관',
  dataBoundarySystemPrompt: '답변 지침',
  dataBoundaryAttachedContext: '노트와 참조 {count}개',
  dataBoundaryCitationPreview: '출처 미리보기 {count}개',
  dataBoundaryDraftStore: '초안과 출처 카드 상태',
  dataBoundarySourceCardState: '출처 카드 상태',
  dataBoundaryExcludedAttachmentNote: '제외된 항목 {count}개는 전송하지 않았습니다.',
  dataBoundaryExcludedAttachmentNoteSingular: '제외된 항목 {count}개는 전송하지 않았습니다.',
  dataBoundaryExcludedAttachmentNotePlural: '제외된 항목 {count}개는 전송하지 않았습니다.',
  sourceStatusVerified: '확인됨',
  sourceStatusCandidate: '확인 필요',
  sourceStatusMissing: '찾지 못함',
  sourceStatusStale: '변경됨',
  sourceStatusLowRelevance: '약한 일치',
  sourceRepairAction: '출처 확인',
  sourceRepairPrompt: '{label} 출처를 확인하고 답변을 다시 검증해줘.',
  sourceGraphEntity: '지식 그래프',
  sourceGraphRelation: '관계 근거',
  sourceGraphCommunity: '지식 주제',
  sourceLineMeta: '{line}행',
  sourceEndLineMeta: '끝 {line}행',
  sourceRelevanceMeta: '일치도 {score}',
  sourcePreviewTruncated: '미리보기 줄임',
  sourceReasonStrongGraph: '강한 관계 일치',
  sourceReasonGraphStructural: '관계 일치',
  sourceReasonKeywordVector: '강한 본문 일치',
  sourceReasonKeyword: '키워드 일치',
  sourceReasonVector: '의미 일치',
  sourceReasonHybrid: '복합 일치',
  citationMarkerAria: '{id} 출처 카드로 이동',
  variantCompareTitle: '답변 variant 비교',
  variantCompareActive: '선택됨',
  variantCompareRow:
    '{provider} · 출처 {citations}개 · 경고 {warnings}개 · 도구 {tools}개 · 컨텍스트 {contexts}개',
  chatGenerationStopped: '응답 생성이 중단되었습니다.',
  vaultResearchProgress: '볼트 조사 중 · {phase} · {completed}/{total}',
  vaultResearchPhaseInventory: '문서 확인',
  vaultResearchPhaseMap: '문서 읽기',
  vaultResearchPhaseReduce: '내용 종합',
  vaultResearchPhaseComplete: '완료',
  nativeVaultActionSearch: '검색',
  nativeVaultActionRead: '문서 읽기',
  nativeVaultActionList: '문서 목록',
  nativeVaultActionLinks: '링크 확인',
  nativeVaultActionStats: '볼트 범위 확인',
  nativeVaultPlanUnavailable: '네이티브 볼트 도구 요청을 검증할 수 없습니다.',
  nativeVaultInvalidJson: '도구 인자가 유효한 JSON이 아닙니다.',
  nativeVaultUnsupportedAction: '지원하지 않는 동작입니다.',
  nativeVaultQueryRequired: '검색어가 필요합니다.',
  nativeVaultPathRequired: '볼트 경로가 필요합니다.',
  nativeVaultInvalidPath: '볼트 내부의 안전한 경로만 사용할 수 있습니다.',
  nativeVaultInvalidLineRange: '읽기 행 범위가 올바르지 않습니다.',
  nativeVaultInvalidDirection: '링크 탐색 방향이 올바르지 않습니다.',
  nativeVaultInvalidArguments: '도구 인자 형식이 올바르지 않습니다.',
  nativeVaultSearchDisplay: '볼트 검색 결과 {count}개',
  nativeVaultReadDisplay: '{path} {start}-{end}행',
  nativeVaultListDisplay: '볼트 문서 목록 {count}개',
  nativeVaultLinksDisplay: '{path} 링크 {count}개',
  nativeVaultStatsDisplay: '볼트 문서 {count}개',
  nativeVaultFileNotFound: '볼트 문서를 찾을 수 없습니다: {path}',
  nativeVaultReadRangeFailed: '읽을 수 없는 행 범위입니다: {path}',
  nativeVaultListFailed: '볼트 문서 목록을 계산할 수 없습니다.',
  nativeVaultStatsFailed: '볼트 통계를 계산할 수 없습니다.',
  nativeVaultSearchScopeFailed: '볼트 검색 범위를 계산할 수 없습니다.',
  vaultResearchListStalled: '볼트 목록 페이지가 앞으로 진행되지 않았습니다.',
  vaultResearchBatchPlanFailed: '계층 요약 배치를 계산할 수 없습니다.',
  vaultResearchEmptySummary: 'Research Agent가 빈 요약을 반환했습니다.',
  vaultResearchInvalidListResult: '볼트 목록 결과 형식이 올바르지 않습니다.',
  vaultResearchInvalidListItem: '볼트 목록에 잘못된 문서 항목이 있습니다.',
  vaultResearchInvalidListPage: '볼트 목록 페이지 정보가 올바르지 않습니다.',
  vaultResearchInvalidReadResult: '볼트 읽기 결과 형식이 올바르지 않습니다.',
  vaultResearchCancelled: 'Research Agent 실행이 취소되었습니다.',
  vaultResearchCoverageWarning:
    '⚠️ 전체 {total}개 문서 중 {processed}개를 읽었습니다. {failed}개 문서는 읽지 못해 아래 답변에서 제외되었습니다.',
  vaultResearchFailurePlanFailed: 'Research Agent의 재시도 정책을 계산할 수 없습니다.',
  toolLoopPolicyUnavailable: '도구 반복 실행 정책을 계산할 수 없습니다.',
  repeatedToolCallBlocked: '같은 도구와 인자가 반복되어 이 호출을 중단했습니다.',
  chatGeneratingResponse: '응답 생성 중...',
  assistantQuestionReasoningTitle: '모델의 thinking 출력에서 사용자 질문을 감지했습니다.',
  assistantQuestionSelectionTitle: '모델이 사용자 선택을 요청했습니다.',
  assistantQuestionFreeTextPlaceholder: '직접 입력',
  assistantQuestionCompleteSelection: '선택 완료',
  assistantQuestionSendAnswer: '답변 보내기',
  assistantQuestionRequiredNotice: '답변할 항목을 선택하거나 직접 입력하세요.',
  toolApproveExecution: '실행 승인',
  sourceVerifiedCount: '출처 {count}개 확인됨',
  sourceCitationSelectionFailed: '최종 답변의 출처를 정리할 수 없습니다.',
  sourceSearchVerifiedCount: '출처 {verified}/{total}개 확인됨',
  sourceOpenAction: '열기',
  sourceCopyLinkAction: '링크 복사',
  sourceInsertIntoNoteAction: '노트에 삽입',
  sourceOpenedNotice: '출처를 열었습니다: {path}',
  sourceOpenFailedNotice: '출처 열기 실패: {message}',
  sourceCopyLinkFailedNotice: '출처 링크 복사 실패: {message}',
  sourceInsertFailedNotice: '출처 삽입 실패: {message}',
  sourceUnverifiedCount: '확인이 필요한 링크/출처 {count}개',
  sourceFileNotFound: '파일을 찾을 수 없습니다: {path}',
  sourceUnverifiedCandidate: '확인이 필요한 출처입니다: {detail}',
  sourceInsertedNotice: '활성 노트에 출처를 삽입했습니다.',
  sourceInsertBlock: '\n> 출처: {link}\n> {preview}\n',
  messageCopyAction: '복사',
  messageRetryAction: '재생성',
  messageInsertIntoNoteAction: '노트에 삽입',
  messageNewNoteAction: '새 노트',
  messageBranchAction: '브랜치',
  messageEditAndSendAction: '수정 후 전송',
  activeNoteMissingNotice: '활성 노트가 없습니다.',
  messageInsertedNotice: '활성 노트에 삽입했습니다.',
  messageCopyFailedNotice: '메시지 복사 실패: {message}',
  messageInsertFailedNotice: '메시지 삽입 실패: {message}',
  sourceWarningIncluded: '확인이 필요한 링크/출처 {count}개가 있습니다.',
  aiAnswerTitle: 'AI 답변',
  savedAsNewNoteNotice: '새 노트로 저장했습니다: {path}',
  savedAsNewNoteFailedNotice: '새 노트 저장 실패: {message}',
  branchSessionCreatedNotice: '브랜치 세션을 만들었습니다.',
  branchSessionMissingNotice: '브랜치할 메시지를 찾을 수 없습니다.',
  branchSessionFailedNotice: '브랜치 세션 생성 실패: {message}',
  regenerationTargetMissingNotice: '재생성할 메시지를 찾을 수 없습니다.',
  chatStatusIdle: '대기',
  chatStatusRunning: '생성 중',
  chatStatusDone: '완료',
  chatStatusError: '오류',
  deletedSessionResetNotice: '채팅 세션 파일이 삭제되어 채팅창을 초기화했습니다: {path}',
  chatAutoSaveFailedLog: '[Superpower Inside] 채팅 자동 저장 실패:',
  chatLoadFailedNotice: '채팅 불러오기 실패: {message}',
  providerPathRequiredSuffix: ' 경로를 먼저 설정하세요.',
  defaultModelMissingNotice: '기본 모델이 설정되지 않았습니다. 설정 탭에서 모델을 선택하세요.',
  modelSettingInvalid: '모델 설정 형식이 잘못되었습니다.',
  customModelSettingInvalid: '커스텀 모델 설정 형식이 잘못되었습니다.',
  customProviderDisabled: '커스텀 Provider가 활성화되지 않았습니다.',
  noActiveProviderNotice: '활성화된 LLM Provider가 없습니다. 설정에서 Provider를 활성화하세요.',
  mcpRetryToolUseNotice: '🔄 @{servers} 도구를 호출하지 않아 재시도합니다...',
  mcpRetryNoToolUseNotice: '⚠️ @{servers} — 재시도했지만 도구를 호출하지 않았습니다.',
  mcpApprovalRequiredNotice: '일부 MCP 툴은 메시지의 “실행 승인” 버튼을 눌러 진행하세요.',
  llmApiError: 'LLM API 오류: {detail}',
  stopButton: '중단',
  stopAllButton: '전체 중단',
  chatRunActive: '답변 작업 중',
  assistantQuestionProviderContent: '질문: {prompt}\n{choices}',
  mcpToolFinalAnswerMissing:
    'MCP 도구 결과는 받았지만, 모델이 최종 답변을 생성하지 못했습니다. 아래 툴 결과를 확인한 뒤 다시 시도해 주세요.',
  cancelledLabel: '취소됨',
  tooManyToolCalls: '툴 호출이 너무 많이 반복되었습니다.',
  mcpResultMessageMissing: 'MCP 결과를 반영할 채팅 메시지를 찾을 수 없습니다: {messageId}',
  customProviderNotFound: '커스텀 Provider를 찾을 수 없습니다.',
  validationNeedsNumber: '숫자 값이 필요합니다.',
  validationMinValue: '최소값 {minimum} 이상이어야 합니다.',
  validationMaxValue: '최대값 {maximum} 이하여야 합니다.',
  validationRequiredValue: '필수 입력값입니다.',
  validationPatternDetail: '형식이 올바르지 않습니다. (패턴: {pattern})',
  mcpValidationSchemaFailed:
    '입력값이 스키마 검증을 통과하지 못했습니다. 필수 필드와 값의 형식을 확인해주세요.',
  mcpValidationRequiredMissing: '필수 입력값이 누락되었습니다. 모든 필수 필드를 채워주세요.',
  apiHintBadRequest: '요청 형식이 잘못되었습니다. 입력값이나 파라미터를 확인하세요.',
  apiHintUnauthorized: 'API 키가 유효하지 않거나 만료되었습니다.',
  apiHintPaymentRequired: '잔액이 부족합니다. 결제 수단을 확인하세요.',
  apiHintForbidden: '접근이 거부되었습니다. API 키 권한을 확인하세요.',
  apiHintNotFound: '요청한 모델/엔드포인트를 찾을 수 없습니다.',
  apiHintRateLimited: '요청 횟수 제한을 초과했습니다. 잠시 후 다시 시도하세요.',
  apiHintServerError: '서버 내부 오류입니다. 잠시 후 다시 시도하세요.',
  apiHintBadGateway: '게이트웨이 오류입니다. 서버가 일시적으로 불안정합니다.',
  apiHintServiceUnavailable: '서비스가 일시적으로 사용 불가능합니다.',
  apiHintFetchCors:
    '브라우저 fetch/CORS 또는 네트워크 차단 가능성이 있습니다. Provider 요청 경로를 확인하세요.',
  apiErrorCode: '오류 코드: {code}',
  apiErrorLikelyCause: '원인 추정: {hint}',
  apiErrorRaw: '원본: {error}',

  chatNewSession: '새 대화',
  chatHistory: '기록',
  chatSessionTitle: '대화 제목',
  chatRenameSession: '대화 이름 변경',
  chatDeleteSession: '대화 삭제',
  chatDeleteConfirm: '이 대화를 정말 삭제하시겠습니까?',
  chatLoadSession: '대화 불러오기',
  chatAutoSave: '자동 저장',
  chatAutoSaveDesc: '대화 내용을 자동으로 저장합니다',
  chatAutoSaveDelay: '자동 저장 지연(ms)',
  chatAutoSaveDelayDesc: '마지막 메시지 후 저장까지의 지연 시간',
  chatNoSavedSessions: '저장된 대화가 없습니다',
  chatUnsavedChanges: '저장되지 않은 변경사항이 있습니다',
  chatGroupToday: '오늘',
  chatGroupYesterday: '어제',
  chatGroupThisWeek: '이번 주',
  chatGroupThisMonth: '이번 달',
  chatGroupOlder: '이전',
  chatSearchPlaceholder: '대화 검색...',
  chatNoSearchResults: '검색 결과가 없습니다',
  chatCurrentSession: '현재',
  chatSessionCount: '{count}개 대화',
  chatMessageUnit: '개 메시지',
  chatDaysAgo: '{count}일 전',
  chatSessionRenamedNotice: '대화 이름을 변경했습니다.',
  chatSessionRenameFailedNotice: '대화 이름 변경 실패: {message}',
  chatSessionRenameNoChangeNotice: '대화 이름이 변경되지 않았습니다.',
  chatSessionRenameEmptyNotice: '대화 이름이 비어 있어 변경하지 않았습니다.',
  chatSessionDeletedNotice: '대화를 삭제했습니다.',
  chatSessionDeleteFailedNotice: '대화 삭제 실패: {message}',

  settingsAuto001: '가장 널리 쓰이는 기본 모델. 성능과 비용의 균형이 뛰어납니다.',
  settingsAuto002: '최고 성능 모델. 다국어와 복잡한 문맥에 강점이 있습니다.',
  settingsAuto003: 'OpenRouter 경유. 동일 품질, OpenRouter API 키 사용.',
  settingsAuto004: '다국어(한국어 포함) 최적화. 8K 컨텍스트.',
  settingsAuto005: '32K 컨텍스트 지원. 긴 문서에 적합.',
  settingsAuto006:
    '플러그인에 함께 포함된 온디바이스 WASM 임베딩 모델입니다. API 키나 로컬 서버 없이 CPU에서 실행됩니다.',
  settingsAuto007:
    '임베딩 설정 변경이 취소되었습니다. (설정 탭을 닫으면서 저장되지 않은 변경사항은 버려집니다)',
  settingsAuto008: '모델 선택 안 함',
  settingsAuto022: '{v0}개',
  settingsAuto024:
    '채팅과 명령어 실행에 사용할 LLM provider를 관리합니다. 활성화, 모델 선택, 연결 검증을 provider별로 확인합니다.',
  settingsAuto025: '{v0}개 구성',
  settingsAuto026: '고급 진단과 세부 튜닝',
  settingsAuto027: 'RAG 운영 상태',
  settingsAuto028: '상태 계산 중...',
  settingsAuto029: 'GraphRAG 선택 운영',
  settingsAuto030: '전체 {v0}개 파일 대상에서 {v1}개 증거 항목 처리 완료{v2}{v3}',
  settingsAuto030Desc: 'GraphRAG의 처리 완료 수치는 파일 수가 아닌 증거 단위의 개수입니다.',
  settingsAuto031: ', {v0}개 실패',
  settingsAuto032: ', {v0}개 동기화 필요',
  settingsAuto033: 'RAG 인덱싱 대상 파일이 없습니다.',
  settingsAuto034: '상태',
  settingsAuto035: '전체 파일',
  settingsAuto036: '처리 완료(증거)',
  settingsAuto036Desc: '저장된 증거 항목 총량입니다. 파일 수와 동일하지 않을 수 있습니다.',
  settingsAuto037: '실패 파일',
  settingsAuto038: '이어서 실행 버튼으로 실패 파일만 다시 시도할 수 있습니다.',
  settingsAuto039: '실패한 파일이 없습니다.',
  settingsAuto040: '동기화 필요',
  settingsAuto041: '파일이 수정되거나 추출 모델/온톨로지 규칙이 바뀌어 재추출이 필요합니다.',
  settingsAuto042: '모든 파일이 최신 상태입니다.',
  settingsAuto043: '비용/전송',
  settingsAuto044: '커뮤니티',
  settingsAuto045: '예상 비용 상세 보기',
  settingsAuto046: '예상 비용 상세 숨기기',
  settingsAuto047: '예상 파일',
  settingsAuto048: '예상 호출',
  settingsAuto049: '예상 입력 토큰',
  settingsAuto050: 'GraphRAG 백그라운드 빌드 허용',
  settingsAuto051:
    '장시간 LLM 추출 인덱싱을 명시적으로 허용합니다. 기본 RAG 검색은 이 설정과 별개로 유지됩니다.',
  settingsAuto052: 'GraphRAG 모델',
  settingsAuto053:
    'entity/relation/claim 추출에 사용할 모델입니다. 비워두면 실행 버튼이 비활성화됩니다.',
  settingsAuto054: '한 번에 처리할 최대 파일 수',
  settingsAuto055: 'GraphRAG 추출은 비용이 크므로 run limit을 둡니다.',
  graphRagConcurrentRequestsLabel: '동시 요청 수',
  graphRagConcurrentRequestsDesc:
    'GraphRAG 추출 요청을 동시에 처리할 개수입니다. 제공자 제한에 맞게 1~10 사이에서 조절하세요.',
  settingsAuto056: '질문 유형별 graph 검색 방식을 선택합니다.',
  settingsAuto057: '자동 merge와 pending merge 기준입니다.',
  settingsAuto058: '자동 동기화',
  settingsAuto059:
    '파일 변경 시 stale 파일을 자동으로 동기화합니다. LLM API 비용이 발생할 수 있습니다.',
  settingsAuto060: '자동 동기화 간격(분)',
  settingsAuto061: '파일 변경 후 자동 동기화까지 대기하는 최소 시간입니다.',
  settingsAuto062: 'GraphRAG 백그라운드 빌드가 보류되어 있습니다.',
  settingsAuto063: '선택한 GraphRAG 모델의 provider가 꺼져 있거나 모델 목록에 없습니다.',
  settingsAuto064: 'GraphRAG 모델이 설정되지 않았습니다.',
  settingsAuto065: '인덱싱 중에는 커뮤니티 빌드를 실행할 수 없습니다.',
  settingsAuto066: '추출된 데이터가 없습니다.',
  settingsAuto067: '{v0}/{v1} 파일 처리 중{v2} — {v3}%',
  settingsAuto068: 'GraphRAG 인덱싱 취소를 요청했습니다.',
  settingsAuto069: '커뮤니티 빌드 완료: {v0}개 커뮤니티, modularity {v1} ({v2}초)',
  settingsAuto070: '원격 LLM 본문 전송 발생',
  settingsAuto071: '원격 LLM 모델을 사용합니다. API 비용이 발생할 수 있습니다. 계속하시겠습니까?',
  settingsAuto072: 'GraphRAG 실행 결과를 가져올 수 없습니다.',
  settingsAuto073: 'GraphRAG 인덱싱이 취소되었습니다.',
  settingsAuto074: 'GraphRAG 완료: {v0}개 처리, {v1}개 스킵, {v2}개 실패',
  settingsAuto075: '파일 형식을 계산하는 중...',
  settingsAuto076: '파일 형식을 불러오지 못했습니다: {v0}',
  settingsAuto077: '인덱싱 중',
  settingsAuto078: '대기 중',
  settingsAuto079: '인덱싱 중: {v0}, 대기 {v1}개',
  settingsAuto080: '{v0}개 문서, {v1}개 벡터',
  settingsAuto081: '임베딩 프로바이더',
  settingsAuto082:
    'API 키는 Providers 탭에서 설정한 값을 사용합니다. 여기서는 임베딩 전용 모델만 선택하세요.',
  settingsAuto083:
    '⚠️ 임베딩 프로바이더/모델 변경은 자동으로 저장되지 않습니다. "저장" 버튼을 클릭해야 적용됩니다. 변경 시 기존 임베딩 데이터가 삭제되지 않습니다. 새 모델을 모든 데이터에 적용하려면 "전체 재인덱싱"을 실행하세요.',
  settingsAuto084: '임베딩에 사용할 프로바이더를 선택하세요',
  settingsAuto085: '임베딩 모델 ID를 직접 입력하세요',
  settingsAuto086: '예: my-custom-model',
  settingsAuto087: '사용할 임베딩 모델을 선택하세요',
  settingsAuto088: '저장',
  settingsAuto089: '저장 중...',
  settingsAuto090: '임베딩 설정이 저장되었습니다.',
  settingsAuto091: '임베딩 설정 저장 실패: {v0}',
  settingsAuto092: '취소',
  settingsAuto093: '임베딩 설정 변경이 취소되었습니다.',
  settingsAuto094: '연결 테스트',
  settingsAuto095: '모델/태그 목록만 조회합니다. 임베딩 생성 요청을 보내지 않습니다.',
  settingsAuto096: '✅ 연결 성공! {v0}개 모델 확인됨',
  settingsAuto097: '❌ 연결 실패: {v0}',
  settingsAuto098: '❌ 오류: {v0}',
  settingsAuto099: '임베딩 생성 테스트',
  settingsAuto100:
    '선택된 임베딩 모델로 실제 최소 요청을 보냅니다. 프로바이더에 따라 과금될 수 있습니다.',
  settingsAuto101: '✅ 임베딩 생성 성공: {v0}',
  settingsAuto102: '❌ 임베딩 생성 실패: {v0}',
  settingsAuto103: '인덱스 통계',
  settingsAuto104: '통계를 불러올 수 없습니다.',
  settingsAuto105: 'RAG 인덱서가 초기화되지 않았습니다.',
  settingsAuto106: '전체 문서',
  settingsAuto107: 'RAG 대상 파일',
  settingsAuto108: '정상',
  settingsAuto109: '현재 벡터가 최신인 문서',
  settingsAuto110: '업데이트 필요',
  settingsAuto111: '미인덱싱/수정됨/확인 필요',
  settingsAuto112: '전체 벡터',
  settingsAuto113: '저장된 임베딩 벡터 개수',
  settingsAuto114: '{v0} · {v1}개',
  settingsAuto115: '현재 상태: {v0}',
  settingsAuto116: '현재 상태: {v0} · 마지막 상태 계산: {v1}',
  settingsAuto117: '마지막 상태 계산: {v0}',
  settingsAuto118: '현재 상태',
  settingsAuto119: '필요 작업',
  settingsAuto120: '자동 업데이트',
  settingsAuto121: '임베딩: {v0} / {v1}',
  settingsAuto122: '미설정',
  settingsAuto123: '저장소: {v0}',
  settingsAuto124: '성능 보호: {v0}',
  settingsAuto125: '진행 중인 인덱싱 확인',
  settingsAuto126: '약 {v0}초 후 재개',
  settingsAuto127: '필요 문서 업데이트',
  settingsAuto128: '필요 시 전체 재인덱싱',
  settingsAuto129: 'RAG 대상 문서 없음',
  settingsAuto130: '인덱싱이 실행 중입니다. 오래 걸리거나 Obsidian이 느려지면 중단할 수 있습니다.',
  settingsAuto131: '성능 보호 때문에 잠시 대기 중입니다. 원인: {v0}',
  settingsAuto132: '느린 인덱싱 감지',
  settingsAuto133:
    '{v0}개 문서가 검색 품질에 반영되지 않았습니다. 필요 문서 업데이트를 실행하세요.',
  settingsAuto134:
    '현재 인덱스는 최신입니다. 모델이나 저장소를 바꾼 경우에만 전체 재인덱싱이 필요합니다.',
  settingsAuto135:
    '현재 설정 기준으로 RAG 대상 문서가 없습니다. 제외 경로나 파일 형식을 확인하세요.',
  settingsAuto136: '꺼짐',
  settingsAuto137: '켜짐 · {v0}',
  settingsAuto138: '켜짐',
  settingsAuto139: '다음 자동 업데이트: {v0}',
  settingsAuto140: '마지막 자동 업데이트: {v0}개 문서, {v1}개 벡터',
  settingsAuto141: '최근 건너뜀: {v0}',
  settingsAuto142: '상태 없음',
  settingsAuto143: '대기 중 · 약 {v0}초 남음',
  settingsAuto144: '속도 조절 중 · 배치 {v0}, 대기 {v1}ms',
  settingsAuto145: '정상 · 배치 {v0}, 대기 {v1}ms',
  settingsAuto146: '문서 상태를 확인하는 중...',
  settingsAuto147: 'RAG 인덱서가 초기화되지 않아 문서 목록을 계산할 수 없습니다.',
  settingsAuto148: '업데이트가 필요한 문서가 없습니다.',
  settingsAuto149: '업데이트가 필요한 문서',
  settingsAuto150: '문서 상태를 불러오지 못했습니다: {v0}',
  settingsAuto151:
    '{v0}개 문서에 업데이트가 필요합니다. 미인덱싱 {v1}개, 수정됨 {v2}개, 확인 필요 {v3}개. 아래에는 최대 10개만 표시됩니다.',
  settingsAuto152: '미인덱싱',
  settingsAuto153: '수정됨',
  settingsAuto154: '확인 필요',
  settingsAuto155: 'Providers 탭에서 "{v0}"을 먼저 활성화하세요.',
  settingsAuto156: 'Providers 탭에서 "{v0}" API Key를 입력하세요.',
  settingsAuto157: '임베딩 모델을 선택하고 저장하세요.',
  settingsAuto158: 'Providers 탭에서 "{v0}"의 Enabled 토글을 켜주세요.',
  settingsAuto159: 'Providers 탭에서 "{v0}"의 API Key를 입력하세요.',
  settingsAuto160:
    '임베딩 모델이 선택되지 않았습니다. Embedding Provider 섹션에서 모델을 선택하고 "저장" 버튼을 클릭하세요.',
  settingsAuto161: '임베딩 모델 ID를 직접 입력하고 "저장" 버튼을 클릭하세요.',
  settingsAuto162:
    '프로바이더 "{v0}"({v1}) 연결에 실패했습니다. Base URL이나 API Key를 확인하세요.',
  settingsAuto163: '필요한 작업 실행',
  settingsAuto164: 'RAG 인덱서가 초기화되지 않았습니다. ',
  settingsAuto165: '{v0}개 문서 업데이트 시작...',
  settingsAuto166: '{v0}개 문서 업데이트 완료, {v1}개 문서 스킵됨',
  settingsAuto167: '인덱싱이 중단되었습니다.',
  settingsAuto168: '인덱싱 실패: {v0}',
  settingsAuto169: '전체 재인덱싱',
  settingsAuto170: '전체 재인덱싱 시작...',
  settingsAuto171: '{v0}개 파일 재인덱싱 완료',
  settingsAuto172: '재인덱싱 실패: {v0}',
  settingsAuto173: '인덱싱 중단',
  settingsAuto174: '지금 재개',
  settingsAuto175: '버튼 상태를 확인하는 중...',
  settingsAuto176: '임베딩 데이터 초기화',
  settingsAuto177: '모든 임베딩 데이터를 삭제하시겠습니까? 복구할 수 없습니다.',
  settingsAuto178: '모든 임베딩 데이터가 초기화되었습니다.',
  settingsAuto179: '초기화 실패: {v0}',
  settingsAuto180: '실행할 작업을 선택하세요.',
  settingsAuto181: '핵심 인덱싱 제외 대상',
  settingsAuto182: '자동 업데이트와 성능 튜닝',
  settingsAuto183: '설정된 간격으로 새 파일을 자동으로 인덱싱합니다',
  settingsAuto184: '성능 튜닝',
  settingsAuto185:
    '기본값은 임베딩 프로바이더에 맞춰 자동으로 적용하고, 필요할 때만 직접 조정합니다.',
  settingsAuto186: '자동',
  settingsAuto187: '수동',
  settingsAuto188: '자동 조절 중 · 최대 배치 {v0} · 요청 간격과 부하는 실시간으로 최적화됩니다.',
  settingsAuto189: '성능 보호',
  settingsAuto190: '인덱싱 중 Obsidian이 느려지면 배치 크기와 대기 시간을 자동으로 조절합니다.',
  settingsAuto191: '임베딩 배치 크기',
  settingsAuto192: '한 번에 임베딩 요청으로 보낼 청크 수입니다. Ollama 로컬 모델은 1을 권장합니다.',
  settingsAuto193: '배치 사이 대기 시간(ms)',
  settingsAuto194: '연속 인덱싱 배치 사이에 메인 스레드가 쉴 시간을 둡니다.',
  settingsAuto195: '느림 감지 임계값',
  settingsAuto196: '이벤트 루프 지연(ms)과 배치 처리 시간(ms)을 기준으로 자동 완화를 시작합니다.',
  settingsAuto197: '벡터 저장소 유형',
  settingsAuto198: '검색 품질 튜닝',
  settingsAuto199: '채팅 세션 저장 위치와 자동 저장 방식을 관리합니다.',
  settingsAuto200: '시스템 프롬프트',
  settingsAuto201: '전역 기본 프롬프트와 빠른 프리셋을 관리합니다.',
  settingsAuto202: 'MCP 도구 실행',
  settingsAuto203: '멘션한 MCP 서버와 도구 호출 재시도 정책을 조정합니다.',
  settingsAuto204: '지식 연결',
  settingsAuto205: '노트 사이의 연결과 링크 후보를 우선 제안합니다.',
  settingsAuto206:
    '당신은 Obsidian 볼트 기반 지식 연결 보조자입니다. 제공된 Vault Context와 명시적 파일/폴더 멘션을 우선 근거로 삼으세요. Vault Context에 없는 문서명은 출처로 쓰지 말고, 연결할 만한 링크 후보와 새 노트 구조는 반드시 "제안"으로 분리하세요. 근거와 추론을 구분하고, 확실하지 않은 내용은 꾸며내지 마세요.',
  settingsAuto207: '출처 기반 답변',
  settingsAuto208: '볼트 컨텍스트의 출처와 한계를 분명히 드러냅니다.',
  settingsAuto209:
    '당신은 Obsidian 볼트의 출처 기반 답변 보조자입니다. Vault Context에 포함된 파일 경로와 헤딩을 우선 확인하고, 근거가 있는 주장과 사용자의 질문에서 추론한 내용을 분리하세요. 관련 컨텍스트가 부족하면 답을 꾸미지 말고 필요한 노트나 추가 질문을 요청하세요.',
  settingsAuto210: '연구 노트',
  settingsAuto211: '근거, 쟁점, 후속 질문을 연구 노트 형태로 정리합니다.',
  settingsAuto212:
    '당신은 Obsidian 연구 노트 보조자입니다. 사용자의 질문에 답할 때 핵심 주장, 근거, 반론 또는 불확실성, 후속 조사 질문을 구분하세요. Vault Context에 없는 문서명은 출처로 쓰지 말고, 볼트 안 관련 노트와 연결 후보는 "제안"으로 분리하세요. 연구 노트에 바로 붙일 수 있는 Markdown 구조로 답하세요.',
  settingsAuto213: '프로젝트 노트',
  settingsAuto214: '결정 사항, 작업 항목, 리스크를 분명히 나눕니다.',
  settingsAuto215:
    '당신은 Obsidian 프로젝트 노트 보조자입니다. 답변은 결정 사항, 작업 항목, 리스크, 다음 행동을 중심으로 구성하세요. Vault Context를 근거로 사용하고, Vault Context에 없는 문서명은 출처로 쓰지 마세요. 관련 프로젝트 노트 링크 후보와 후속 정리 위치는 "제안"으로 분리하세요.',
  settingsAuto216: '글쓰기 초안',
  settingsAuto217: '볼트의 기존 맥락을 살려 개요와 문단 전개를 돕습니다.',
  settingsAuto218:
    '당신은 Obsidian 글쓰기 보조자입니다. 볼트의 기존 노트 맥락과 사용자의 의도를 존중해 개요, 문단 전개, 제목 후보, 연결할 노트를 제안하세요. 사용자가 요청하지 않은 단순 요약이나 번역으로 흐르지 말고, 노트로 발전 가능한 초안을 만드세요.',
  settingsAuto219: '{v0} 프리셋이 보관함에 저장되고 전역 기본값으로 적용되었습니다.',
  settingsAuto220: '시스템 프롬프트가 초기화되었습니다.',
  settingsAuto221: '연결 상태',
  settingsAuto222: '활성 MCP 서버의 연결 상태를 확인하고 재연결합니다.',
  settingsAuto223: '표준 mcpServers JSON으로 서버를 편집합니다. 유효한 JSON은 자동 저장됩니다.',
  settingsAuto224: 'MCP PATH 자동 조회는 Obsidian 데스크톱 앱에서만 사용할 수 있습니다.',
  settingsAuto225: '⚠️ 저장됨, {v0}개 서버 연결 실패',
  settingsAuto226: '⚠️ 설정은 저장되었으나 {v0}개 서버 연결 실패',
  settingsAuto227: 'MCP 연결 오류:\n{v0}',
  settingsAuto228: 'JSON 형식 오류',
  settingsAuto229:
    '❌ {v0}\n\n✅ 예시:\n  {\n    "mcpServers": {\n      "my-server": {\n        "command": "npx",\n        "args": ["-y", "@modelcontextprotocol/server-filesystem"]\n      }\n    }\n  }',
  settingsAuto230: '"mcpServers" 키 누락',
  settingsAuto231: '❌ {v0}\n\n✅ 예시:\n  {\n    "mcpServers": { ... }\n  }',
  settingsAuto232: '"mcpServers" 형식 오류',
  settingsAuto233:
    '❌ {v0}\n\n✅ 예시:\n  {\n    "mcpServers": {\n      "server-name": { ... }\n    }\n  }',
  settingsAuto234: '서버 설정 누락',
  settingsAuto235:
    '❌ {v0}\n\n✅ 예시:\n  "my-server": {\n    "command": "npx",\n    "args": ["-y", "@modelcontextprotocol/server-filesystem"]\n  }',
  settingsAuto236: '"args" 형식 오류',
  settingsAuto237:
    '❌ {v0}\n\n✅ 예시:\n  "args": ["-y", "@modelcontextprotocol/server-filesystem"]',
  settingsAuto238: '"env" 형식 오류',
  settingsAuto239: '❌ {v0}\n\n✅ 예시:\n  "env": {\n    "API_KEY": "secret"\n  }',
  settingsAuto240: 'JSON 문법 오류',
  settingsAuto241:
    '❌ JSON 문법 오류: {v0}\n\n확인 항목:\n• 마지막 속성 뒤에 쉼표(,)가 없는지\n• 따옴표(")가 짝을 이루는지\n• 중괄호({})와 대괄호([])가 짝을 이루는지',
  settingsAuto242: '플러그인 인식 생성',
  settingsAuto243: '활성 플러그인 정보를 LLM 프롬프트에 포함해 Obsidian 문법 호환성을 높입니다.',
  settingsAuto244: '표시 이름',
  settingsAuto245: '예: LM Studio',
  settingsAuto246: '예: http://localhost:1234/v1',
  settingsAuto247: 'CORS 우회 (requestUrl)',
  settingsAuto248: 'Obsidian 내부 API로 요청을 보내 CORS 문제를 우회합니다. ',
  settingsAuto249: '스트리밍이 비활성화되므로, 서버가 CORS를 지원하면 해제하는 것을 권장합니다.',
  settingsAuto250: '모델 가져오기...',
  settingsAuto251: '선택됨만 보기',
  settingsAuto252: '{v0}개 선택됨',
  settingsAuto253: '{v0}/{v1}개 모델 표시',
  settingsAuto254: '검색 조건에 맞는 모델이 없습니다.',
  settingsAuto255: '모델 가져오기',
  settingsAuto256: '모델/태그 목록만 조회합니다. 토큰 생성 요청을 보내지 않습니다.',
  settingsAuto257: '모델 가져오기',
  settingsAuto258: '✅ 모델 {v0}개를 가져왔습니다.',
  settingsAuto259: '❌ 모델 가져오기 실패: {v0}',
  settingsAuto260: '✅ 연결 성공: 모델 {v0}개 확인됨',
  settingsAuto261: '최소 생성 테스트',
  settingsAuto262:
    '선택된 첫 모델로 실제 최소 생성 요청을 보냅니다. 프로바이더에 따라 과금될 수 있습니다.',
  settingsAuto263: '❌ 최소 생성 테스트 전에 모델을 하나 이상 선택하세요.',
  settingsAuto264: '✅ 최소 생성 성공: {v0}',
  settingsAuto265: '❌ 최소 생성 실패: {v0}',
  settingsAuto266:
    'LM Studio, vLLM, LiteLLM처럼 OpenAI v1 인터페이스를 제공하는 서버를 등록합니다.',
  settingsAuto267: '프로바이더 삭제',
  settingsAuto268: '프로바이더 추가',
  settingsAuto269: 'MCP 재연결',
  settingsAuto270: '{v0}개 서버 실패',
  settingsAuto271: 'reconnectMCP 는 함수가 없습니다.',
  settingsAuto272: '재연결 중...',
  settingsAuto273: 'MCP 연결 상태가 갱신되었습니다.',
  settingsAuto274: '{v0} (현재 선택됨)',

  // MCP PATH
  mcpPathTitle: 'MCP PATH 환경변수',
  mcpPathDesc: 'MCP 서버 실행 시 사용할 PATH 값을 설정합니다. 비워두면 기본 PATH를 사용합니다.',
  mcpPathFetch: '터미널에서 PATH 불러오기',
  mcpPathFetching: '불러오는 중...',
  mcpPathFetchSuccess: '터미널 PATH 불러오기 완료',
  mcpPathFetchError: '터미널 PATH 불러오기 실패',
  mcpPathFetchErrorHelp:
    '자동 조회가 실패하면 터미널의 printenv PATH 값을 직접 입력하거나 MCP command를 절대경로로 설정하세요.',
  mcpPathPlaceholder: '예: /opt/homebrew/bin:/usr/local/bin:/usr/bin',
  mcpPathCommandNotFoundHint:
    'MCP PATH에 터미널 PATH를 저장하거나 "{command}"를 절대경로로 설정하세요. macOS에서 Obsidian을 GUI로 실행하면 npx/uvx 같은 명령을 찾지 못할 수 있습니다.',
  mcpIncludeWslPath: 'WSL PATH도 함께 조회',
  mcpIncludeWslPathDesc:
    'Windows에서 PATH를 불러올 때 WSL의 PATH도 추가로 조회합니다. WSL 내부 Linux 실행 파일은 Windows에서 직접 실행되지 않으므로 WSL 기반 MCP 서버는 command를 wsl.exe로 설정하세요.',

  // MCP
  mcpCommand: '명령어',
  mcpCommandDesc: 'stdio 실행 명령어',
  mcpArgs: '인자',
  mcpArgsDesc: 'stdio 실행 인자 (공백으로 구분)',
  addMcpServer: 'MCP 서버 추가',
  deleteMcpServer: '삭제',
  mcpStatus: 'MCP 상태',
  mcpTotalActive: '활성 {count} / 전체 {total}',
  mcpConnected: '연결됨',
  mcpDisconnected: '연결 안 됨',
  mcpConnectionFailed: '연결 실패',
  mcpConnectionHealth: '연결 상태',
  mcpNoServers: '등록된 MCP 서버가 없습니다.',
  mcpInitFailed: 'MCP 서버 "{name}" 연결 실패: {error}',
  mcpStatusConnected: '연결됨',
  mcpStatusConnecting: '연결 중',
  mcpStatusDisconnected: '연결 안 됨',
  mcpStatusError: '오류',
  mcpJsonEditor: 'JSON 편집기',
  mcpJsonSaved: '설정이 저장되었습니다.',
  mcpJsonInvalid: 'JSON 파싱 오류',
  mcpJsonInvalidObject: 'JSON은 객체({})여야 합니다.',
  mcpJsonMissingMcpServers: '"mcpServers" 키가 누락되었습니다.',
  mcpJsonInvalidMcpServers: '"mcpServers"는 객체여야 합니다.',
  mcpJsonInvalidServerValue: '서버 값이 객체가 아닙니다',
  mcpJsonServerNeedsCommand: '서버는 "command"가 필요합니다',
  mcpJsonInvalidArgs: '"args"는 배열이어야 합니다',
  mcpJsonInvalidEnv: '"env"는 객체여야 합니다',
  mcpJsonInvalidArray: 'mcpServers는 반드시 배열(JSON Array)이어야 합니다.',
  mcpJsonLinting: 'JSON 검사 중...',
  mcpJsonLintOk: 'JSON 문법 OK',
  mcpJsonLintError: 'JSON 문법 오류: {error}',
  mcpJsonSchemaError: '스키마 오류: {field} 필드가 누락되었습니다',
  mcpJsonLine: '줄',
  mcpJsonAutoSave: '자동 저장',
  mcpJsonAutoSaveDesc: 'JSON 편집 후 1초 후 자동 저장 (JSON이 유효할 때만)',
  totalLabel: '전체',

  // Settings Header
  settingsTitle: 'Superpower Inside — 설정',
  securityWarning:
    '경고: 설정과 API 키는 암호화되지 않은 값으로 이 기기의 Obsidian 로컬 저장소와 플러그인 data.json에 저장됩니다. 볼트 동기화, 로컬 백업, 같은 기기에 접근할 수 있는 사용자에게 노출될 수 있습니다.',

  // Tabs
  tabGeneral: '일반',
  tabProviders: '프로바이더',
  // Providers tab common actions
  collapseAll: '모두 접기',
  expandAll: '모두 펼치기',
  modelCountBadge: '개 모델',
  noProviderEnabledBanner: '채팅에 사용할 프로바이더를 하나 이상 활성화하고 모델을 선택하세요.',
  providerConnectionSection: '연결 설정',
  providerDetailContextLabel: '연결 세부 설정',
  providerModelsSection: '모델 선택',
  providerActionsSection: '테스트 및 동작',
  selectedOnly: '선택됨만 보기',
  fetchModels: '모델 가져오기',
  testGeneration: '최소 생성 테스트',
  providerCommandCenterTitle: 'LLM 연결 관제판',
  providerCommandCenterDesc:
    '채팅, RAG, GraphRAG가 사용할 provider 준비 상태를 한 화면에서 정리합니다.',
  providerConnectionTitle: '프로바이더 연결',
  providerSummaryLine:
    '{ready}개 사용 가능 · {attention}개 확인 필요 · 채팅 {general} · 임베딩 {embedding}',
  providerSummaryNoProfiles: '연결된 프로바이더가 없습니다.',
  providerStatusSectionTitle: '현재 상태',
  providerStatusSectionDesc: '채팅과 검색에 사용할 프로바이더의 준비 상태를 확인합니다.',
  providerStatusNone: '아직 없음',
  providerStatusNeedsSetup: '{count}개 설정 필요',
  providerStatusSummaryDetail: '전체 {total}개 중 {enabled}개 활성, {ready}개 준비됨',
  providerAttentionTitle: '{provider} 설정을 마무리하세요',
  providerContinueSetup: '설정 계속',
  providerAddTitle: '새 프로바이더 연결',
  providerAddDesc: 'OpenAI, Claude, Ollama 또는 OpenAI 호환 서버를 추가합니다.',
  providerConnectionsSectionTitle: '연결 목록',
  providerConnectionsSectionDesc: '프로바이더를 펼쳐 연결 정보와 사용할 모델을 관리합니다.',
  providerConnectionsEmpty: '연결된 프로바이더가 없습니다. 위에서 새 연결을 추가하세요.',
  providerNewName: '새 프로바이더',
  providerDangerTitle: '프로바이더 제거',
  providerDangerDesc: '이 연결과 저장된 모델 설정을 삭제합니다.',
  providerRemoveWarning: '{provider} 연결과 모델 목록이 설정에서 제거됩니다.',
  providerRemoveConfirm: '{provider} 프로바이더를 제거할까요?',
  providerRemoved: '{provider} 프로바이더를 제거했습니다.',
  providerModelCountLine: '{provider} · 채팅 {general} · 임베딩 {embedding}',
  providerApiKeyShow: 'API 키 보기',
  providerApiKeyHide: 'API 키 숨기기',
  providerDashboardReady: '준비 완료',
  providerDashboardReadyDetail: '바로 사용할 수 있는 provider',
  providerDashboardAttention: '조치 필요',
  providerDashboardAttentionDetail: '키 또는 모델 선택 필요',
  providerDashboardEnabled: '활성',
  providerDashboardEnabledDetail: '켜져 있는 provider',
  providerDashboardModels: '선택 모델',
  providerDashboardModelsDetail: '등록된 채팅 모델',
  providerSetupEnableTitle: 'Provider 켜기',
  providerSetupEnableDetail: '쓸 서비스만 활성화해 설정 화면 밀도를 낮춥니다.',
  providerSetupAuthTitle: '인증 입력',
  providerSetupAuthDetail: '로컬 provider는 키 없이, 원격 provider는 API 키로 연결합니다.',
  providerSetupModelsTitle: '모델 정리',
  providerSetupModelsDetail: '모델 검색 후 실제로 쓸 모델만 카드에 남깁니다.',
  providerSetupValidateTitle: '짧게 검증',
  providerSetupValidateDetail: '연결 테스트와 최소 생성 테스트로 실패 지점을 바로 확인합니다.',
  providerStatusReady: '준비됨',
  providerStatusNeedsKey: '키 필요',
  providerStatusNeedsModels: '모델 필요',
  providerStatusOff: '꺼짐',
  providerSummaryReady: '{v0}개 모델로 사용 가능',
  providerSummaryNeedsKey: 'API Key를 입력하면 사용 가능',
  providerSummaryNeedsModels: '모델을 하나 이상 선택하세요',
  providerSummaryOff: '필요할 때 켜서 사용',
  providerKeyReady: '키 준비됨',
  providerKeyMissing: '키 필요',
  providerKeyNotRequired: '키 불필요',
  providerModelChatVerified: 'Chat 확인됨',
  providerModelChatUnknown: 'Chat 미검증',
  providerModelChatFailed: 'Chat 실패',
  providerModelEmbeddingVerified: 'Embedding 확인됨',
  providerModelEmbeddingUnknown: 'Embedding 미검증',
  providerModelEmbeddingFailed: 'Embedding 실패',
  providerTestChatModel: '이 모델 최소 생성 테스트',
  providerTestEmbeddingModel: '이 모델 임베딩 테스트',
  providerEmbeddingUnsupported: '이 provider는 임베딩 테스트를 지원하지 않습니다.',
  providerModelsSelected: '{v0}개 선택',
  providerNoModelsShort: '모델 없음',
  providerTypeBuiltIn: '기본 제공',
  providerTypeCustom: '커스텀',
  providerQuickKey: '인증',
  providerQuickModels: '모델',
  providerQuickType: '유형',
  providerCustomDockTitle: 'Custom OpenAI-Compatible',
  providerCustomDockDesc: '로컬 서버나 사내 OpenAI 호환 endpoint를 같은 카드 흐름에서 관리합니다.',
  providerStrategyLabel: '프로바이더 종류',
  providerStrategyDesc: '이 프로필이 어떤 API 방식으로 연결할지 선택합니다.',
  providerBaseUrl: '엔드포인트 URL',
  providerGeneralModels: '일반 모델',
  providerEmbeddingModels: '임베딩 모델',
  providerGeneralModelsDesc: '채팅과 GraphRAG 생성',
  providerEmbeddingModelsDesc: 'RAG 인덱싱과 검색',
  providerAddGeneralModel: '일반 모델 추가',
  providerAddEmbeddingModel: '임베딩 모델 추가',
  providerImportModelsTitle: '가져올 모델 선택',
  providerImportModelsDesc: '{v0}에서 가져온 모델 중 사용할 모델만 선택합니다.',
  providerImportSearchPlaceholder: '모델 이름 검색',
  providerImportAddSelected: '선택한 모델 추가',
  providerImportCount: '{v0}개 선택 / {v1}개 표시',
  providerImportNoNewModels: '새로 추가할 모델이 없습니다.',
  providerImportNoMatches: '검색 결과가 없습니다.',
  providerImportContext: '컨텍스트 {v0}',
  providerImportMoreResults: '{v0}개 더 있습니다. 검색어를 입력해 좁혀 보세요.',
  providerImportAdded: '{v0}개 모델을 추가했습니다.',
  tabRag: 'RAG',
  tabChat: '채팅',
  tabMcp: 'MCP',
  tabAdvanced: '고급',

  // Commands
  mcpAutoConnectFailedCount: 'MCP 자동 연결 실패: {count}개 서버를 확인하세요.',
  mcpAutoConnectFailedMessage: 'MCP 자동 연결 실패: {message}',
  ragIndexerNotInitializedBase: 'RAG 인덱서가 초기화되지 않았습니다.',
  ragIndexerEnableProvider: 'Providers 탭에서 "{provider}"의 Enabled 토글을 켜주세요.',
  ragIndexerEnterApiKey: 'Providers 탭에서 "{provider}"의 API Key를 입력하세요.',
  ragIndexerSelectEmbeddingModel:
    '임베딩 모델이 선택되지 않았습니다. 설정 → RAG에서 모델을 선택하고 저장하세요.',
  ragIndexerConnectionFailed:
    '"{provider}"({model}) 연결에 실패했습니다. Base URL이나 API Key를 확인하세요.',
  ragIndexerLastInitError: '마지막 초기화 오류: {message}',
  ragIndexerLastInitSkipped: '마지막 초기화 중단 사유: {reason}',
  ragRuntimeInitStepTimedOut:
    'RAG 런타임 초기화가 "{stage}" 단계에서 {seconds}초 동안 완료되지 않았습니다.',
  vaultIndexingStarted: '볼트 인덱싱 시작...',
  vaultIndexingDone: '{count}개 파일 인덱싱 완료',
  indexingCancelled: '인덱싱이 중단되었습니다.',
  indexingFailedWithMessage: '인덱싱 실패: {message}',
  ragIdle: '대기 중',
  ragStatsFailed: '통계 계산 실패',
  graphRagAutoSyncStarted: 'GraphRAG 자동 동기화 시작...',
  graphRagAutoSyncDone: 'GraphRAG 자동 동기화 완료: {processed}개 처리, {failed}개 실패',
  graphRagStaleSyncStatusNotice: 'GraphRAG {label}: {description}',
  graphRagRunNoopNotice:
    'GraphRAG 추출 실행: 처리할 파일이 없습니다. 모든 파일이 최신 상태이거나 현재 RAG 인덱싱 대상 파일이 없습니다.',
  graphRagFailedRetryNoopNotice:
    'GraphRAG 실패 재시도: 다시 처리할 실패 파일이 없습니다. 탐색기에서 이전 실패가 이미 정리됐는지 확인할 수 있습니다.',
  graphRagStaleSyncNoopNotice:
    'GraphRAG 변경분 동기화: 다시 추출할 파일이 없습니다. 모든 파일이 최신 상태이거나 현재 RAG 인덱스에 남아 있는 변경 후보가 없습니다.',
  ragPerformancePaused: '성능 보호 대기',
  ragPerformanceThrottled: '속도 조절 중',
  ragIndexingInProgress: '인덱싱 중',
  ragIndexingRunning: '인덱싱 중: {phase}',
  ragIndexingRunningWithEta: '인덱싱 중: {phase} - {completed}/{total}개 파일, ETA {eta}',
  ragIndexingRunningWithApproxEta: '인덱싱 중: {phase} - {completed}/{total}개 파일, ETA 약 {eta}',
  ragIndexingRunningEtaCalculating: '인덱싱 중: {phase} - {completed}/{total}개 파일, ETA 계산 중',
  ragIndexingRunningWithEtaReason:
    '인덱싱 중: {phase} - {completed}/{total}개 파일, ETA {eta} ({reason})',
  ragIndexingRunningWithApproxEtaReason:
    '인덱싱 중: {phase} - {completed}/{total}개 파일, ETA 약 {eta} ({reason})',
  ragIndexingRunningEtaCalculatingReason:
    '인덱싱 중: {phase} - {completed}/{total}개 파일, ETA 계산 중 ({reason})',
  ragEtaReasonComplete: '완료됨',
  ragEtaReasonPlannedStable: '계획된 청크와 안정적인 최근 속도 기준',
  ragEtaReasonPlannedVariableRate: '계획은 끝났지만 최근 속도 변동이 큼',
  ragEtaReasonPlannedPartial: '계획된 청크와 일부 진행 샘플 기준',
  ragEtaReasonInsufficientSamples: '아직 진행 샘플이 부족함',
  ragEtaReasonCalibrationVariable: '이전 파일 예측 오차가 큼',
  ragEtaReasonCalibratedEstimate: '완료된 파일의 보정된 속도 기준',
  ragEtaReasonBatchRateOnly: '최근 배치 속도만 기준',
  ragEtaReasonElapsedRateOnly: '전체 경과 속도만 기준',
  ragIndexingResult: '{documents}개 문서, {vectors}개 벡터',
  ragPhaseFile: '변경 파일',
  ragPhasePending: '필요 문서 업데이트',
  ragPhaseAll: '전체 재인덱싱',
  ragPhaseIdle: '대기',
  ragAutoUpdateAlreadyRunning: '인덱싱이 이미 실행 중입니다.',
  ragAutoUpdatePausedRetry: '성능 보호 대기 중입니다. 약 {seconds}초 후 다시 시도할 수 있습니다.',
  ragAutoUpdateNoTargets: '업데이트 대상 없음',
  vectorStoreDescriptionJson:
    'JSON File은 볼트 내부의 .superpower-inside/vectors.json에 저장되어 Obsidian Sync, Git, 파일 백업에 포함하기 쉽지만, 벡터가 커질수록 파일 읽기/쓰기와 동기화 충돌 부담이 커집니다.',
  vectorStoreDescriptionIndexedDb:
    'IndexedDB는 Obsidian/Electron의 로컬 브라우저 DB에 저장되어 대용량 구조화 데이터와 인덱스 조회에 더 적합하고 볼트 파일을 변경하지 않지만, 장치별 로컬 데이터라 볼트 동기화나 Git 백업에 자동 포함되지 않습니다.',
  vectorStoreTransferToIndexedDb:
    'IndexedDB는 기존 JSON 벡터를 자동 복사하지 않습니다. 전체 재인덱싱을 실행하거나 JSON File 저장소로 되돌리세요.',
  vectorStoreTransferToJson:
    'JSON File은 기존 IndexedDB 벡터를 자동 복사하지 않습니다. 전체 재인덱싱을 실행하거나 IndexedDB 저장소로 되돌리세요.',
  unsetLabel: '미설정',
  chatFolderExcludeCurrentDesc:
    '채팅 저장 폴더를 RAG 인덱싱 대상에서 자동으로 제외합니다. 현재 제외 대상: {folder}',
  ragNoUpdates: '업데이트가 필요한 문서가 없습니다.',
  ragNoDocuments: 'RAG 대상 문서가 없습니다.',
  ragNoPendingUpdatesNotice: '이미 최신입니다.',
  ragNoDocumentsNotice: '인덱싱할 RAG 대상 문서가 없습니다.',
  ragIndexCancelRequestedNotice: '인덱싱 취소를 요청했습니다.',
  ragIndexResumeRequestedNotice: '인덱싱을 재개했습니다.',
  ragNoRunningIndexing: '실행 중인 인덱싱이 없습니다.',
  ragNotPerformancePaused: '성능 보호 대기 상태가 아닙니다.',
  graphRagStatusDisabledLabel: '빌드 보류',
  graphRagStatusDisabledDesc:
    '긴 GraphRAG 추출 작업만 보류되어 있습니다. 준비된 그래프 데이터는 일반 채팅에서 계속 보강으로 사용됩니다.',
  graphRagStatusNotBuiltLabel: '미생성',
  graphRagStatusNotBuiltDesc:
    'GraphRAG 인덱스가 아직 생성되지 않았습니다. 시작 버튼으로 생성하세요.',
  graphRagStatusBuildingLabel: '생성 중',
  graphRagStatusBuildingDesc: '지식 그래프를 추출하고 있습니다. 완료까지 기다려 주세요.',
  graphRagStatusReadyLabel: '준비됨',
  graphRagStatusReadyDesc: 'GraphRAG가 최신 상태입니다. 질문 시 지식 그래프를 활용합니다.',
  graphRagStatusStaleLabel: '동기화 필요',
  graphRagStatusStaleDesc:
    '일부 파일이 수정되거나 추출 모델/온톨로지 규칙이 바뀌어 재추출이 필요합니다.',
  graphRagStatusPartialLabel: '부분 완료',
  graphRagStatusPartialDesc:
    '일부 파일 추출에 실패했습니다. 실패한 파일만 다시 시도할 수 있습니다.',
  graphRagDisabledReason: 'GraphRAG 백그라운드 빌드가 보류되어 있습니다.',
  graphRagProviderMissingReason:
    '선택한 GraphRAG 모델의 provider를 활성화하고 모델 목록에 추가하세요.',
  graphRagModelMissingReason: 'GraphRAG 추출 모델을 선택하세요.',
  graphRagAlreadyRunningReason: 'GraphRAG 인덱싱이 이미 실행 중입니다.',
  graphRagNoFilesReason: 'GraphRAG 인덱싱 대상 파일이 없습니다.',
  graphRagNoRunningReason: '실행 중인 GraphRAG 인덱싱이 없습니다.',
  graphRagNoFailedReason: '이어 실행할 실패 파일이 없습니다.',
  graphRagLiveStatusRunningTitle: '지금 GraphRAG가 인덱싱 중입니다',
  graphRagLiveStatusIdleTitle: 'GraphRAG 인덱싱 대기 중',
  graphRagLiveStatusIdleDetail: '실행 중인 GraphRAG 인덱싱이 없습니다.',
  graphRagLiveChunkDetail: '청크 {processed}개 저장 완료',
  graphRagLiveChunkDetailWithFailed: '청크 {processed}개 저장 완료, {failed}개 실패',
  graphRagLiveStorageDetail:
    '저장됨: 증거 {evidence}, 엔티티 {entities}, 관계 {relations}, 클레임 {claims}, 거부 {rejected}',
  graphRagPhaseIdle: '대기 중',
  graphRagPhaseSelectingFiles: '대상 파일 준비 중',
  graphRagPhaseCheckingCache: '추출 캐시 확인 중',
  graphRagPhaseApiWaiting: 'API 응답 대기 중',
  graphRagPhaseApiResponseReceived: 'API 호출 완료',
  graphRagPhaseApiResponseNormalizing: 'API 응답 정리 중',
  graphRagPhaseStoringResults: '추출 결과 저장 중',
  graphRagPhaseFileCompleted: '파일 추출 완료',
  graphRagPhaseBuildingCommunities: '커뮤니티 정리 중',
  graphRagPhaseCompleted: '추출 완료',
  graphRagPhaseCancelled: '취소됨',
  graphRagStartScopeLimited: '대상 {total}개 중 최대 {limit}개 파일을 새로 추출합니다.',
  graphRagStartScopeAll: 'GraphRAG 대상 파일을 새로 추출합니다.',
  graphRagActionExtract: '추출 실행',
  graphRagStartAll: '전체 추출 실행',
  graphRagStartDescription: '{scope} 실패 기록은 해당 파일을 다시 처리할 때 정리됩니다.',
  graphRagCancel: '실행 중지',
  graphRagCancelDesc: '현재 진행 중인 GraphRAG 추출 작업에 취소 요청을 보냅니다.',
  graphRagResumeFailed: '실패만 재시도',
  graphRagResumeFailedWithCount: '실패만 재시도 ({count})',
  graphRagResumeFailedDesc:
    '마지막 실행에서 실패한 파일만 다시 추출합니다. 성공한 파일은 건드리지 않습니다.',
  graphRagSyncStale: '변경분 동기화',
  graphRagSyncStaleWithCount: '변경분 동기화 ({count})',
  graphRagSyncStaleDesc: '수정되었거나 모델/온톨로지 변경으로 오래된 파일만 다시 추출합니다.',
  graphRagMaintain: '그래프 정리',
  graphRagBuildCommunities: '커뮤니티 다시 빌드',
  graphRagBuildCommunitiesDesc:
    '이미 추출된 엔티티/관계로 커뮤니티 요약을 다시 계산합니다. 파일 재추출은 하지 않습니다.',
  graphRagResetData: 'GraphRAG 데이터 초기화',
  graphRagResetDataDesc:
    '증거, 엔티티, 관계, 클레임, 커뮤니티, 캐시를 즉시 삭제하고 진행 상태를 초기화합니다.',
  graphRagResetDataConfirm: 'GraphRAG 추출 데이터 전체를 삭제하고 상태를 초기화하시겠습니까?',
  graphRagResetDataDone: 'GraphRAG 데이터가 초기화되었습니다.',
  graphRagResetDataFailed: 'GraphRAG 데이터 초기화 실패: {v0}',
  graphRagInspect: '결과 확인',
  graphRagOpenExplorer: '탐색기 열기',
  graphRagOpenExplorerDesc: '엔티티, 관계, 증거, 거부된 응답과 오류 코드를 확인합니다.',
  graphRagCostLocal: '로컬 실행',
  graphRagCostRemote: '원격 LLM 본문 전송 발생',
  embeddingDimensionsLabel: '{name} ({dimensions}차원)',
  embeddingProviderModelDesc: 'Providers 탭의 모델 목록에서 가져온 임베딩 모델입니다.',
  embeddingCurrentLabel: '{model} (현재 선택됨)',
  embeddingCurrentDesc:
    '현재 선택된 모델입니다. Providers 탭의 모델 목록이나 기본 프리셋에는 없지만 설정 손실을 막기 위해 유지합니다.',
  overviewProviderOff: '꺼짐',
  overviewProviderKeyNeeded: '키 필요',
  overviewProviderNoModels: '모델 없음',
  overviewReady: '준비됨',
  overviewModelsCount: '{count}개 모델',
  overviewDisabled: '비활성',
  overviewProviderMissingKeyDetail: 'API Key를 입력해야 채팅과 임베딩에서 사용할 수 있습니다.',
  overviewProviderNoModelsDetail: '모델을 하나 이상 선택해야 기본 모델로 사용할 수 있습니다.',
  overviewProviderModelsSelected: '모델 선택됨',
  overviewProviderDisabledDetail: '필요할 때 Providers 탭에서 켤 수 있습니다.',
  overviewProviderCheckModels: '모델 확인',
  overviewProviderSummaryDetail: '{enabled}개 활성, {ready}개 준비됨',
  overviewProviderNoneActive: '활성 Provider가 없습니다.',
  overviewRunning: '실행 중',
  overviewBeforeCalculation: '계산 전',
  overviewRagNotCalculatedDetail: '{embedding} 기준 상태를 아직 계산하지 않았습니다.',
  overviewNoTargets: '대상 없음',
  overviewNeedsCount: '{count}개 필요',
  overviewLatest: '최신',
  overviewNoIndexingTargetFiles: '인덱싱 대상 파일이 없습니다.',
  overviewRagNeedsDetail: '{count}개 문서가 missing/stale/unknown 상태입니다.',
  overviewRagHealthyDetail: '{healthy}/{total}개 문서가 최신입니다.',
  overviewSyncRequired: '동기화 필요',
  overviewGraphRagDisabledDetail:
    '비싼 GraphRAG 추출 작업만 보류되어 있습니다. vector/BM25/structural 검색과 준비된 그래프 보강은 계속 사용할 수 있습니다.',
  overviewNeedsSetup: '설정 필요',
  overviewGraphRagRunnerMissing: 'Runner가 초기화되지 않았습니다.',
  overviewGraphRagExtractingDetail: '추출 인덱싱이 진행 중입니다.',
  overviewGraphRagNotCalculated: 'GraphRAG 상태를 아직 계산하지 않았습니다.',
  overviewGraphRagEvidenceReady: '{count}개 evidence가 준비되어 있습니다.',
  overviewGraphRagStaleValue: '{count}개 stale',
  overviewGraphRagStaleDetail: '파일 수정 또는 모델 변경으로 동기화가 필요합니다.',
  overviewGraphRagPartialDetail: '{count}개 파일 실패가 남아 있습니다.',
  overviewNotReady: '준비 안 됨',
  overviewGraphRagNeedIndexing: 'GraphRAG 인덱싱을 실행해야 합니다.',
  overviewToolCallReady: '도구 호출 준비됨',
  overviewConnectionCheck: '연결 상태를 확인하세요.',
  overviewNone: '없음',
  overviewNoServers: '서버 없음',
  overviewPartialError: '부분 오류',
  overviewError: '오류',
  overviewConnected: '연결됨',
  overviewConnecting: '연결 중',
  overviewDisconnected: '끊김',
  overviewMcpNoServersDetail: '등록된 MCP 서버가 없습니다.',
  overviewMcpErrorsDetail: '{count}개 서버 연결 오류가 있습니다.',
  overviewMcpAllConnected: '모든 MCP 서버가 연결되어 있습니다.',
  overviewMcpSomeDisconnected: '일부 MCP 서버가 연결되지 않았습니다.',
  overviewChatDefaultModel: '기본 모델 {model}',
  overviewChatDefaultUnavailable: '기본 모델이 활성 Provider 모델 목록에 없습니다.',
  overviewProviderApiKeyNeeded: '{provider} API Key 필요',
  overviewChatModelAttention: '기본 모델 확인 필요',
  overviewRagSyncAttention: 'RAG 동기화 필요',
  overviewMcpErrorAttention: 'MCP 연결 오류',
  overviewGraphRagErrorAttention: 'GraphRAG 상태 오류',
  overviewEmbeddingLabel: '{provider} / {model}',
  overviewOpenProviders: '프로바이더 설정',
  overviewOpenGeneral: '기본 모델 선택',
  overviewOpenRag: '검색 설정',
  overviewOpenMcp: 'MCP 설정',
  pluginDataResetTitle: '전체 플러그인 데이터 초기화',
  pluginDataResetDesc:
    '업데이트 이후 설정, 인덱스, 캐시 상태가 꼬였을 때 Superpower Inside 내부 데이터를 기본 상태로 되돌립니다.',
  pluginDataResetWarning:
    '설정, Provider/API Key, MCP 서버, 프롬프트 라이브러리, RAG/GraphRAG 인덱스, 임베딩 캐시가 삭제됩니다. 복구할 수 없습니다.',
  pluginDataResetScope:
    '볼트의 일반 노트와 채팅 세션 Markdown 파일은 삭제하지 않습니다. 내부 data.json, 로컬 설정, IndexedDB, .superpower-inside 데이터만 초기화합니다.',
  pluginDataResetButton: '전체 데이터 초기화',
  pluginDataResetRunning: '초기화 중...',
  pluginDataResetConfirm:
    'Superpower Inside 내부 데이터를 모두 초기화하시겠습니까? 설정과 API Key도 기본값으로 돌아갑니다.',
  pluginDataResetSecondConfirm: '정말 계속할까요? 이 작업은 취소하거나 복구할 수 없습니다.',
  pluginDataResetDone: 'Superpower Inside 내부 데이터가 초기화되었습니다.',
  pluginDataResetFailed: '전체 플러그인 데이터 초기화 실패: {message}',
  mcpToolNotFoundInConnectedServers: '연결된 MCP 서버에서 `{tool}` 도구를 찾을 수 없습니다.',
  mcpServerNotConnected: 'MCP 서버 `{server}`에 연결되어 있지 않습니다.',
  mcpRegistryUnavailableNotice: 'MCP 레지스트리가 초기화되지 않았습니다.',
  mcpClientUnavailableNotice: 'MCP 서버 `{server}` 클라이언트를 찾을 수 없습니다.',
  mcpToolErrorPrefix: '[MCP 도구 오류] {message}',
  mcpToolEmptyResult: 'MCP 도구 `{tool}`가 빈 결과를 반환했습니다.',
  mcpValidationPattern: '입력값의 형식이 올바르지 않습니다. 요구되는 패턴: `{pattern}`',
  mcpValidationField: '필드 `{field}`의 입력값이 잘못되었습니다.',
  mcpValidationGeneric: '입력값 검증에 실패했습니다.',
  refreshAlreadyRunning: '이미 실행 중입니다.',
  refreshFailedWithMessage: '새로고침 실패: {message}',
  refreshCancelled: '취소됨',
  mcpNoExecutableShell: '실행 가능한 shell을 찾을 수 없습니다.',
  mcpNoPowerShellPath: 'PowerShell에서 PATH를 가져올 수 없습니다.',
  mcpDesktopOnly: 'MCP stdio transport는 Obsidian 데스크톱 앱에서만 사용할 수 있습니다.',
  apiKeyUnauthorizedError: 'API 키가 유효하지 않거나 권한이 없습니다 ({status})',
  endpointOrModelNotFoundError: '엔드포인트 또는 모델을 찾을 수 없습니다 ({status})',
  serverStatusError: '서버 오류가 발생했습니다 ({status})',
  apiStatusError: 'API 오류 ({status}): {body}',
  connectionFailedNoServer: '연결 실패: 서버에 접근할 수 없습니다',
  customProviderBaseUrlHint:
    '{error}. Custom provider base URL 또는 /models 지원 여부를 확인하세요.',
  customProviderBaseUrlRequired: 'Custom provider base URL을 입력하세요.',
  ollamaEmbeddingContextTooLong:
    'Ollama 임베딩 모델의 최대 컨텍스트 길이를 초과했습니다. 긴 단일 줄이나 로그 파일은 자동 분할되도록 수정되었으니 플러그인을 다시 빌드한 뒤 RAG 재인덱싱을 실행하세요. 계속 실패하면 해당 파일을 제외하거나 청크 크기(chunkSize)를 더 낮춰보세요. (원본 오류: {error})',
  ragStatusMissingReason: '아직 인덱싱되지 않았습니다.',
  ragStatusLegacyReason: '이전 형식의 벡터라 파일 변경 여부를 확인할 수 없습니다.',
  ragStatusStaleFileReason: '파일이 마지막 인덱싱 이후 수정되었습니다.',
  ragStatusEmbeddingChangedReason: '현재 임베딩 설정과 저장된 벡터 설정이 다릅니다.',
  ragStatusHealthyReason: '최신 상태입니다.',
  perfGuardResumed: '성능 보호 대기 후 최소 배치로 재개됨',
  perfEventLoopLag: '이벤트 루프 지연 {ms}ms',
  perfIndexingBatch: '인덱싱 배치 {ms}ms',
  perfSlowDetected: '느림 감지: {reason}',
  perfPausedWithReason: '성능 보호 대기 중: {reason}',
  ragExcludeSensitiveReason: '민감 정보 가능성이 있어 기본 RAG 대상에서 제외됩니다.',
  ragExcludeUnreadableReason: '텍스트로 안전하게 읽을 수 없어 RAG 대상에서 제외됩니다.',
  noExtensionLabel: '확장자 없음',
  assistantQuestionPrefix: '질문: {question}',
  assistantQuestionSelectedItems: '선택한 항목:',
  assistantQuestionAdditionalInput: '추가 입력:',
  editMessageTitle: '메시지 수정',
  sourceUnverifiedIdWarning: '이번 답변에서 확인한 근거에 없는 출처입니다.',
  sourceMissingVaultLinkWarning: '볼트에서 찾지 못한 문서 링크입니다.',
  referenceMissingWarning: '참조 문서를 찾을 수 없습니다: {path}',
  referenceReadFailedWarning: '참조 문서를 읽을 수 없습니다: {path} ({error})',
  pluginAwareContext7FirstRule:
    '활성 Obsidian 플러그인의 문법, API, 설정, 코드 예시, 쿼리, 템플릿, 자동화 생성이 필요하면 먼저 Context7 MCP 도구로 관련 문서를 조회하세요.',
  pluginAwareContext7NoGuessRule:
    'Context7에서 문서를 찾을 수 없으면 문서가 없다고 명시하고 플러그인 전용 문법을 추측하지 마세요.',
  defaultChatTitle: '새 채팅',
  chatSaveEmptyAssistantWarning:
    '[Superpower Inside] 저장 경고: 메시지 {id}의 content가 비어 있습니다.',
  fileNotFoundError: '파일을 찾을 수 없음: {path}',
  toolResultTruncatedLabel: '일부 생략됨',
  toolApprovalPendingSuffix: ' (승인 대기)',
  rejectedFactInvalidJsonTitle: 'LLM 응답을 JSON으로 파싱할 수 없음',
  rejectedFactInvalidJsonDesc:
    '모델이 GraphRAG 추출 스키마와 맞는 JSON 객체를 반환하지 않았습니다. OpenRouter/free 모델에서는 빈 응답, 설명문, 제한 문구, 잘린 응답이 섞이면 자주 발생합니다.',
  rejectedFactUnknownEntityTitle: '알 수 없는 엔티티 타입',
  rejectedFactUnknownEntityDesc: '이전 추출 계약에서 허용하지 않던 entity type이 기록됐습니다.',
  rejectedFactSchemaShapeTitle: 'JSON 구조가 GraphRAG 추출 스키마와 다름',
  rejectedFactSchemaShapeDesc:
    '응답은 JSON으로 파싱됐지만 entities.name/typeId, relations.relationTypeId, claims.text/claimTypeId 같은 필수 필드 구조를 따르지 않았습니다.',
  rejectedFactUnknownRelationEntityTitle: '관계의 엔티티를 찾을 수 없음',
  rejectedFactUnknownRelationEntityDesc:
    '모델이 relation source/target에 쓴 이름이 같은 응답의 entities 목록과 매칭되지 않았습니다.',
  rejectedFactRelationMismatchTitle: '관계 타입의 source/target 타입 불일치',
  rejectedFactRelationMismatchDesc: '이전 추출 계약에서 거부했던 legacy relation입니다.',
  rejectedFactUnknownClaimTitle: '알 수 없는 claim 타입',
  rejectedFactUnknownClaimDesc: '이전 추출 계약에서 허용하지 않던 claim type이 기록됐습니다.',
  rejectedFactExtractionErrorTitle: '추출 호출 중 오류',
  rejectedFactExtractionErrorDesc: 'LLM 호출, 네트워크, provider 응답 처리 중 예외가 발생했습니다.',
  rejectedFactDefaultTitle: 'GraphRAG 추출 결과가 schema 검증을 통과하지 못함',
  rejectedFactDefaultDesc:
    '모델 응답의 일부 fact가 현재 지식 계약 또는 저장소 검증 규칙과 맞지 않습니다.',
  rejectedFactEmptyResponse: '(빈 응답)',
  defaultObsidianSystemPrompt: [
    '당신은 Obsidian 볼트와 함께 작동하는 지식 작업 보조자입니다.',
    '사용자의 볼트를 개인 지식베이스로 존중하고, 제공된 Vault Context와 명시적으로 멘션된 파일/폴더를 우선 근거로 사용하세요.',
    '근거가 있는 내용과 추론을 구분하고, 확실하지 않은 내용은 꾸며내지 말고 필요한 추가 맥락을 요청하세요.',
    '답변은 사용자의 노트 작성 흐름에 바로 붙일 수 있도록 명확한 Markdown으로 작성하세요.',
    'Vault Context에 없는 문서명은 출처로 쓰지 말고, 새 노트나 링크 후보는 반드시 "제안"으로 분리하세요.',
    '관련 근거가 부족하면 관련 문서를 찾지 못했다고 답하세요.',
    '코드리뷰, 번역, 단순 요약을 기본 역할로 삼지 말고, 사용자가 명시적으로 요청한 경우에만 해당 작업에 집중하세요.',
  ].join('\n'),
  promptPresetKnowledgeConnectionLabel: '지식 연결',
  promptPresetKnowledgeConnectionInstruction:
    '볼트 안의 개념, 파일, 헤딩 사이의 연결을 적극적으로 찾아 사용자가 다음 노트 링크와 지식 구조를 만들 수 있게 돕는다.',
  promptPresetResearchNotesLabel: '연구 노트',
  promptPresetResearchNotesInstruction:
    '근거, 반론, 미해결 질문, 후속 조사 항목을 분리해 연구 노트로 재사용하기 쉬운 답변을 만든다.',
  promptPresetProjectNotesLabel: '프로젝트 노트',
  promptPresetProjectNotesInstruction:
    '결정 사항, 작업 항목, 리스크, 다음 행동을 분명히 나눠 프로젝트 운영 노트에 바로 옮길 수 있게 돕는다.',
  promptPresetDailyReviewLabel: '일일/회고',
  promptPresetDailyReviewInstruction:
    '사용자의 기록을 바탕으로 관찰, 패턴, 회고 질문, 다음 실험을 제안하되 과도한 해석은 피한다.',
  promptPresetWritingDraftLabel: '글쓰기 초안',
  promptPresetWritingDraftInstruction:
    '볼트의 기존 표현과 논지를 존중하면서 초안, 개요, 문단 전개, 제목 후보를 제안한다.',
  promptDefaultTitle: 'Obsidian 지식 작업 기본',
  promptDefaultDescription: '볼트 컨텍스트, 노트 연결, 출처 기반 답변에 맞춘 기본 시스템 프롬프트',
  promptNewSystemPromptTitle: '새 시스템 프롬프트',
  promptLegacyTitle: '이전 사용자 시스템 프롬프트',
  promptLegacyDescription: '기존 설정의 systemPrompt에서 가져온 프롬프트',
  promptDirectionPresetLine: '방향성 프리셋: {label}\n{instruction}',
  promptAdditionalDirectionLine: '추가 방향성: {text}',
  promptGenerationSystemInstruction:
    '당신은 Obsidian 볼트에 맞는 시스템 프롬프트를 설계하는 전문가입니다. 출력은 시스템 프롬프트 본문만 작성하고, 설명이나 머리말은 붙이지 마세요.',
  promptGenerationUserIntro:
    '다음 임베딩 인덱스 요약을 바탕으로 이 볼트의 채팅 탭에서 사용할 한국어 시스템 프롬프트를 작성하세요.',
  promptGenerationRequirementsHeader: '요구사항:',
  promptGenerationRequirementRole: '- Obsidian 볼트 기반 지식 작업 보조자 역할을 중심에 둡니다.',
  promptGenerationRequirementContext:
    '- Vault Context와 명시적 파일/폴더 멘션을 우선하도록 지시합니다.',
  promptGenerationRequirementEvidence:
    '- 근거와 추론을 구분하고, 모르는 내용은 꾸며내지 않도록 지시합니다.',
  promptGenerationRequirementLinks:
    '- 관련 노트명, 링크 후보, 다음 정리 구조를 제안하도록 지시합니다.',
  promptGenerationRequirementNoDefaultTasks:
    '- 코드리뷰, 번역, 단순 요약을 기본 역할로 삼지 않습니다.',
  promptGenerationRequirementLength: '- 900자 이내의 실사용 가능한 시스템 프롬프트로 작성합니다.',
  promptNoEmbeddedVaultEntries: '임베딩된 볼트 항목이 없습니다.',
  promptSummaryTotalChunks: '총 청크: {count}',
  promptSummaryTopFolders: '[상위 폴더]',
  promptSummaryTopFiles: '[상위 파일]',
  promptSummaryTopHeadings: '[주요 헤딩]',
  promptSummaryRepresentativeSamples: '[대표 청크 샘플]',
  promptSummaryNone: '- 없음',
  contextRuleNoSourceOutsideVault: 'Vault Context에 없는 문서명은 출처로 쓰지 마세요.',
  contextRuleSeparateSuggestions: '새 노트 제안은 출처와 분리해 "제안"으로 표시하세요.',
  contextRuleNoEvidence: '근거가 부족하면 관련 문서를 찾지 못했다고 답하세요.',
  contextAutoRagDetail: '자동 RAG {count}개',
  contextImplicitFolderDetail: '{name}에서 자동 참조 {count}개',
  contextImplicitFolderNoMatch: '{name}에서 질문과 직접 맞닿는 문서를 찾지 못했습니다.',
  contextImplicitFolderReason: '질문에 언급된 {name} 폴더에서 관련 원문을 직접 확인했습니다.',
  contextRejectedCandidatesExcluded: '검증 실패 후보 {count}개는 컨텍스트에서 제외했습니다.',
  contextNoRelevantDocs: '유사도 임계치를 충족하는 관련 문서가 없습니다.',
  contextRagLoadFailed: 'RAG 컨텍스트를 불러오지 못했습니다: {error}',
  contextAutoRagTitle: '관련 노트',
  contextAutoRagReasonNoMentions: '질문과 가까운 vault 문서를 자동으로 검색했습니다.',
  contextAutoRagReasonServerOnly:
    '@server만 명시되어 vault 자동 검색은 건너뛰었습니다. vault 문서도 필요하면 파일이나 폴더를 함께 멘션하세요.',
  contextAutoRagReasonServerAndVault:
    '@server와 vault 멘션이 함께 있어 외부 도구 정보와 vault 문서를 같이 준비했습니다.',
  contextAutoRagReasonVaultMention:
    '명시한 vault 파일/폴더를 기준으로 관련 문서를 함께 검색했습니다.',
  contextAutoRagReasonImplicit: '질문 흐름상 vault 문서를 자동으로 검색했습니다.',
  contextAutoRagReasonDisabled: '자동 RAG가 이 턴에서 비활성화되었습니다.',
  contextDiagnosticProviderSummary: '{provider} {status}/{readiness} {count}개',
  contextDiagnosticRerankerSummary: '재정렬 {status} {count}개',
  contextRerankStatusApplied: '적용됨',
  contextRerankStatusEmpty: '응답 순서 없음',
  contextRerankStatusInvalidJson: '응답 형식 불일치',
  contextRerankStatusError: '실패',
  contextSearchDiagnostic: '검색 진단: {summary}',
  contextFileMissing: '파일이 vault에 존재하지 않습니다.',
  contextLegacyIndexNeedsReindex: '이전 형식의 인덱스라 재인덱싱이 필요합니다.',
  contextFileModified: '파일이 마지막 인덱싱 이후 변경되었습니다.',
  contextHashChanged: '파일 내용 해시가 마지막 인덱싱 이후 변경되었습니다.',
  contextLineMismatch: '청크 라인 범위가 현재 파일과 맞지 않습니다.',
  contextUnsupportedGraphRagSource: '지원하지 않는 GraphRAG 출처입니다.',
  contextPartialBudget: '컨텍스트 예산 때문에 일부만 첨부했습니다.',
  contextFolderNotFound: '폴더를 찾을 수 없습니다.',
  contextFolderAttachedLimited: '최대 {count}개 파일 및 컨텍스트 예산 안에서 첨부했습니다.',
  contextFolderPartialMaxFiles: '폴더 파일이 많아 최대 {count}개만 첨부했습니다.',
  contextFolderPartialBudget: '컨텍스트 예산에 맞춰 폴더 내용 일부만 첨부했습니다.',
  contextFolderPartialReadError: '폴더 파일 {count}개를 읽지 못해 일부만 첨부했습니다.',
  contextMcpDisconnected: '연결되지 않은 MCP 서버입니다.',
  contextMcpNoTools: '(사용 가능한 툴 없음)',
  contextMcpServerBlock:
    '[MCP Server: {name}]\nAvailable tools:\n{tools}\n\nInstruction: 사용자가 이 서버를 @{name}로 명시했습니다. 질문 해결에 최신 정보, 검색, 외부 데이터가 필요하면 위 도구를 호출하고, 도구 결과를 근거로 최종 답변을 작성하세요. 검색 결과 기반 답변에는 가능한 출처 링크를 포함하세요.',
  contextGraphRagEntitiesTitle: 'GraphRAG 엔티티',
  contextGraphRagEntityNotFound: '멘션된 엔티티를 지식 그래프에서 찾을 수 없습니다.',
  contextGraphRagEntitiesDetail: 'GraphRAG {count}개 엔티티',
  contextGraphRagRelationsDetail: '{count}개 관계 정보가 함께 첨부되었습니다.',
  contextGraphContributionTitle: '연결 근거',
  contextGraphContributionDetail: '{count}개 출처가 문서 간 연결을 통해 보강되었습니다.',
  graphRagViewMinConfidence: '최소 신뢰도:',
  graphRagViewTabCommunities: '커뮤니티',
  graphRagViewTabRejected: '거부됨',
  graphRagViewLoadMore: '{count}개 더 보기',
  graphRagViewNoSearchResults: '검색 결과가 없습니다.',
  graphRagViewBackToList: '← 목록으로',
  graphRagViewAliases: '별칭: ',
  graphRagViewConfidence: '신뢰도: {percent}%',
  graphRagViewRelationsCount: '관계 ({count})',
  graphRagViewEvidenceCount: '증거 ({count})',
  graphRagViewNoCommunities: '커뮤니티가 없습니다. GraphRAG 인덱싱 후 커뮤니티 빌드를 실행하세요.',
  graphRagViewNoRejectedFacts: '거부된 사실이 없습니다.',
  graphRagViewPendingMerges: '확인이 필요한 중복 후보 {count}개',
  graphRagViewPendingMergesDescription:
    '서로 같은 대상을 가리키는지 확실하지 않은 항목입니다. 한 번 결정하면 같은 후보를 다시 묻지 않습니다.',
  graphRagViewPendingMergeConfidence: '유사도 {percent}%',
  graphRagViewMergeEntities: '같은 대상으로 합치기',
  graphRagViewKeepEntitiesSeparate: '따로 유지',
  graphRagViewPendingMergeUnavailable: '이 후보는 이미 처리되었거나 더 이상 존재하지 않습니다.',
  graphRagViewRawResponse: '원본 응답: {preview}',
  graphRagViewDetails: '상세 보기',
  graphRagViewCopyDetails: '상세 복사',
  graphRagViewCopyResponse: '응답 복사',
  graphRagViewRawCopied: 'GraphRAG 원본 응답을 복사했습니다.',
  graphRagViewRetry: '다시 시도',
  graphRagViewProcessing: '처리 중...',
  graphRagViewRetryFailed: 'GraphRAG 재시도 실패: {message}',
  graphRagViewErrorCopied: 'GraphRAG 오류 상세 정보를 복사했습니다.',
  graphRagViewCopyFailed: '복사 실패: {message}',
  graphRagViewIndexingProgress: '인덱싱 중: {done}/{total} 파일 처리 ({percent}%)',
  promptLibraryTitle: '프롬프트 보관함',
  closeLabel: '닫기',
  settingsSaveMcpReconnectFailed: '설정 저장 후 MCP 재연결 중 {count}개 서버 실패',
  manualPromptDescription: '직접 작성한 프롬프트',
  promptDeleteConfirm: '"{title}" 프롬프트를 삭제하시겠습니까?',
  promptBodyRequired: '시스템 프롬프트 본문을 입력하세요.',
  promptSavedNotice: '프롬프트가 저장되었습니다.',
  promptAppliedToSessionNotice: '"{title}" 프롬프트를 현재 세션에 적용했습니다.',
  promptSetGlobalDefaultNotice: '"{title}" 프롬프트를 전역 기본값으로 지정했습니다.',
  promptGenerationModelRequired: '프롬프트 생성에 사용할 모델을 선택하세요.',
  promptRagStoreMissing:
    'RAG 벡터 저장소가 초기화되지 않았습니다. RAG 설정과 인덱싱 상태를 확인하세요.',
  generating: '생성 중...',
  promptNoEmbeddedVaultInfo: '임베딩된 볼트 정보가 없습니다. 먼저 RAG 인덱싱을 실행하세요.',
  promptEmptyModelResponse: '모델이 빈 프롬프트를 반환했습니다.',
  vaultBasedPromptTitle: '볼트 기반 프롬프트 - {preset}',
  customLabel: '사용자 지정',
  generatedPromptDescription: '임베딩된 볼트 정보로 생성한 시스템 프롬프트',
  vaultBasedPromptGeneratedNotice: '볼트 기반 시스템 프롬프트를 생성해 보관함에 저장했습니다.',
  promptGenerationFailed: '프롬프트 생성 실패: {message}',
  vaultBasedGeneration: '볼트 기반 생성',
  newPromptButton: '새 프롬프트',
  promptEmptyState: '프롬프트가 없습니다.',
  titleLabel: '제목',
  descriptionLabel: '설명',
  applyToCurrentSession: '현재 세션에 적용',
  globalDefault: '전역 기본값',
  setGlobalDefault: '전역 기본으로 지정',
  deleteLabel: '삭제',
  embeddedVaultGenerateTitle: '임베딩된 볼트 정보로 생성',
  promptDirectionPlaceholder: '응답 태도, 문체, 피해야 할 행동, 노트 연결 방식을 추가로 적으세요.',
  promptSourceDefault: '기본',
  promptSourceGenerated: '볼트 생성',
  promptSourceUser: '사용자',
  cmdOpenAiChat: 'AI 채팅 열기',
  cmdReindexVault: '볼트 RAG 재인덱싱',
  cmdOpenGraphRagView: 'GraphRAG 탐색기 열기',
  graphRagViewTabTitle: 'GraphRAG 탐색기',
  graphRagViewTabEntities: '엔티티',
  graphRagViewTabRelations: '관계',
  graphRagViewTabEvidence: '증거',
  graphRagViewEmpty: '추출된 데이터가 없습니다. GraphRAG 인덱싱을 먼저 실행하세요.',
  graphRagViewSearchPlaceholder: '검색...',
};

const en: I18nKeys = {
  // General
  autoSaveSettings: 'Auto-save settings',
  autoSaveSettingsDesc: 'Automatically save settings after changes (reduces disk I/O)',
  autoSaveDelay: 'Settings auto-save delay',
  autoSaveDelayDesc:
    'Milliseconds to wait after changing a setting value before auto-saving (0–5000 ms)',
  autoSaveSuccessNotice: 'Settings auto-saved.',
  autoSaveMcpFailedNotice: 'Settings were saved, but {count} MCP server reconnects failed.',
  autoSaveFailedNotice: 'Settings auto-save failed: {message}',
  autoSaveUnknownError: 'Unknown error',
  delayMs: 'ms',
  defaultModel: 'Default Model',
  defaultModelDesc: 'Default model for chat and commands',
  refreshModelList: 'Refresh model list',
  refreshing: 'Refreshing...',
  refreshComplete: 'Refresh complete',
  actionCompletedNotice: 'Completed.',
  actionPartialNotice: 'Partially completed.',
  actionNoopNotice: 'No changes were made.',
  actionCancelledNotice: 'Cancelled.',
  actionFailedWithMessage: 'Failed: {message}',
  noModelsEnabled: 'No models enabled',
  pluginAwareGeneration: 'Enable Plugin-Aware Generation',
  pluginAwareGenerationDesc:
    'Include active plugin list in LLM prompts to encourage compatible syntax. (Uses unofficial API)',
  pluginAwareGenerationLimitNotice:
    'This feature currently adds active plugin names, versions, and descriptions to the prompt and encourages Context7 documentation lookup. It does not read or validate plugin-specific data.json settings, runtime results, or vault-specific index state such as DataviewJS configuration.',
  pluginAwareContext7MissingWarning:
    'Context7 MCP is not configured, so plugin documentation-based generation will not work. Add the context7 server in the MCP tab JSON editor.',
  language: 'Language',
  languageDesc: 'Select the plugin UI language',
  langKo: 'Korean',
  langEn: 'English',
  languageChangeConfirm:
    'Are you sure you want to change the language? Obsidian must be reloaded to apply the changes.',
  generalStatusTitle: 'Current status',
  generalStatusDesc:
    'See whether chat and search are ready, with only the next useful action surfaced.',
  generalAllReady: 'Nothing needs immediate attention.',
  generalBasicsTitle: 'Essentials',
  generalBasicsDesc: 'Choose the language, default model, and settings save behavior.',
  generalDiagnosticsTitle: 'Diagnostics',
  generalDiagnosticsDesc:
    'Inspect runtime state and detailed records only when something needs attention.',
  generalDiagnosticsDisclosureTitle: 'Show diagnostic tools',
  generalDiagnosticsDisclosureDesc:
    'Reveal status capture, the diagnostics view, and log cleanup actions.',
  generalAdvancedTitle: 'Advanced and recovery',
  generalAdvancedDesc: 'Save timing details and recovery actions that rarely need adjustment.',
  generalAutoSaveDisclosureTitle: 'Save timing details',
  generalAutoSaveDisclosureDesc: 'Adjust how long the plugin waits before saving setting changes.',
  generalDangerDisclosureDesc: 'Contains an irreversible reset of all plugin data.',
  chatStatusTitle: 'Current behavior',
  chatStatusDesc: 'Summarizes the response, saving, and tool behavior applied to new chats.',
  chatActiveStatus: 'Active',
  chatEnabledStatus: 'On',
  chatDisabledStatus: 'Off',
  chatSelectedStatus: 'Selected',
  chatStatusPromptDetail: 'This is the default response behavior for new chats.',
  chatStatusAutosaveOnDetail: 'Chats are saved automatically in the selected vault folder.',
  chatStatusAutosaveOffDetail: 'Chats are kept only when you save them manually.',
  chatStatusToolsDetail: 'Controls when MCP tool execution requires confirmation.',
  chatPromptSectionTitle: 'Response defaults',
  chatPromptSectionDesc: 'Set the AI’s default role and response behavior.',
  chatPromptLibraryDesc: 'Choose saved prompts and manage their names, descriptions, and content.',
  chatPromptShortcutsTitle: 'Quick starts and reset',
  chatPromptShortcutsDesc: 'Apply a preset as the new default or return to the built-in prompt.',
  chatApplyPreset: 'Apply',
  chatPromptResetDesc: 'Return the global prompt to the default knowledge-work prompt.',
  chatStorageSectionTitle: 'Chat saving',
  chatStorageSectionDesc: 'Choose where chats are stored and whether they save automatically.',
  chatStorageDetailsTitle: 'Saving details',
  chatStorageDetailsDesc: 'Adjust how long automatic saving waits after the last message.',
  chatToolsSectionTitle: 'Tool use',
  chatToolsSectionDesc: 'Choose when MCP tools run automatically and when they need confirmation.',
  chatToolDetailsTitle: 'Tool details',
  chatToolDetailsDesc: 'Adjust retries when the model does not use a requested tool.',
  chatAlwaysAutoWarning:
    'Always auto-run can execute normal MCP tools that were not mentioned without separate approval.',
  mcpStatusSectionTitle: 'Current connections',
  mcpStatusSectionDesc: 'Check MCP server connections and the nearest recovery action.',
  mcpServersSectionTitle: 'Server setup',
  mcpServersSectionDesc: 'Manage available servers with standard mcpServers JSON.',
  mcpEnvironmentSectionTitle: 'Runtime environment',
  mcpEnvironmentSectionDesc: 'Manage the local environment used to find server commands.',
  mcpEnvironmentDetailsTitle: 'Runtime environment details',
  mcpEnvironmentDetailsDesc: 'Adjust PATH detection and manual values only when troubleshooting.',
  mcpStatusNoServersDetail: 'Add an mcpServers entry in Server setup to begin connecting.',
  mcpStatusSummaryDetail: '{connected} of {total} servers are connected.',
  mcpReconnectDesc: 'Try connecting again with the current server setup.',
  mcpStatusServerDetail: 'Current server command and connection state.',
  advancedPluginAwareTitle: 'Plugin-aware generation',
  advancedPluginAwareDesc:
    'Use active plugin information to improve Obsidian syntax compatibility.',
  advancedEnabledStatus: 'On',
  advancedDisabledStatus: 'Off',
  advancedPluginAwareOnDetail: 'New requests include a limited summary of active plugins.',
  advancedPluginAwareOffDetail: 'New requests do not include active plugin information.',
  loggingMinLevel: 'Minimum log level',
  loggingMirrorConsole: 'Mirror to console',
  loggingMaxEntries: 'Retained log entries',
  loggingViewerTitle: 'Diagnostic logs',
  loggingViewerDesc:
    'Inspect plugin runtime, RAG, GraphRAG, MCP, and embedding errors inside Agent Diagnostics.',
  loggingCopyVisible: 'Copy visible logs',
  loggingClear: 'Clear logs',
  loggingFilterLevel: 'Level',
  loggingFilterAllLevels: 'All',
  loggingFilterSource: 'Source',
  loggingFilterSourcePlaceholder: 'e.g. embedding, rag, mcp',
  loggingVisibleCount: 'Showing {count}',
  loggingEmpty: 'No logs to show.',
  loggingCopied: 'Logs copied.',
  loggingCopyFailed: 'Failed to copy logs: {message}',
  agentDiagnosticsPanelTitle: 'Debugging',
  agentDiagnosticsPanelDesc:
    'Agent-facing diagnostics for Codex/opencode. Off by default for normal releases.',
  agentDiagnosticsToggle: 'Enable agent diagnostics',
  agentDiagnosticsToggleDesc:
    'Collect heartbeat, refresh events, recent logs, and runtime state during this plugin session.',
  agentDiagnosticsOpenView: 'Agent diagnostics status window',
  agentDiagnosticsOpenViewDesc: 'Open the machine-readable diagnostics view.',
  agentDiagnosticsOpenViewButton: 'Open diagnostics',
  agentDiagnosticsFilePath: 'Diagnostics file: {path}',
  agentDiagnosticsWriteSnapshot: 'Write snapshot now',
  agentDiagnosticsWriteSnapshotDesc: 'Immediately writes the current diagnostics JSON file.',
  agentDiagnosticsWriteButton: 'Write snapshot',
  agentDiagnosticsClearDetailedLogging: 'Clean detailed logging',
  agentDiagnosticsClearDetailedLoggingDesc:
    'Clears agent diagnostics buffers, recent logs, and removes the diagnostics JSON file.',
  agentDiagnosticsClearButton: 'Clean detailed logging',
  agentDiagnosticsViewTitle: 'Agent Diagnostics',
  agentDiagnosticsViewDesc: 'Machine-readable Superpower Inside runtime status for coding agents.',
  agentDiagnosticsRefreshButton: 'Refresh',
  agentDiagnosticsCopyButton: 'Copy JSON',
  agentDiagnosticsEnabledStatus: 'Enabled. Writing to {path}',
  agentDiagnosticsDisabledStatus: 'Disabled. Enable Agent diagnostics in Settings > Overview.',
  agentDiagnosticsWriteDone: 'Agent diagnostics snapshot written.',
  agentDiagnosticsClearDone: 'Agent diagnostics detailed logging cleaned.',
  agentDiagnosticsCopied: 'Agent diagnostics JSON copied.',
  agentDiagnosticsCopyFailed: 'Failed to copy agent diagnostics JSON: {message}',

  // Providers
  apiKey: 'API Key',
  baseUrl: 'Base URL',
  validateApiKey: 'Validate API Key',
  valid: 'Valid!',
  modelsFound: 'models found.',
  invalid: 'Invalid:',
  error: 'Error:',
  noModelsFound: 'No models found.',
  enabled: 'Enabled',
  providerCapabilityToolCalling: 'Tool calling support',
  providerCapabilityToolCallingDesc:
    'Enable only when this custom OpenAI-compatible endpoint reliably supports tool schemas and tool call deltas.',
  providerCapabilityReasoning: 'Reasoning/thinking display support',
  providerCapabilityReasoningDesc:
    'Enable only when the provider explicitly emits reasoning or thinking fields.',
  providerCapabilityLiveStreaming: 'Live streaming support',
  providerCapabilityLiveStreamingDesc:
    'Enable only for endpoints that deliver tokens live. requestUrl paths are usually buffered.',
  providerCapabilityNativeAbort: 'Native abort support',
  providerCapabilityNativeAbortDesc:
    'Enable when AbortSignal can actually cancel the request. requestUrl is best-effort.',
  providerCapabilityMaxToolRounds: 'Max tool rounds',
  providerCapabilityMaxToolRoundsDesc:
    'Maximum tool-loop rounds allowed for one answer on this provider. Keep 0 when tool calling is disabled.',
  providerCapabilityBufferedNoTools: 'buffered · tools off',
  providerCapabilityBuffered: 'buffered',
  providerCapabilityNoTools: 'tools off',
  providerCapabilityStreamingReasoning: 'streaming · reasoning',
  providerCapabilityStreaming: 'streaming',
  providerToolCallingUnsupportedNotice:
    '{provider} currently has tool calling capability disabled, so MCP tools will not be sent for this request.',
  providerWaitBufferedHeadline: 'Waiting for {provider} / {model}',
  providerWaitBufferedDetail:
    'The completed response will appear at once without live tokens. Cancel may not immediately stop a request that is already in progress at the provider.',
  providerWaitElapsedSeconds: '{seconds}s',
  reasoningProvidedLabel: 'Provider-emitted thinking',
  chatRecoveryRetrySameContext: 'Retry with same context',
  chatRecoverySwitchProvider: 'Switch provider/model',
  chatRecoveryReconnectMcp: 'Reconnect MCP',
  chatRecoveryEditToolArgs: 'Edit tool args',
  chatRecoverySkipFailedTool: 'Skip failed tool',
  chatRecoverySendWithoutRag: 'Send without RAG',
  chatRecoverySendWithoutSourceValidation: 'Send without source validation',
  chatRecoveryCopyDebug: 'Copy debug',
  turnStageDraft: 'Draft',
  turnStageBuildingContext: 'Building context',
  turnStageWaitingProvider: 'Waiting for provider',
  turnStageStreamingReasoning: 'Receiving reasoning',
  turnStageStreamingAnswer: 'Receiving answer',
  turnStagePlanningTools: 'Planning tools',
  turnStageAwaitingToolApproval: 'Awaiting tool approval',
  turnStageRunningTools: 'Running tools',
  turnStageFinalizingAfterTools: 'Applying tool results',
  turnStageComplete: 'Complete',
  turnStageCancelled: 'Cancelled',
  turnStageError: 'Error',

  // RAG
  embeddingProvider: 'Embedding Provider',
  embeddingProviderDesc: 'Select the provider for embeddings',
  embeddingModel: 'Embedding Model',
  embeddingModelDesc: 'Choose the embedding model to use',
  embeddingModelId: 'Model ID',
  embeddingModelIdDesc: 'Enter the embedding model ID directly',
  save: 'Save',
  cancel: 'Cancel',
  confirmLabel: 'Confirm',
  embeddingChangedNotice: 'Embedding settings change was cancelled.',
  embeddingSavedNotice: 'Embedding settings saved.',
  testConnection: 'Test Connection',
  testing: '🔄 Testing...',
  connectionSuccess: 'Connection successful!',
  connectionFailed: 'Connection failed',
  connectionError: 'Error occurred',

  // RAG Stats
  indexStats: 'Index Statistics',
  totalFiles: 'Total Files',
  totalFilesDesc: 'Files currently eligible for RAG',
  indexedFiles: 'Indexed',
  indexedFilesDesc: 'Files with embeddings',
  pendingFiles: 'Pending',
  pendingFilesDesc: 'Files not yet indexed',
  totalVectors: 'Total Vectors',
  totalVectorsDesc: 'Stored embedding vectors',
  targetFileTypes: 'Target File Types',
  targetFileTypesDesc: 'File types and counts currently eligible for RAG.',
  targetFileTypesEmpty: 'No files are currently eligible for RAG.',
  excludeRecommendations: 'Exclude Recommendations',
  excludeRecommendationEmpty: 'No additional file types are recommended for exclusion.',
  addExcludeExtension: 'Add to excluded extensions',
  addExcludeExtensionDone: 'Added to excluded extensions',
  refresh: 'Refresh',
  loadStatsFailed: 'Unable to load statistics.',
  enableProviderFirst: 'Please enable "{provider}" in the Providers tab.',
  enterApiKeyFirst: 'Please enter the API Key for "{provider}" in the Providers tab.',
  selectAndSaveModel:
    'Embedding model not selected. Please select a model in the Embedding Provider section and click "Save".',
  enterModelId: 'Please enter the embedding model ID and click "Save".',
  connectionFailedGeneric:
    'Failed to connect to provider "{provider}" ({model}). Please check Base URL or API Key.',

  // RAG Controls
  indexingControls: 'Indexing Controls',
  updatePendingFiles: 'Update Pending Files',
  reindexAll: 'Reindex All',
  clearEmbeddingData: 'Clear Embedding Data',
  confirmClear: 'Delete all embedding data? This cannot be undone.',
  clearSuccess: 'All embedding data has been cleared.',
  clearFailed: 'Clear failed',
  indexerNotInit: 'RAG indexer is not initialized.',
  indexingStarted: 'Indexing pending files...',
  indexingDone: 'files indexed',
  indexingFailed: 'Indexing failed',
  reindexingStarted: 'Reindexing all...',
  reindexingDone: 'files reindexed',
  reindexingFailed: 'Reindexing failed',
  autoUpdateIndexingStarted: 'Auto-indexing started...',
  autoUpdateIndexingDone: 'files auto-indexed',
  autoUpdateIndexingFailed: 'Auto-indexing failed',

  // RAG Options
  autoUpdate: 'Auto Update',
  autoUpdateDesc: 'Automatically index new files at the set interval',
  autoUpdateInterval: 'Auto-update Interval',
  autoUpdateIntervalDesc: 'Automatic indexing interval (1–99 minutes, integer)',
  intervalMinutes: 'minutes',
  excludePaths: 'Exclude Paths',
  excludePathsDesc: 'Manage folders or path patterns excluded from indexing as a list.',
  excludeExts: 'Exclude Extensions',
  excludeExtsDesc: 'Manage file extensions excluded from indexing as a list.',
  excludeListAdd: 'Add',
  excludeListRemove: 'Remove',
  excludeListEmpty: 'No items registered.',
  excludeExtFileCount: '{count} files',
  excludeExtTotalFileCount: '{count} files excluded in total',
  excludePathPlaceholder: 'e.g. Archive or **/drafts',
  excludeExtPlaceholder: 'e.g. pdf or .png',
  excludeInputEmpty: 'Enter a value.',
  excludeInputTrimmed: 'Leading and trailing spaces will be removed.',
  excludeInputDuplicate: 'This item is already in the list.',
  excludeInputComma: 'Add one item at a time instead of using commas.',
  excludePathBackslash: 'Use / as the path separator.',
  excludePathLeadingSlash: 'Enter a vault-relative path without a leading /.',
  excludePathMissingWarning:
    'This path was not found in the current vault. You can still save it if it is a pattern.',
  excludeExtLeadingDot: 'The leading dot will be removed.',
  excludeExtInvalid: 'Use only letters, numbers, hyphens, or underscores.',
  excludeExtProtectedDocument:
    'Obsidian core document extensions cannot be excluded. Exclude the problematic file or folder by path instead.',
  excludeChatFolder: 'Exclude Chat Folder from RAG',
  excludeChatFolderDesc: 'Automatically exclude the chat save folder from RAG indexing',
  chunkSize: 'Chunk Size',
  chunkSizeDesc: 'Maximum characters per document chunk (100–5000)',
  ragChunkSizeOllamaWarning:
    'Some Ollama local embedding models have small context limits. If you get a 400 error, try reducing this value to 500 or less.',
  ollamaEmbeddingContextError:
    'The input exceeds the maximum context length of the Ollama embedding model. Go to Settings > RAG > Chunk size and lower it, then reindex.',
  minScore: 'Minimum Relevance Score',
  minScoreDesc:
    'Filter out embedding results below this threshold (0–1). Lower values include more results but may reduce quality.',
  enableBM25: 'Enable BM25 Keyword Search',
  enableBM25Desc:
    'Combine embedding similarity with BM25 keyword matching for hybrid search. Improves Korean text retrieval accuracy.',
  bm25Weight: 'BM25 Weight',
  bm25WeightDesc: 'Closer to 0 favors embedding similarity, closer to 1 favors keyword matching.',
  bm25Guidance:
    '💡 BM25 complements embedding search by adding keyword matching, which helps with Korean text where semantic embeddings alone may miss relevant terms. If RAG frequently returns irrelevant results, enable BM25 and adjust the weight.',

  // RAG Dashboard
  ragStatusTotalDocs: 'Total Documents',
  ragStatusHealthy: 'Healthy',
  ragStatusUpdateRequired: 'Update Required',
  ragStatusTotalVectors: 'Total Vectors',
  ragStatusCurrentState: 'Current State',
  ragStatusAutoUpdate: 'Auto Update',

  // RAG Banner
  ragBannerNeedsUpdate:
    'Documents need updating. Run "Update Pending" for better RAG search quality.',
  ragBannerIndexing: 'Indexing is running. You can cancel if Obsidian becomes slow.',
  ragBannerLatest:
    'Index is up to date. Full reindex is only needed if model or storage was changed.',
  ragBannerNoDocs: 'No RAG-eligible documents found. Check exclusion paths or file types.',
  ragBannerPaused: 'Paused for performance protection. Reason: {reason}',
  ragWorkflowStatusTitle: 'Check Status',
  ragWorkflowStatusDetail: 'Start by seeing whether the index is current.',
  ragWorkflowEmbeddingTitle: 'Choose Embeddings',
  ragWorkflowEmbeddingDetail:
    'The default is bundled Ternlight; switch to a remote provider only if needed.',
  ragWorkflowIndexTitle: 'Run Indexing',
  ragWorkflowIndexDetail:
    'Update changed notes first; reindex everything only after model changes.',
  ragWorkflowTuneTitle: 'Tune Advanced',
  ragWorkflowTuneDetail: 'Adjust search quality and GraphRAG after the base flow is stable.',
  ragLocalEmbeddingTitle: 'Included by default: Ternlight on-device embeddings',
  ragLocalEmbeddingDetail:
    'Notes stay on this device with no API key or Ollama server. If the model file is missing, it is downloaded once, verified, and then used offline.',
  ragStatusSectionDescription: 'See search readiness and the one action that matters now.',
  ragFoundationTitle: 'Search foundation',
  ragFoundationDescription: 'Choose the search model and what the index should include.',
  ragGraphSectionDescription:
    'Add connected context while keeping extraction and maintenance tools out of the daily flow.',
  ragGraphDisclosureTitle: 'Detailed settings and actions',
  ragGraphDisclosureDescription: 'Manage the model, sync, extraction, and result inspection.',
  ragDiagnosticsTitle: 'Diagnostics and recovery',
  ragDiagnosticsDescription: 'Statistics and recovery tools that are not part of daily use.',
  ragDiagnosticsDisclosureTitle: 'Show detailed diagnostics',
  ragOverviewTitle: 'Standard search',
  ragOverviewReady: 'Up to date',
  ragOverviewNeedsUpdate: '{count} need updating',
  ragOverviewEmpty: 'No indexing targets',
  ragOverviewDetail: '{healthy}/{total} documents current · auto update {auto}',
  ragOverviewUnavailable: 'Connection needed',
  ragOverviewFixEmbedding: 'Choose embedding model',
  ragOverviewCheckProvider: 'Review provider',
  ragRecoverySummary: 'Troubleshooting and recovery',
  ragRecoveryDescription: 'Use full reindex and data reset only when troubleshooting.',
  graphRagOverviewTitle: 'Connected search (GraphRAG)',
  graphRagOverviewDetail: '{total} targets · {done} evidence · {stale} to sync · {failed} failed',
  graphRagDetailsSummary: 'GraphRAG details and recovery',
  graphRagQueryModeLabel: 'GraphRAG search mode',
  graphRagQueryAutoLabel: 'Auto',
  graphRagQueryLocalLabel: 'Local',
  graphRagQueryGlobalLabel: 'Global',
  graphRagQueryHybridLabel: 'Hybrid',
  graphRagMergeThresholdLabel: 'Merge thresholds',
  graphRagPendingMergeLabel: 'Pending merge review',
  graphRagModularityDetail: 'Modularity {value}',

  // RAG Buttons
  btnUpdatePending: 'Update Pending',
  btnReindexAll: 'Reindex All',
  btnCancelIndexing: 'Cancel Indexing',
  btnResumeIndexing: 'Resume Now',
  btnResetEmbeddings: 'Reset Embedding Data',

  // RAG Filter
  filterAll: 'All',
  filterMissing: 'Missing',
  filterStale: 'Stale',
  filterUnknown: 'Unknown',
  loadMore: 'Load 10 More',
  loadAll: 'Load All',

  // RAG Batch
  batchAddExclude: 'Add Selected to Exclusions',
  selectAll: 'Select All',
  deselectAll: 'Deselect All',

  // Connection Badge
  connectionConnected: 'Connected ({count} models)',
  connectionTesting: 'Testing...',

  // Progress
  progressLabel: 'Progress',

  // Chat
  chatTabTitle: 'AI Chat',
  toolbarTools: 'Tools',
  sendButton: 'Send',
  chatSaveFolder: 'Chat Save Folder',
  chatSaveFolderDesc: 'Vault folder path to save conversations',
  systemPrompt: 'System Prompt',
  systemPromptDesc:
    'Global system prompt that defines AI role and response style. Leave empty to use default.',
  systemPromptPlaceholder: 'e.g., You are an expert assistant helping with Obsidian note-taking...',
  promptLibraryOpen: 'Open Prompt Library',
  mcpToolExecutionPolicy: 'MCP tool execution policy',
  mcpToolExecutionPolicyDesc:
    'A mentioned MCP server is treated as trusted and as user intent to use that server, so normal tools run automatically. Tool results may be sent back to the LLM provider to generate the final answer; risky or unmentioned tools stay pending approval.',
  mcpToolExecutionMentionedAuto: 'Auto-run mentioned servers',
  mcpToolExecutionAlwaysManual: 'Always require approval',
  mcpToolExecutionAlwaysAuto: 'Always auto-run',
  resetToDefault: 'Reset to Default',
  chatClear: 'Clear Chat',
  chatScrollToBottom: 'Latest answer',
  chatTyping: 'AI is thinking...',
  copyCode: 'Copy',
  copied: 'Copied',
  toolResult: 'Tool Result',
  executeTool: 'Execute',
  toolArgs: 'Arguments',
  selectTool: 'Select Tool',
  noToolsAvailable: 'No MCP tools available.',
  messageUser: 'You',
  messageAssistant: 'AI',
  messageSystem: 'System',
  messageTool: 'Tool',
  timestampJustNow: 'just now',
  timestampMinutesAgo: '{count}m ago',
  timestampHoursAgo: '{count}h ago',
  timestampDaysAgo: '{count}d ago',
  sessionPromptModified: 'modified',
  mcpToolRunning: 'Running tool...',
  mcpToolSuccess: 'Tool executed successfully',
  mcpToolError: 'Tool execution failed',
  mcpToolValidationError: 'Invalid input value.',
  mcpToolInvalidField: 'Field "{field}" has an invalid value. {detail}',
  mcpMentionServers: 'Tools',
  mcpMentionFiles: 'Vault Files',
  mcpMentionFolders: 'Folders',
  reasoningLabel: 'Thinking',
  toolCallLabel: 'Tool Call',
  answerLabel: 'Answer',
  thinkingPlaceholder: 'Thinking...',
  enforceMcpTools: 'Detect & Retry on Missing MCP Tool Calls',
  enforceMcpToolsDesc:
    'When an @mentioned MCP server is available but the model generates a response without calling any tools, automatically retry with a strengthened system prompt that enforces tool usage.',
  modelSelector: 'Model',
  mcpRefresh: 'Refresh',
  mcpReconnect: 'Reconnect',
  mcpRefreshing: 'Reconnecting...',
  mcpConnecting: 'Connecting MCP...',
  mcpPartialError: 'Some MCP servers failed',
  mcpNoActiveServers: 'No active MCP servers',
  mcpActiveServers: 'Active {count} / Total {total}',
  quickPresetGeneral: 'General',
  quickPresetCodeReview: 'Code Review',
  quickPresetTranslate: 'Translate',
  quickPresetSummarize: 'Summarize',
  chatMcpReconnectFailedNotice: 'MCP reconnect failed for {count} servers',
  chatMcpReconnectFailedDetail: '{count} failed',
  chatMcpReconnectCompleteNotice: 'MCP servers reconnected.',
  chatSearchButton: 'Search',
  chatMessageSearchAria: 'Search messages',
  chatInputPlaceholder: 'Enter a message...',
  chatMessageSearchPrompt: 'Enter message text to search for.',
  chatAutoRagChip: 'Related notes',
  chatFolderMentionChip: 'Folder {name}',
  chatFileMentionChip: 'File {name}',
  chatReadinessProviderMissing: 'Provider setup required',
  chatReadinessProviderMissingDetail:
    'Enable at least one LLM provider in settings before sending.',
  chatReadinessModelMissing: 'Model selection required',
  chatReadinessModelMissingDetail: 'Add at least one model to an enabled provider.',
  chatReadinessRagIndexing: 'RAG indexing',
  chatReadinessRagIndexingDetail:
    'You can send now, but some current vault context may be missing.',
  chatReadinessRagNotReady: 'RAG not ready',
  chatReadinessRagNotReadyDetail:
    'Build or refresh the index to improve automatic context quality.',
  chatReadinessPrepareDocuments: 'Prepare documents',
  chatReadinessSelectModelAction: 'Select model',
  chatReadinessConfigureProviderAction: 'Configure provider',
  chatEmptyStateTitle: 'Ask about your vault',
  chatEmptyStateDetail:
    'Built-in search automatically references related documents and shows sources below the answer. MCP is not required.',
  chatEmptyStatePromptSummary: 'Summarize the main themes in this vault with evidence',
  chatEmptyStatePromptConnections: 'Find documents related to my recent notes',
  chatReadinessMcpPartial: 'Some MCP connections need attention',
  chatReadinessMcpPartialDetail: 'Connected {connected}/{total}. Reconnect the servers you need.',
  chatReadinessSaveFolderMissing: 'No save folder',
  chatReadinessSaveFolderMissingDetail:
    'Set a chat save folder for session replay and draft recovery.',
  chatReadinessReady: 'Chat is ready',
  chatReadinessBlocked: 'Provider setup required',
  chatReadinessDegraded: 'Some features need attention',
  composerDraftRestoredNotice: 'The send did not finish, so the draft was restored.',
  chatToolMentionChip: 'Tool {name}',
  contextAttachmentAttached: 'Included',
  contextAttachmentPartial: 'Partially included',
  contextAttachmentMissing: 'Missing',
  contextAttachmentError: 'Error',
  contextAttachmentLowRelevance: 'Low relevance',
  contextAttachmentExcluded: 'Excluded',
  contextAttachmentChars: '{count} chars',
  contextNoteSingular: 'note',
  contextNotePlural: 'notes',
  contextItemSingular: 'item',
  contextItemPlural: 'items',
  contextChipRelatedNotes: 'Checked {count} related {noteLabel}',
  contextChipNoRelatedNotes: 'No close notes found',
  contextChipVaultSearchSkipped: 'Vault search skipped',
  contextChipKnowledgeGraph: 'Checked knowledge graph',
  contextChipKnowledgeGraphMissing: 'No graph match found',
  contextChipFolderNotesUsed: '{name}: {count} {noteLabel} used',
  contextChipFileAttached: '{name}',
  contextChipReferenceAttached: 'Linked note {name}',
  contextChipToolReady: 'Tool ready: {name}',
  contextChipToolUnavailable: 'Tool unavailable: {name}',
  contextChipDetailAuto: 'Found related notes automatically.',
  contextChipDetailSkipped: 'Vault search was skipped for this question.',
  contextChipDetailShortened: 'Only the part that fit was included.',
  contextBudgetItemsPrepared: '{count} context {itemLabel} prepared',
  contextBudgetItemsLeftOut: '{count} {itemLabel} left out',
  contextBudgetUsage: 'Context {used}/{max} chars',
  contextBudgetTruncated: 'Some material was shortened.',
  contextBudgetIncludedExcluded: 'Included {included} · excluded {excluded}',
  dataBoundaryTitle: 'What this answer used',
  dataBoundaryProvider: 'Sent to',
  dataBoundaryMcp: 'Tools contacted',
  dataBoundaryLocal: 'Kept on this device',
  dataBoundarySystemPrompt: 'Answer instructions',
  dataBoundaryAttachedContext: '{count} notes and references',
  dataBoundaryCitationPreview: '{count} source previews',
  dataBoundaryDraftStore: 'Draft and source-card state',
  dataBoundarySourceCardState: 'Source-card state',
  dataBoundaryExcludedAttachmentNote: '{count} items were left out and were not sent.',
  dataBoundaryExcludedAttachmentNoteSingular: '{count} item was left out and was not sent.',
  dataBoundaryExcludedAttachmentNotePlural: '{count} items were left out and were not sent.',
  sourceStatusVerified: 'Checked',
  sourceStatusCandidate: 'Needs review',
  sourceStatusMissing: 'Not found',
  sourceStatusStale: 'Changed',
  sourceStatusLowRelevance: 'Weak match',
  sourceRepairAction: 'Check source',
  sourceRepairPrompt: 'Verify the source for {label} and re-check the answer.',
  sourceGraphEntity: 'Knowledge graph',
  sourceGraphRelation: 'Relationship',
  sourceGraphCommunity: 'Knowledge theme',
  sourceLineMeta: 'line {line}',
  sourceEndLineMeta: 'ends line {line}',
  sourceRelevanceMeta: 'match {score}',
  sourcePreviewTruncated: 'preview shortened',
  sourceReasonStrongGraph: 'strong relationship match',
  sourceReasonGraphStructural: 'relationship match',
  sourceReasonKeywordVector: 'strong text match',
  sourceReasonKeyword: 'keyword match',
  sourceReasonVector: 'semantic match',
  sourceReasonHybrid: 'combined match',
  citationMarkerAria: 'Jump to source card {id}',
  variantCompareTitle: 'Compare answer variants',
  variantCompareActive: 'Selected',
  variantCompareRow:
    '{provider} · {citations} sources · {warnings} warnings · {tools} tools · {contexts} contexts',
  chatGenerationStopped: 'Response generation was stopped.',
  vaultResearchProgress: 'Researching vault · {phase} · {completed}/{total}',
  vaultResearchPhaseInventory: 'Checking documents',
  vaultResearchPhaseMap: 'Reading documents',
  vaultResearchPhaseReduce: 'Synthesizing',
  vaultResearchPhaseComplete: 'Complete',
  nativeVaultActionSearch: 'Search',
  nativeVaultActionRead: 'Read document',
  nativeVaultActionList: 'List documents',
  nativeVaultActionLinks: 'Inspect links',
  nativeVaultActionStats: 'Check vault scope',
  nativeVaultPlanUnavailable: 'The native vault tool request could not be validated.',
  nativeVaultInvalidJson: 'Tool arguments are not valid JSON.',
  nativeVaultUnsupportedAction: 'This action is not supported.',
  nativeVaultQueryRequired: 'A search query is required.',
  nativeVaultPathRequired: 'A vault path is required.',
  nativeVaultInvalidPath: 'Only safe paths inside the vault are allowed.',
  nativeVaultInvalidLineRange: 'The requested line range is invalid.',
  nativeVaultInvalidDirection: 'The link direction is invalid.',
  nativeVaultInvalidArguments: 'The tool arguments are invalid.',
  nativeVaultSearchDisplay: '{count} vault search results',
  nativeVaultReadDisplay: '{path}, lines {start}-{end}',
  nativeVaultListDisplay: '{count} vault documents listed',
  nativeVaultLinksDisplay: '{count} links for {path}',
  nativeVaultStatsDisplay: '{count} vault documents',
  nativeVaultFileNotFound: 'Vault document not found: {path}',
  nativeVaultReadRangeFailed: 'This line range cannot be read: {path}',
  nativeVaultListFailed: 'The vault document list could not be calculated.',
  nativeVaultStatsFailed: 'Vault statistics could not be calculated.',
  nativeVaultSearchScopeFailed: 'The vault search scope could not be calculated.',
  vaultResearchListStalled: 'Vault list pagination did not advance.',
  vaultResearchBatchPlanFailed: 'The hierarchical summary batches could not be calculated.',
  vaultResearchEmptySummary: 'The Research Agent returned an empty summary.',
  vaultResearchInvalidListResult: 'The vault list result has an invalid format.',
  vaultResearchInvalidListItem: 'The vault list contains an invalid document item.',
  vaultResearchInvalidListPage: 'The vault list pagination data is invalid.',
  vaultResearchInvalidReadResult: 'The vault read result has an invalid format.',
  vaultResearchCancelled: 'The Research Agent run was cancelled.',
  vaultResearchCoverageWarning:
    '⚠️ Read {processed} of {total} documents. {failed} documents could not be read and were omitted from the answer below.',
  vaultResearchFailurePlanFailed: 'The Research Agent retry policy could not be calculated.',
  toolLoopPolicyUnavailable: 'The repeated tool-call policy could not be calculated.',
  repeatedToolCallBlocked: 'This call was stopped because the same tool and arguments repeated.',
  chatGeneratingResponse: 'Generating response...',
  assistantQuestionReasoningTitle: 'Detected a user question in the model thinking output.',
  assistantQuestionSelectionTitle: 'The model requested a user selection.',
  assistantQuestionFreeTextPlaceholder: 'Enter directly',
  assistantQuestionCompleteSelection: 'Complete selection',
  assistantQuestionSendAnswer: 'Send answer',
  assistantQuestionRequiredNotice: 'Select an item to answer or enter a response directly.',
  toolApproveExecution: 'Approve run',
  sourceVerifiedCount: '{count} sources checked',
  sourceCitationSelectionFailed: 'The final answer sources could not be prepared.',
  sourceSearchVerifiedCount: '{verified}/{total} sources checked',
  sourceOpenAction: 'Open',
  sourceCopyLinkAction: 'Copy link',
  sourceInsertIntoNoteAction: 'Insert into note',
  sourceOpenedNotice: 'Opened source: {path}',
  sourceOpenFailedNotice: 'Failed to open source: {message}',
  sourceCopyLinkFailedNotice: 'Failed to copy source link: {message}',
  sourceInsertFailedNotice: 'Failed to insert source: {message}',
  sourceUnverifiedCount: '{count} links/sources need review',
  sourceFileNotFound: 'File not found: {path}',
  sourceUnverifiedCandidate: 'Source needs review: {detail}',
  sourceInsertedNotice: 'Inserted the source into the active note.',
  sourceInsertBlock: '\n> Source: {link}\n> {preview}\n',
  messageCopyAction: 'Copy',
  messageRetryAction: 'Regenerate',
  messageInsertIntoNoteAction: 'Insert into note',
  messageNewNoteAction: 'New note',
  messageBranchAction: 'Branch',
  messageEditAndSendAction: 'Edit and send',
  activeNoteMissingNotice: 'No active note.',
  messageInsertedNotice: 'Inserted into the active note.',
  messageCopyFailedNotice: 'Failed to copy message: {message}',
  messageInsertFailedNotice: 'Failed to insert message: {message}',
  sourceWarningIncluded: '{count} links/sources need review.',
  aiAnswerTitle: 'AI answer',
  savedAsNewNoteNotice: 'Saved as a new note: {path}',
  savedAsNewNoteFailedNotice: 'Failed to save new note: {message}',
  branchSessionCreatedNotice: 'Created a branch session.',
  branchSessionMissingNotice: 'Could not find the message to branch from.',
  branchSessionFailedNotice: 'Failed to create branch session: {message}',
  regenerationTargetMissingNotice: 'Could not find the message to regenerate.',
  chatStatusIdle: 'Idle',
  chatStatusRunning: 'Generating',
  chatStatusDone: 'Done',
  chatStatusError: 'Error',
  deletedSessionResetNotice: 'The chat session file was deleted, so the chat was reset: {path}',
  chatAutoSaveFailedLog: '[Superpower Inside] Chat auto-save failed:',
  chatLoadFailedNotice: 'Failed to load chat: {message}',
  providerPathRequiredSuffix: ' path must be set first.',
  defaultModelMissingNotice: 'No default model is configured. Select a model in the settings tab.',
  modelSettingInvalid: 'The model setting format is invalid.',
  customModelSettingInvalid: 'The custom model setting format is invalid.',
  customProviderDisabled: 'The custom provider is not enabled.',
  noActiveProviderNotice: 'No LLM provider is enabled. Enable a provider in settings.',
  mcpRetryToolUseNotice: '🔄 @{servers} did not call tools, retrying...',
  mcpRetryNoToolUseNotice: '⚠️ @{servers} — retried, but no tool was called.',
  mcpApprovalRequiredNotice: 'Some MCP tools require the “Approve run” button in the message.',
  llmApiError: 'LLM API error: {detail}',
  stopButton: 'Stop',
  stopAllButton: 'Stop all',
  chatRunActive: 'Working on your answer',
  assistantQuestionProviderContent: 'Question: {prompt}\n{choices}',
  mcpToolFinalAnswerMissing:
    'MCP tool results were received, but the model did not produce a final answer. Review the tool results below and try again.',
  cancelledLabel: 'Cancelled',
  tooManyToolCalls: 'Tool calls repeated too many times.',
  mcpResultMessageMissing: 'Could not find the chat message to apply MCP results to: {messageId}',
  customProviderNotFound: 'Custom provider not found.',
  validationNeedsNumber: 'A numeric value is required.',
  validationMinValue: 'Must be at least {minimum}.',
  validationMaxValue: 'Must be at most {maximum}.',
  validationRequiredValue: 'This field is required.',
  validationPatternDetail: 'Invalid format. (Pattern: {pattern})',
  mcpValidationSchemaFailed:
    'Input did not pass schema validation. Check required fields and value formats.',
  mcpValidationRequiredMissing: 'Required input is missing. Fill in all required fields.',
  apiHintBadRequest: 'The request format is invalid. Check inputs or parameters.',
  apiHintUnauthorized: 'The API key is invalid or expired.',
  apiHintPaymentRequired: 'Insufficient balance. Check the payment method.',
  apiHintForbidden: 'Access denied. Check API key permissions.',
  apiHintNotFound: 'The requested model or endpoint was not found.',
  apiHintRateLimited: 'Rate limit exceeded. Try again later.',
  apiHintServerError: 'Internal server error. Try again later.',
  apiHintBadGateway: 'Gateway error. The server is temporarily unstable.',
  apiHintServiceUnavailable: 'The service is temporarily unavailable.',
  apiHintFetchCors:
    'Browser fetch/CORS or network blocking may be involved. Check the provider request path.',
  apiErrorCode: 'Error code: {code}',
  apiErrorLikelyCause: 'Likely cause: {hint}',
  apiErrorRaw: 'Raw: {error}',

  chatNewSession: 'New Chat',
  chatHistory: 'History',
  chatSessionTitle: 'Session Title',
  chatRenameSession: 'Rename Session',
  chatDeleteSession: 'Delete Session',
  chatDeleteConfirm: 'Are you sure you want to delete this session?',
  chatLoadSession: 'Load Session',
  chatAutoSave: 'Auto Save',
  chatAutoSaveDesc: 'Automatically save conversation content',
  chatAutoSaveDelay: 'Auto-save delay (ms)',
  chatAutoSaveDelayDesc: 'Delay before saving after last message',
  chatNoSavedSessions: 'No saved sessions',
  chatUnsavedChanges: 'Unsaved changes',
  chatGroupToday: 'Today',
  chatGroupYesterday: 'Yesterday',
  chatGroupThisWeek: 'This Week',
  chatGroupThisMonth: 'This Month',
  chatGroupOlder: 'Older',
  chatSearchPlaceholder: 'Search sessions...',
  chatNoSearchResults: 'No sessions match your search',
  chatCurrentSession: 'Current',
  chatSessionCount: '{count} sessions',
  chatMessageUnit: ' messages',
  chatDaysAgo: '{count}d ago',
  chatSessionRenamedNotice: 'Renamed the session.',
  chatSessionRenameFailedNotice: 'Failed to rename session: {message}',
  chatSessionRenameNoChangeNotice: 'The session name was not changed.',
  chatSessionRenameEmptyNotice: 'The session name is empty, so it was not changed.',
  chatSessionDeletedNotice: 'Deleted the session.',
  chatSessionDeleteFailedNotice: 'Failed to delete session: {message}',

  settingsAuto001: 'Most widely used default model. Strong balance between performance and cost.',
  settingsAuto002: 'Highest performance model. Strong for multilingual and complex context.',
  settingsAuto003: 'Via OpenRouter. Same quality, uses an OpenRouter API key.',
  settingsAuto004: 'Optimized for multilingual use including Korean. 8K context.',
  settingsAuto005: 'Supports 32K context. Suitable for long documents.',
  settingsAuto006:
    'Bundled on-device WASM embedding model. Runs on CPU without an API key or local server.',
  settingsAuto007:
    'Embedding setting changes were cancelled. Unsaved changes are discarded when closing the settings tab.',
  settingsAuto008: 'No model selected',
  settingsAuto022: '{v0} items',
  settingsAuto024:
    'Manage LLM providers for chat and command execution. Check enablement, model selection, and connection validation per provider.',
  settingsAuto025: '{v0} configured',
  settingsAuto026: 'Advanced diagnostics and tuning',
  settingsAuto027: 'RAG operations status',
  settingsAuto028: 'Calculating status...',
  settingsAuto029: 'Optional GraphRAG operations',
  settingsAuto030: 'Processed {v1} evidence items of {v0} files{v2}{v3}',
  settingsAuto030Desc:
    'This processed count is the number of extracted evidence units, not file count.',
  settingsAuto031: ', {v0} failed',
  settingsAuto032: ', {v0} need sync',
  settingsAuto033: 'No files are eligible for RAG indexing.',
  settingsAuto034: 'Status',
  settingsAuto035: 'Total files',
  settingsAuto036: 'Processed (evidence)',
  settingsAuto036Desc: 'Total saved evidence items. This can differ from the file count.',
  settingsAuto037: 'Failed files',
  settingsAuto038: 'Use the resume button to retry only failed files.',
  settingsAuto039: 'No failed files.',
  settingsAuto040: 'Sync required',
  settingsAuto041:
    'Files changed or the extraction model/contract changed, so re-extraction is required.',
  settingsAuto042: 'All files are up to date.',
  settingsAuto043: 'Cost/transfer',
  settingsAuto044: 'Communities',
  settingsAuto045: 'Show estimated cost details',
  settingsAuto046: 'Hide estimated cost details',
  settingsAuto047: 'Estimated files',
  settingsAuto048: 'Estimated calls',
  settingsAuto049: 'Estimated input tokens',
  settingsAuto050: 'Allow GraphRAG background build',
  settingsAuto051:
    'Explicitly allow long-running LLM extraction indexing. Basic RAG search remains independent of this setting.',
  settingsAuto052: 'GraphRAG model',
  settingsAuto053:
    'Model used for entity/relation/claim extraction. If empty, the run button is disabled.',
  settingsAuto054: 'Maximum files to process at once',
  settingsAuto055: 'GraphRAG extraction can be expensive, so a run limit is applied.',
  graphRagConcurrentRequestsLabel: 'Concurrent requests',
  graphRagConcurrentRequestsDesc:
    'Number of GraphRAG extraction requests processed at once. Adjust from 1 to 10 for your provider limits.',
  settingsAuto056: 'Choose the graph search method for each question type.',
  settingsAuto057: 'Criteria for automatic merge and pending merge.',
  settingsAuto058: 'Auto-sync',
  settingsAuto059: 'Automatically sync stale files when files change. LLM API costs may occur.',
  settingsAuto060: 'Auto-sync interval (minutes)',
  settingsAuto061: 'Minimum wait time after file changes before auto-sync.',
  settingsAuto062: 'GraphRAG background build is paused.',
  settingsAuto063:
    'The selected GraphRAG model provider is disabled or the model is missing from its model list.',
  settingsAuto064: 'GraphRAG model is not configured.',
  settingsAuto065: 'Community build cannot run while indexing.',
  settingsAuto066: 'No extracted data.',
  settingsAuto067: 'Processing {v0}/{v1} files{v2} — {v3}%',
  settingsAuto068: 'Requested cancellation of GraphRAG indexing.',
  settingsAuto069: 'Community build complete: {v0} communities, modularity {v1} ({v2}s)',
  settingsAuto070: 'Remote LLM content transfer',
  settingsAuto071: 'A remote LLM model will be used. API costs may occur. Continue?',
  settingsAuto072: 'Unable to read GraphRAG run results.',
  settingsAuto073: 'GraphRAG indexing was cancelled.',
  settingsAuto074: 'GraphRAG complete: {v0} processed, {v1} skipped, {v2} failed',
  settingsAuto075: 'Calculating file types...',
  settingsAuto076: 'Failed to load file types: {v0}',
  settingsAuto077: 'Indexing',
  settingsAuto078: 'Idle',
  settingsAuto079: 'Indexing: {v0}, queued {v1}',
  settingsAuto080: '{v0} documents, {v1} vectors',
  settingsAuto081: 'Embedding provider',
  settingsAuto082:
    'API keys use values configured in the Providers tab. Select only the embedding-specific model here.',
  settingsAuto083:
    'Embedding provider/model changes are not saved automatically. Click "Save" to apply them. Existing embedding data is not deleted when changed. To apply the new model to all data, run "Reindex all".',
  settingsAuto084: 'Select the provider to use for embeddings',
  settingsAuto085: 'Enter the embedding model ID directly',
  settingsAuto086: 'Example: my-custom-model',
  settingsAuto087: 'Select the embedding model to use',
  settingsAuto088: 'Save',
  settingsAuto089: 'Saving...',
  settingsAuto090: 'Embedding settings saved.',
  settingsAuto091: 'Failed to save embedding settings: {v0}',
  settingsAuto092: 'Cancel',
  settingsAuto093: 'Embedding setting changes were cancelled.',
  settingsAuto094: 'Test connection',
  settingsAuto095:
    'Only fetches the model/tag list. It does not send an embedding generation request.',
  settingsAuto096: 'Connection successful. Found {v0} models.',
  settingsAuto097: 'Connection failed: {v0}',
  settingsAuto098: 'Error: {v0}',
  settingsAuto099: 'Test embedding generation',
  settingsAuto100:
    'Sends a real minimal request with the selected embedding model. Charges may apply depending on provider.',
  settingsAuto101: 'Embedding generation successful: {v0}',
  settingsAuto102: 'Embedding generation failed: {v0}',
  settingsAuto103: 'Index statistics',
  settingsAuto104: 'Unable to load statistics.',
  settingsAuto105: 'RAG indexer is not initialized.',
  settingsAuto106: 'Total documents',
  settingsAuto107: 'RAG target files',
  settingsAuto108: 'Healthy',
  settingsAuto109: 'Documents whose vectors are currently up to date',
  settingsAuto110: 'Update required',
  settingsAuto111: 'Not indexed/modified/needs checking',
  settingsAuto112: 'Total vectors',
  settingsAuto113: 'Number of stored embedding vectors',
  settingsAuto114: '{v0} · {v1} items',
  settingsAuto115: 'Current status: {v0}',
  settingsAuto116: 'Current status: {v0} · last calculated: {v1}',
  settingsAuto117: 'Last calculated: {v0}',
  settingsAuto118: 'Current status',
  settingsAuto119: 'Required work',
  settingsAuto120: 'Auto update',
  settingsAuto121: 'Embedding: {v0} / {v1}',
  settingsAuto122: 'Not set',
  settingsAuto123: 'Storage: {v0}',
  settingsAuto124: 'Performance guard: {v0}',
  settingsAuto125: 'Check running indexing',
  settingsAuto126: 'Resume in about {v0} seconds',
  settingsAuto127: 'Update required documents',
  settingsAuto128: 'Full reindex if needed',
  settingsAuto129: 'No RAG target documents',
  settingsAuto130:
    'Indexing is running. You can stop it if it takes too long or Obsidian becomes slow.',
  settingsAuto131: 'Paused briefly by the performance guard. Reason: {v0}',
  settingsAuto132: 'Slow indexing detected',
  settingsAuto133:
    '{v0} documents are not reflected in search quality. Run update required documents.',
  settingsAuto134:
    'The current index is up to date. Full reindex is only needed if the model or storage changed.',
  settingsAuto135:
    'There are no RAG target documents with the current settings. Check exclusion paths or file types.',
  settingsAuto136: 'Off',
  settingsAuto137: 'On · {v0}',
  settingsAuto138: 'On',
  settingsAuto139: 'Next auto update: {v0}',
  settingsAuto140: 'Last auto update: {v0} documents, {v1} vectors',
  settingsAuto141: 'Recently skipped: {v0}',
  settingsAuto142: 'No status',
  settingsAuto143: 'Idle · about {v0} seconds remaining',
  settingsAuto144: 'Throttling · batch {v0}, wait {v1}ms',
  settingsAuto145: 'Normal · batch {v0}, wait {v1}ms',
  settingsAuto146: 'Checking document status...',
  settingsAuto147: 'Cannot calculate the document list because the RAG indexer is not initialized.',
  settingsAuto148: 'No documents need updating.',
  settingsAuto149: 'Documents needing update',
  settingsAuto150: 'Failed to load document status: {v0}',
  settingsAuto151:
    '{v0} documents need updating. Missing {v1}, stale {v2}, unknown {v3}. Showing at most 10 below.',
  settingsAuto152: 'Missing',
  settingsAuto153: 'Modified',
  settingsAuto154: 'Needs checking',
  settingsAuto155: 'Enable "{v0}" in the Providers tab first.',
  settingsAuto156: 'Enter the "{v0}" API Key in the Providers tab.',
  settingsAuto157: 'Select and save an embedding model.',
  settingsAuto158: 'Turn on the Enabled toggle for "{v0}" in the Providers tab.',
  settingsAuto159: 'Enter the API Key for "{v0}" in the Providers tab.',
  settingsAuto160:
    'No embedding model is selected. Select a model in the Embedding Provider section and click "Save".',
  settingsAuto161: 'Enter the embedding model ID directly and click "Save".',
  settingsAuto162: 'Failed to connect provider "{v0}" ({v1}). Check Base URL or API Key.',
  settingsAuto163: 'Run required actions',
  settingsAuto164: 'RAG indexer is not initialized. ',
  settingsAuto165: 'Starting update for {v0} documents...',
  settingsAuto166: 'Updated {v0} documents, skipped {v1}.',
  settingsAuto167: 'Indexing was stopped.',
  settingsAuto168: 'Indexing failed: {v0}',
  settingsAuto169: 'Reindex all',
  settingsAuto170: 'Starting full reindex...',
  settingsAuto171: 'Reindexed {v0} files',
  settingsAuto172: 'Reindexing failed: {v0}',
  settingsAuto173: 'Stop indexing',
  settingsAuto174: 'Resume now',
  settingsAuto175: 'Checking button state...',
  settingsAuto176: 'Reset embedding data',
  settingsAuto177: 'Delete all embedding data? This cannot be undone.',
  settingsAuto178: 'All embedding data has been reset.',
  settingsAuto179: 'Reset failed: {v0}',
  settingsAuto180: 'Select an action to run.',
  settingsAuto181: 'Core indexing exclusions',
  settingsAuto182: 'Auto-update and performance tuning',
  settingsAuto183: 'Automatically index new files at the configured interval',
  settingsAuto184: 'Performance tuning',
  settingsAuto185:
    'Defaults are applied automatically for the embedding provider; adjust manually only when needed.',
  settingsAuto186: 'Automatic',
  settingsAuto187: 'Manual',
  settingsAuto188: 'Auto adjusting · max batch {v0} · request pacing and load are optimized live.',
  settingsAuto189: 'Performance guard',
  settingsAuto190:
    'Automatically adjusts batch size and wait time if Obsidian becomes slow during indexing.',
  settingsAuto191: 'Embedding batch size',
  settingsAuto192:
    'Number of chunks to send in one embedding request. 1 is recommended for local Ollama models.',
  settingsAuto193: 'Wait between batches (ms)',
  settingsAuto194: 'Gives the main thread time to rest between consecutive indexing batches.',
  settingsAuto195: 'Slowdown detection thresholds',
  settingsAuto196:
    'Starts automatic mitigation based on event loop delay (ms) and batch processing time (ms).',
  settingsAuto197: 'Vector store type',
  settingsAuto198: 'Search quality tuning',
  settingsAuto199: 'Manage chat session save location and auto-save behavior.',
  settingsAuto200: 'System prompt',
  settingsAuto201: 'Manage the global default prompt and quick presets.',
  settingsAuto202: 'MCP tool execution',
  settingsAuto203: 'Adjust retry policy for mentioned MCP servers and tool calls.',
  settingsAuto204: 'Knowledge connections',
  settingsAuto205: 'Prioritizes suggestions for links and connections between notes.',
  settingsAuto206:
    'You are an Obsidian vault-based knowledge connection assistant. Prioritize the provided Vault Context and explicit file/folder mentions as evidence. Do not cite document names outside Vault Context; separate link candidates and new note structures as "Suggestions". Separate evidence from inference, and do not invent uncertain details.',
  settingsAuto207: 'Source-grounded answers',
  settingsAuto208: 'Clearly shows sources and limits of the vault context.',
  settingsAuto209:
    'You are a source-grounded answer assistant for an Obsidian vault. Prioritize file paths and headings included in Vault Context, and separate evidence-backed claims from inferences based on the user question. If relevant context is insufficient, do not invent an answer; ask for needed notes or follow-up questions.',
  settingsAuto210: 'Research notes',
  settingsAuto211: 'Organizes evidence, issues, and follow-up questions as research notes.',
  settingsAuto212:
    'You are an Obsidian research note assistant. When answering the user, separate key claims, evidence, counterarguments or uncertainty, and follow-up research questions. Do not cite document names outside Vault Context; separate related notes and link candidates in the vault as "Suggestions". Answer in Markdown that can be pasted directly into research notes.',
  settingsAuto213: 'Project notes',
  settingsAuto214: 'Separates decisions, action items, and risks clearly.',
  settingsAuto215:
    'You are an Obsidian project note assistant. Structure answers around decisions, action items, risks, and next actions. Use Vault Context as evidence, and do not cite document names outside Vault Context. Separate related project note link candidates and follow-up organization locations as "Suggestions".',
  settingsAuto216: 'Writing draft',
  settingsAuto217: 'Helps build outlines and paragraph flow using the vault’s existing context.',
  settingsAuto218:
    'You are an Obsidian writing assistant. Respect the vault’s existing note context and the user’s intent while suggesting outlines, paragraph flow, title candidates, and notes to link. Do not drift into simple summaries or translations unless requested; create drafts that can grow into notes.',
  settingsAuto219: 'The {v0} preset was saved to the library and applied as the global default.',
  settingsAuto220: 'System prompt was reset.',
  settingsAuto221: 'Connection status',
  settingsAuto222: 'Check and reconnect active MCP server connection status.',
  settingsAuto223: 'Edit servers as standard mcpServers JSON. Valid JSON is saved automatically.',
  settingsAuto224: 'Automatic MCP PATH lookup is available only in the Obsidian desktop app.',
  settingsAuto225: 'Saved, but {v0} server connections failed',
  settingsAuto226: 'Settings were saved, but {v0} server connections failed',
  settingsAuto227: 'MCP connection error:\n{v0}',
  settingsAuto228: 'JSON format error',
  settingsAuto229:
    'Error: {v0}\n\nExample:\n  {\n    "mcpServers": {\n      "my-server": {\n        "command": "npx",\n        "args": ["-y", "@modelcontextprotocol/server-filesystem"]\n      }\n    }\n  }',
  settingsAuto230: 'Missing "mcpServers" key',
  settingsAuto231: 'Error: {v0}\n\nExample:\n  {\n    "mcpServers": { ... }\n  }',
  settingsAuto232: 'Invalid "mcpServers" format',
  settingsAuto233:
    'Error: {v0}\n\nExample:\n  {\n    "mcpServers": {\n      "server-name": { ... }\n    }\n  }',
  settingsAuto234: 'Missing server settings',
  settingsAuto235:
    'Error: {v0}\n\nExample:\n  "my-server": {\n    "command": "npx",\n    "args": ["-y", "@modelcontextprotocol/server-filesystem"]\n  }',
  settingsAuto236: 'Invalid "args" format',
  settingsAuto237:
    'Error: {v0}\n\nExample:\n  "args": ["-y", "@modelcontextprotocol/server-filesystem"]',
  settingsAuto238: 'Invalid "env" format',
  settingsAuto239: 'Error: {v0}\n\nExample:\n  "env": {\n    "API_KEY": "secret"\n  }',
  settingsAuto240: 'JSON syntax error',
  settingsAuto241:
    'JSON syntax error: {v0}\n\nCheck:\n• no comma after the last property\n• quotation marks are paired\n• braces ({}) and brackets ([]) are paired',
  settingsAuto242: 'Plugin-aware generation',
  settingsAuto243:
    'Includes active plugin information in LLM prompts to improve Obsidian syntax compatibility.',
  settingsAuto244: 'Display name',
  settingsAuto245: 'Example: LM Studio',
  settingsAuto246: 'Example: http://localhost:1234/v1',
  settingsAuto247: 'Bypass CORS (requestUrl)',
  settingsAuto248: 'Send requests through the Obsidian internal API to bypass CORS issues. ',
  settingsAuto249: 'Streaming is disabled, so turn this off if the server supports CORS.',
  settingsAuto250: 'Import models...',
  settingsAuto251: 'Show selected only',
  settingsAuto252: '{v0} selected',
  settingsAuto253: 'Showing {v0}/{v1} models',
  settingsAuto254: 'No models match the search.',
  settingsAuto255: 'Import models',
  settingsAuto256: 'Only fetches the model/tag list. It does not send a token generation request.',
  settingsAuto257: 'Fetch models',
  settingsAuto258: 'Fetched {v0} models.',
  settingsAuto259: 'Model import failed: {v0}',
  settingsAuto260: 'Connection successful: found {v0} models.',
  settingsAuto261: 'Minimal generation test',
  settingsAuto262:
    'Sends a real minimal generation request with the first selected model. Charges may apply depending on provider.',
  settingsAuto263: 'Select at least one model before running the minimal generation test.',
  settingsAuto264: 'Minimal generation successful: {v0}',
  settingsAuto265: 'Minimal generation failed: {v0}',
  settingsAuto266:
    'Register a server that provides an OpenAI v1 interface, such as LM Studio, vLLM, or LiteLLM.',
  settingsAuto267: 'Delete provider',
  settingsAuto268: 'Add provider',
  settingsAuto269: 'Reconnect MCP',
  settingsAuto270: '{v0} servers failed',
  settingsAuto271: 'reconnectMCP is not a function.',
  settingsAuto272: 'Reconnecting...',
  settingsAuto273: 'MCP connection status was refreshed.',
  settingsAuto274: '{v0} (currently selected)',

  // MCP PATH
  mcpPathTitle: 'MCP PATH Environment Variable',
  mcpPathDesc:
    'Set the PATH value used when running MCP servers. Leave empty to use the default PATH.',
  mcpPathFetch: 'Fetch PATH from Terminal',
  mcpPathFetching: 'Fetching...',
  mcpPathFetchSuccess: 'Terminal PATH fetched successfully',
  mcpPathFetchError: 'Failed to fetch terminal PATH',
  mcpPathFetchErrorHelp:
    'If automatic detection fails, paste the output of printenv PATH manually or use an absolute path for the MCP command.',
  mcpPathPlaceholder: 'e.g., /usr/local/bin:/usr/bin:/bin',
  mcpPathCommandNotFoundHint:
    'Save your terminal PATH in MCP PATH or set "{command}" to an absolute path. When Obsidian is launched from the macOS GUI, commands such as npx/uvx may not be visible.',
  mcpIncludeWslPath: 'Also fetch WSL PATH',
  mcpIncludeWslPathDesc:
    'On Windows, also query PATH from WSL when fetching PATH. Linux executables inside WSL cannot be run directly from Windows, so WSL-based MCP servers should use wsl.exe as the command.',

  // MCP
  mcpCommand: 'Command',
  mcpCommandDesc: 'stdio execution command',
  mcpArgs: 'Arguments',
  mcpArgsDesc: 'stdio execution arguments (space-separated)',
  addMcpServer: 'Add MCP Server',
  deleteMcpServer: 'Delete',
  mcpStatus: 'MCP Status',
  mcpTotalActive: 'Active {count} / Total {total}',
  mcpConnected: 'Connected',
  mcpDisconnected: 'Disconnected',
  mcpConnectionFailed: 'Connection failed',
  mcpConnectionHealth: 'Connection Health',
  mcpNoServers: 'No MCP servers registered.',
  mcpInitFailed: 'Failed to connect MCP server "{name}": {error}',
  mcpStatusConnected: 'Connected',
  mcpStatusConnecting: 'Connecting',
  mcpStatusDisconnected: 'Disconnected',
  mcpStatusError: 'Error',
  mcpJsonEditor: 'JSON Editor',
  mcpJsonSaved: 'Settings saved.',
  mcpJsonInvalid: 'JSON parse error',
  mcpJsonInvalidObject: 'JSON must be an object({}).',
  mcpJsonMissingMcpServers: '"mcpServers" key is missing.',
  mcpJsonInvalidMcpServers: '"mcpServers" must be an object.',
  mcpJsonInvalidServerValue: 'Server value is not an object',
  mcpJsonServerNeedsCommand: 'Server needs "command"',
  mcpJsonInvalidArgs: '"args" must be an array',
  mcpJsonInvalidEnv: '"env" must be an object',
  mcpJsonInvalidArray: 'mcpServers must be a JSON Array.',
  mcpJsonLinting: 'Linting JSON...',
  mcpJsonLintOk: 'JSON syntax OK',
  mcpJsonLintError: 'JSON syntax error: {error}',
  mcpJsonSchemaError: 'Schema error: {field} field is missing',
  mcpJsonLine: 'Line',
  mcpJsonAutoSave: 'Auto Save',
  mcpJsonAutoSaveDesc: 'Auto-save 1 second after editing (only if JSON is valid)',
  totalLabel: 'Total',

  // Settings Header
  settingsTitle: 'Superpower Inside — Settings',
  securityWarning:
    'Warning: settings and API keys are stored unencrypted in this device’s Obsidian local storage and plugin data.json. They may be exposed through vault sync, local backups, or users with access to this device.',

  // Tabs
  tabGeneral: 'General',
  tabProviders: 'Providers',
  // Providers tab common actions
  collapseAll: 'Collapse All',
  expandAll: 'Expand All',
  modelCountBadge: ' models',
  noProviderEnabledBanner: 'Enable at least one provider and select models to use in chat.',
  providerConnectionSection: 'Connection',
  providerDetailContextLabel: 'Connection details',
  providerModelsSection: 'Model Selection',
  providerActionsSection: 'Test & Actions',
  selectedOnly: 'Selected only',
  fetchModels: 'Import models',
  testGeneration: 'Test Generation',
  providerCommandCenterTitle: 'LLM Connection Console',
  providerCommandCenterDesc:
    'Review the provider readiness used by chat, RAG, and GraphRAG in one place.',
  providerConnectionTitle: 'Provider connections',
  providerSummaryLine:
    '{ready} ready · {attention} need attention · {general} chat · {embedding} embedding',
  providerSummaryNoProfiles: 'No providers are connected.',
  providerStatusSectionTitle: 'Current status',
  providerStatusSectionDesc: 'Check whether providers for chat and search are ready.',
  providerStatusNone: 'None yet',
  providerStatusNeedsSetup: '{count} need setup',
  providerStatusSummaryDetail: '{enabled} of {total} enabled, {ready} ready',
  providerAttentionTitle: 'Finish setting up {provider}',
  providerContinueSetup: 'Continue setup',
  providerAddTitle: 'Connect a new provider',
  providerAddDesc: 'Add OpenAI, Claude, Ollama, or an OpenAI-compatible server.',
  providerConnectionsSectionTitle: 'Connections',
  providerConnectionsSectionDesc: 'Expand a provider to manage its connection and models.',
  providerConnectionsEmpty: 'No providers are connected. Add a new connection above.',
  providerNewName: 'New provider',
  providerDangerTitle: 'Remove provider',
  providerDangerDesc: 'Delete this connection and its saved model settings.',
  providerRemoveWarning: '{provider} and its model list will be removed from settings.',
  providerRemoveConfirm: 'Remove the {provider} provider?',
  providerRemoved: 'Removed the {provider} provider.',
  providerModelCountLine: '{provider} · {general} chat · {embedding} embedding',
  providerApiKeyShow: 'Show API key',
  providerApiKeyHide: 'Hide API key',
  providerDashboardReady: 'Ready',
  providerDashboardReadyDetail: 'Providers ready to use',
  providerDashboardAttention: 'Needs action',
  providerDashboardAttentionDetail: 'Key or model selection required',
  providerDashboardEnabled: 'Enabled',
  providerDashboardEnabledDetail: 'Providers currently turned on',
  providerDashboardModels: 'Selected models',
  providerDashboardModelsDetail: 'Registered chat models',
  providerSetupEnableTitle: 'Enable Provider',
  providerSetupEnableDetail:
    'Turn on only the services you use to keep the page dense but readable.',
  providerSetupAuthTitle: 'Add Auth',
  providerSetupAuthDetail: 'Local providers can stay keyless; remote providers need their API key.',
  providerSetupModelsTitle: 'Trim Models',
  providerSetupModelsDetail: 'Fetch models, then keep only the models you actually use.',
  providerSetupValidateTitle: 'Validate Fast',
  providerSetupValidateDetail:
    'Run connection and minimal generation tests to see the failing step immediately.',
  providerStatusReady: 'Ready',
  providerStatusNeedsKey: 'Key needed',
  providerStatusNeedsModels: 'Models needed',
  providerStatusOff: 'Off',
  providerSummaryReady: '{v0} models ready',
  providerSummaryNeedsKey: 'Enter an API Key to use this provider',
  providerSummaryNeedsModels: 'Select at least one model',
  providerSummaryOff: 'Enable when needed',
  providerKeyReady: 'Key ready',
  providerKeyMissing: 'Key needed',
  providerKeyNotRequired: 'No key required',
  providerModelChatVerified: 'Chat verified',
  providerModelChatUnknown: 'Chat untested',
  providerModelChatFailed: 'Chat failed',
  providerModelEmbeddingVerified: 'Embedding verified',
  providerModelEmbeddingUnknown: 'Embedding untested',
  providerModelEmbeddingFailed: 'Embedding failed',
  providerTestChatModel: 'Test minimal generation for this model',
  providerTestEmbeddingModel: 'Test embeddings for this model',
  providerEmbeddingUnsupported: 'This provider does not support embedding tests.',
  providerModelsSelected: '{v0} selected',
  providerNoModelsShort: 'No models',
  providerTypeBuiltIn: 'Built-in',
  providerTypeCustom: 'Custom',
  providerQuickKey: 'Auth',
  providerQuickModels: 'Models',
  providerQuickType: 'Type',
  providerCustomDockTitle: 'Custom OpenAI-Compatible',
  providerCustomDockDesc:
    'Manage local servers or internal OpenAI-compatible endpoints in the same card flow.',
  providerStrategyLabel: 'Provider type',
  providerStrategyDesc: 'Choose how this profile connects to the model API.',
  providerBaseUrl: 'Endpoint URL',
  providerGeneralModels: 'General models',
  providerEmbeddingModels: 'Embedding models',
  providerGeneralModelsDesc: 'Chat and GraphRAG generation',
  providerEmbeddingModelsDesc: 'RAG indexing and retrieval',
  providerAddGeneralModel: 'Add general model',
  providerAddEmbeddingModel: 'Add embedding model',
  providerImportModelsTitle: 'Choose models to import',
  providerImportModelsDesc: 'Select only the models you want to use from {v0}.',
  providerImportSearchPlaceholder: 'Search model names',
  providerImportAddSelected: 'Add selected models',
  providerImportCount: '{v0} selected / {v1} shown',
  providerImportNoNewModels: 'There are no new models to add.',
  providerImportNoMatches: 'No matching models.',
  providerImportContext: '{v0} context',
  providerImportMoreResults: '{v0} more models. Search to narrow the list.',
  providerImportAdded: 'Added {v0} models.',
  tabRag: 'RAG',
  tabChat: 'Chat',
  tabMcp: 'MCP',
  tabAdvanced: 'Advanced',

  // Commands
  mcpAutoConnectFailedCount: 'MCP auto-connect failed: check {count} servers.',
  mcpAutoConnectFailedMessage: 'MCP auto-connect failed: {message}',
  ragIndexerNotInitializedBase: 'The RAG indexer is not initialized.',
  ragIndexerEnableProvider: 'Turn on the Enabled toggle for "{provider}" in the Providers tab.',
  ragIndexerEnterApiKey: 'Enter the API Key for "{provider}" in the Providers tab.',
  ragIndexerSelectEmbeddingModel:
    'No embedding model is selected. Choose a model in Settings → RAG and save it.',
  ragIndexerConnectionFailed:
    'Failed to connect "{provider}" ({model}). Check the Base URL or API Key.',
  ragIndexerLastInitError: 'Last initialization error: {message}',
  ragIndexerLastInitSkipped: 'Last initialization skipped: {reason}',
  ragRuntimeInitStepTimedOut:
    'RAG runtime initialization did not finish stage "{stage}" within {seconds} seconds.',
  vaultIndexingStarted: 'Vault indexing started...',
  vaultIndexingDone: 'Indexed {count} files',
  indexingCancelled: 'Indexing was cancelled.',
  indexingFailedWithMessage: 'Indexing failed: {message}',
  ragIdle: 'Idle',
  ragStatsFailed: 'Failed to calculate statistics',
  graphRagAutoSyncStarted: 'GraphRAG auto-sync started...',
  graphRagAutoSyncDone: 'GraphRAG auto-sync complete: processed {processed}, failed {failed}',
  graphRagStaleSyncStatusNotice: 'GraphRAG {label}: {description}',
  graphRagRunNoopNotice:
    'GraphRAG extraction: no files were selected. All files may already be up to date, or there may be no current RAG indexing candidates.',
  graphRagFailedRetryNoopNotice:
    'GraphRAG failed-file retry: no failed files were selected. You can open the explorer to check whether previous failures were already resolved.',
  graphRagStaleSyncNoopNotice:
    'GraphRAG stale sync: no files need extraction. All files are up to date, or no remaining changed candidates exist in the current RAG index.',
  ragPerformancePaused: 'Performance guard paused',
  ragPerformanceThrottled: 'Throttling',
  ragIndexingInProgress: 'Indexing',
  ragIndexingRunning: 'Indexing: {phase}',
  ragIndexingRunningWithEta: 'Indexing: {phase} - {completed}/{total} files, ETA {eta}',
  ragIndexingRunningWithApproxEta: 'Indexing: {phase} - {completed}/{total} files, ETA about {eta}',
  ragIndexingRunningEtaCalculating:
    'Indexing: {phase} - {completed}/{total} files, calculating ETA',
  ragIndexingRunningWithEtaReason:
    'Indexing: {phase} - {completed}/{total} files, ETA {eta} ({reason})',
  ragIndexingRunningWithApproxEtaReason:
    'Indexing: {phase} - {completed}/{total} files, ETA about {eta} ({reason})',
  ragIndexingRunningEtaCalculatingReason:
    'Indexing: {phase} - {completed}/{total} files, calculating ETA ({reason})',
  ragEtaReasonComplete: 'complete',
  ragEtaReasonPlannedStable: 'planned chunks and stable recent speed',
  ragEtaReasonPlannedVariableRate: 'planning is complete, but recent speed varies',
  ragEtaReasonPlannedPartial: 'planned chunks with partial progress samples',
  ragEtaReasonInsufficientSamples: 'not enough progress samples yet',
  ragEtaReasonCalibrationVariable: 'previous file estimates varied',
  ragEtaReasonCalibratedEstimate: 'calibrated speed from completed files',
  ragEtaReasonBatchRateOnly: 'recent batch speed only',
  ragEtaReasonElapsedRateOnly: 'overall elapsed speed only',
  ragIndexingResult: '{documents} documents, {vectors} vectors',
  ragPhaseFile: 'Changed file',
  ragPhasePending: 'Update pending documents',
  ragPhaseAll: 'Full reindex',
  ragPhaseIdle: 'Idle',
  ragAutoUpdateAlreadyRunning: 'Indexing is already running.',
  ragAutoUpdatePausedRetry:
    'Performance guard paused. You can try again in about {seconds} seconds.',
  ragAutoUpdateNoTargets: 'No update targets',
  vectorStoreDescriptionJson:
    'JSON File stores data in .superpower-inside/vectors.json inside the vault, so it is easy to include in Obsidian Sync, Git, and file backups, but large vector files increase write cost and sync conflict risk.',
  vectorStoreDescriptionIndexedDb:
    'IndexedDB stores data in the local Obsidian/Electron browser database, which is better for large structured data and index lookups without modifying vault files, but it is device-local and not automatically included in vault sync or Git backups.',
  vectorStoreTransferToIndexedDb:
    'IndexedDB does not automatically copy existing JSON vectors. Run a full reindex or switch back to JSON File storage.',
  vectorStoreTransferToJson:
    'JSON File does not automatically copy existing IndexedDB vectors. Run a full reindex or switch back to IndexedDB storage.',
  unsetLabel: 'Not set',
  chatFolderExcludeCurrentDesc:
    'Automatically exclude the chat save folder from RAG indexing. Current exclusion target: {folder}',
  ragNoUpdates: 'No documents need updating.',
  ragNoDocuments: 'No RAG target documents.',
  ragNoPendingUpdatesNotice: 'Already up to date.',
  ragNoDocumentsNotice: 'No RAG target documents to index.',
  ragIndexCancelRequestedNotice: 'Indexing cancellation was requested.',
  ragIndexResumeRequestedNotice: 'Indexing resumed.',
  ragNoRunningIndexing: 'No indexing job is running.',
  ragNotPerformancePaused: 'Performance guard is not paused.',
  graphRagStatusDisabledLabel: 'Build paused',
  graphRagStatusDisabledDesc:
    'Only long-running GraphRAG extraction is paused. Prepared graph data can still improve normal chat.',
  graphRagStatusNotBuiltLabel: 'Not built',
  graphRagStatusNotBuiltDesc:
    'GraphRAG index has not been created yet. Use the start button to create it.',
  graphRagStatusBuildingLabel: 'Building',
  graphRagStatusBuildingDesc: 'Extracting the knowledge graph. Wait for completion.',
  graphRagStatusReadyLabel: 'Ready',
  graphRagStatusReadyDesc: 'GraphRAG is up to date and will use the knowledge graph for questions.',
  graphRagStatusStaleLabel: 'Sync required',
  graphRagStatusStaleDesc:
    'Some files changed, or the extraction model or contract changed, so re-extraction is required.',
  graphRagStatusPartialLabel: 'Partially complete',
  graphRagStatusPartialDesc: 'Some file extraction failed. You can retry only the failed files.',
  graphRagDisabledReason: 'GraphRAG background build is paused.',
  graphRagProviderMissingReason:
    'Enable the selected GraphRAG model provider and add the model to its model list.',
  graphRagModelMissingReason: 'Select a GraphRAG extraction model.',
  graphRagAlreadyRunningReason: 'GraphRAG indexing is already running.',
  graphRagNoFilesReason: 'There are no files eligible for GraphRAG indexing.',
  graphRagNoRunningReason: 'No GraphRAG indexing job is running.',
  graphRagNoFailedReason: 'There are no failed files to resume.',
  graphRagLiveStatusRunningTitle: 'GraphRAG is indexing now',
  graphRagLiveStatusIdleTitle: 'GraphRAG indexing is idle',
  graphRagLiveStatusIdleDetail: 'No GraphRAG indexing job is running.',
  graphRagLiveChunkDetail: '{processed} chunks saved',
  graphRagLiveChunkDetailWithFailed: '{processed} chunks saved, {failed} failed',
  graphRagLiveStorageDetail:
    'Saved: evidence {evidence}, entities {entities}, relations {relations}, claims {claims}, rejected {rejected}',
  graphRagPhaseIdle: 'Idle',
  graphRagPhaseSelectingFiles: 'Preparing target files',
  graphRagPhaseCheckingCache: 'Checking extraction cache',
  graphRagPhaseApiWaiting: 'Waiting for API response',
  graphRagPhaseApiResponseReceived: 'API call complete',
  graphRagPhaseApiResponseNormalizing: 'Cleaning API response',
  graphRagPhaseStoringResults: 'Saving extraction results',
  graphRagPhaseFileCompleted: 'File extraction complete',
  graphRagPhaseBuildingCommunities: 'Organizing communities',
  graphRagPhaseCompleted: 'Extraction complete',
  graphRagPhaseCancelled: 'Cancelled',
  graphRagStartScopeLimited: 'Extract up to {limit} new files out of {total} targets.',
  graphRagStartScopeAll: 'Extract GraphRAG target files.',
  graphRagActionExtract: 'Extraction',
  graphRagStartAll: 'Run full extraction',
  graphRagStartDescription:
    '{scope} Failure records are cleared when each file is processed again.',
  graphRagCancel: 'Stop running job',
  graphRagCancelDesc: 'Request cancellation for the current GraphRAG extraction job.',
  graphRagResumeFailed: 'Retry failed only',
  graphRagResumeFailedWithCount: 'Retry failed only ({count})',
  graphRagResumeFailedDesc:
    'Extract only files that failed in the last run. Successful files are not touched.',
  graphRagSyncStale: 'Sync changes',
  graphRagSyncStaleWithCount: 'Sync changes ({count})',
  graphRagSyncStaleDesc:
    'Re-extract only files that are stale because files, models, or the extraction contract changed.',
  graphRagMaintain: 'Graph maintenance',
  graphRagBuildCommunities: 'Rebuild communities',
  graphRagBuildCommunitiesDesc:
    'Recalculate community summaries from already extracted entities and relations without re-extracting files.',
  graphRagResetData: 'Reset GraphRAG data',
  graphRagResetDataDesc:
    'Delete extracted evidence, entities, relations, claims, communities, and cache, then reset processing state.',
  graphRagResetDataConfirm: 'Delete all GraphRAG extraction data and reset state? Continue?',
  graphRagResetDataDone: 'GraphRAG data has been reset.',
  graphRagResetDataFailed: 'GraphRAG data reset failed: {v0}',
  graphRagInspect: 'Inspect results',
  graphRagOpenExplorer: 'Open explorer',
  graphRagOpenExplorerDesc:
    'Review entities, relations, evidence, rejected responses, and error codes.',
  graphRagCostLocal: 'Runs locally',
  graphRagCostRemote: 'Sends content to remote LLM',
  embeddingDimensionsLabel: '{name} ({dimensions} dimensions)',
  embeddingProviderModelDesc: 'Embedding model from the Providers tab model list.',
  embeddingCurrentLabel: '{model} (currently selected)',
  embeddingCurrentDesc:
    'This is the currently selected model. It is not in the Providers tab model list or default presets, but it is preserved to avoid losing settings.',
  overviewProviderOff: 'Off',
  overviewProviderKeyNeeded: 'Key needed',
  overviewProviderNoModels: 'No models',
  overviewReady: 'Ready',
  overviewModelsCount: '{count} models',
  overviewDisabled: 'Disabled',
  overviewProviderMissingKeyDetail:
    'Enter an API Key before using this provider for chat or embeddings.',
  overviewProviderNoModelsDetail: 'Select at least one model before using this as a default model.',
  overviewProviderModelsSelected: 'Models selected',
  overviewProviderDisabledDetail: 'You can enable this in the Providers tab when needed.',
  overviewProviderCheckModels: 'Check models',
  overviewProviderSummaryDetail: '{enabled} enabled, {ready} ready',
  overviewProviderNoneActive: 'No active providers.',
  overviewRunning: 'Running',
  overviewBeforeCalculation: 'Not calculated',
  overviewRagNotCalculatedDetail: 'Status for {embedding} has not been calculated yet.',
  overviewNoTargets: 'No targets',
  overviewNeedsCount: '{count} needed',
  overviewLatest: 'Up to date',
  overviewNoIndexingTargetFiles: 'No files are eligible for indexing.',
  overviewRagNeedsDetail: '{count} documents are missing, stale, or unknown.',
  overviewRagHealthyDetail: '{healthy}/{total} documents are up to date.',
  overviewSyncRequired: 'Sync required',
  overviewGraphRagDisabledDetail:
    'Only expensive GraphRAG extraction is paused. Vector, BM25, structural search, and prepared graph enrichment remain available.',
  overviewNeedsSetup: 'Setup needed',
  overviewGraphRagRunnerMissing: 'Runner is not initialized.',
  overviewGraphRagExtractingDetail: 'Extraction indexing is running.',
  overviewGraphRagNotCalculated: 'GraphRAG status has not been calculated yet.',
  overviewGraphRagEvidenceReady: '{count} evidence items are ready.',
  overviewGraphRagStaleValue: '{count} stale',
  overviewGraphRagStaleDetail: 'Sync is required because files or models changed.',
  overviewGraphRagPartialDetail: '{count} file failures remain.',
  overviewNotReady: 'Not ready',
  overviewGraphRagNeedIndexing: 'Run GraphRAG indexing.',
  overviewToolCallReady: 'Tool calls ready',
  overviewConnectionCheck: 'Check the connection state.',
  overviewNone: 'None',
  overviewNoServers: 'No servers',
  overviewPartialError: 'Partial error',
  overviewError: 'Error',
  overviewConnected: 'Connected',
  overviewConnecting: 'Connecting',
  overviewDisconnected: 'Disconnected',
  overviewMcpNoServersDetail: 'No MCP servers are registered.',
  overviewMcpErrorsDetail: '{count} server connection errors.',
  overviewMcpAllConnected: 'All MCP servers are connected.',
  overviewMcpSomeDisconnected: 'Some MCP servers are not connected.',
  overviewChatDefaultModel: 'Default model {model}',
  overviewChatDefaultUnavailable: 'The default model is not in the active provider model list.',
  overviewProviderApiKeyNeeded: '{provider} API Key needed',
  overviewChatModelAttention: 'Default model needs review',
  overviewRagSyncAttention: 'RAG sync required',
  overviewMcpErrorAttention: 'MCP connection error',
  overviewGraphRagErrorAttention: 'GraphRAG status error',
  overviewEmbeddingLabel: '{provider} / {model}',
  overviewOpenProviders: 'Open providers',
  overviewOpenGeneral: 'Choose default model',
  overviewOpenRag: 'Open search settings',
  overviewOpenMcp: 'Open MCP settings',
  pluginDataResetTitle: 'Reset all plugin data',
  pluginDataResetDesc:
    'Return Superpower Inside internal data to defaults when frequent updates leave settings, indexes, or caches in a tangled state.',
  pluginDataResetWarning:
    'Settings, Provider/API keys, MCP servers, prompt library, RAG/GraphRAG indexes, and embedding cache will be deleted. This cannot be undone.',
  pluginDataResetScope:
    'Regular vault notes and chat session Markdown files are not deleted. Only internal data.json, local settings, IndexedDB, and .superpower-inside data are reset.',
  pluginDataResetButton: 'Reset all data',
  pluginDataResetRunning: 'Resetting...',
  pluginDataResetConfirm:
    'Reset all Superpower Inside internal data? Settings and API keys will return to defaults.',
  pluginDataResetSecondConfirm:
    'Are you sure you want to continue? This action cannot be cancelled or recovered.',
  pluginDataResetDone: 'Superpower Inside internal data has been reset.',
  pluginDataResetFailed: 'Failed to reset all plugin data: {message}',
  mcpToolNotFoundInConnectedServers: 'Tool `{tool}` was not found on connected MCP servers.',
  mcpServerNotConnected: 'MCP server `{server}` is not connected.',
  mcpRegistryUnavailableNotice: 'MCP registry is not initialized.',
  mcpClientUnavailableNotice: 'Could not find the MCP client for `{server}`.',
  mcpToolErrorPrefix: '[MCP tool error] {message}',
  mcpToolEmptyResult: 'MCP tool `{tool}` returned an empty result.',
  mcpValidationPattern: 'The input format is invalid. Required pattern: `{pattern}`',
  mcpValidationField: 'Field `{field}` has an invalid value.',
  mcpValidationGeneric: 'Input validation failed.',
  refreshAlreadyRunning: 'Already running.',
  refreshFailedWithMessage: 'Refresh failed: {message}',
  refreshCancelled: 'Cancelled',
  mcpNoExecutableShell: 'No executable shell was found.',
  mcpNoPowerShellPath: 'Unable to read PATH from PowerShell.',
  mcpDesktopOnly: 'MCP stdio transport is available only in the Obsidian desktop app.',
  apiKeyUnauthorizedError: 'The API key is invalid or unauthorized ({status})',
  endpointOrModelNotFoundError: 'Endpoint or model not found ({status})',
  serverStatusError: 'Server error ({status})',
  apiStatusError: 'API error ({status}): {body}',
  connectionFailedNoServer: 'Connection failed: server is unreachable',
  customProviderBaseUrlHint:
    '{error}. Check the custom provider base URL or whether /models is supported.',
  customProviderBaseUrlRequired: 'Enter the custom provider base URL.',
  ollamaEmbeddingContextTooLong:
    'The Ollama embedding model exceeded its maximum context length. Long single lines and log files are now split automatically, so rebuild the plugin and reindex RAG. If it still fails, exclude that file or lower the chunk size. (Original error: {error})',
  ragStatusMissingReason: 'Not indexed yet.',
  ragStatusLegacyReason: 'This vector uses an older format, so file changes cannot be checked.',
  ragStatusStaleFileReason: 'The file changed since the last indexing run.',
  ragStatusEmbeddingChangedReason:
    'Current embedding settings differ from the stored vector settings.',
  ragStatusHealthyReason: 'Up to date.',
  perfGuardResumed: 'Resumed with the minimum batch after performance guard pause',
  perfEventLoopLag: 'Event loop lag {ms}ms',
  perfIndexingBatch: 'Indexing batch {ms}ms',
  perfSlowDetected: 'Slowdown detected: {reason}',
  perfPausedWithReason: 'Performance guard paused: {reason}',
  ragExcludeSensitiveReason:
    'Excluded from default RAG targets because it may contain sensitive information.',
  ragExcludeUnreadableReason: 'Excluded from RAG targets because it cannot be safely read as text.',
  noExtensionLabel: 'No extension',
  assistantQuestionPrefix: 'Question: {question}',
  assistantQuestionSelectedItems: 'Selected items:',
  assistantQuestionAdditionalInput: 'Additional input:',
  editMessageTitle: 'Edit message',
  sourceUnverifiedIdWarning: 'This answer cited a source that was not checked.',
  sourceMissingVaultLinkWarning: 'This document link was not found in the vault.',
  referenceMissingWarning: 'Reference document not found: {path}',
  referenceReadFailedWarning: 'Unable to read reference document: {path} ({error})',
  pluginAwareContext7FirstRule:
    'When active Obsidian plugin syntax, APIs, settings, code examples, queries, templates, or automations are needed, first look up the relevant documentation with the Context7 MCP tool.',
  pluginAwareContext7NoGuessRule:
    'If Context7 cannot find documentation, say that documentation was not found and do not guess plugin-specific syntax.',
  defaultChatTitle: 'New chat',
  chatSaveEmptyAssistantWarning:
    '[Superpower Inside] Save warning: message {id} has empty content.',
  fileNotFoundError: 'File not found: {path}',
  toolResultTruncatedLabel: 'truncated',
  toolApprovalPendingSuffix: ' (pending approval)',
  rejectedFactInvalidJsonTitle: 'Unable to parse LLM response as JSON',
  rejectedFactInvalidJsonDesc:
    'The model did not return a JSON object matching the GraphRAG extraction schema. This often happens with OpenRouter/free models when empty responses, explanatory text, refusal text, or truncated responses are mixed in.',
  rejectedFactUnknownEntityTitle: 'Unknown entity type',
  rejectedFactUnknownEntityDesc:
    'A legacy extraction used an entity type that its old contract did not allow.',
  rejectedFactSchemaShapeTitle: 'JSON shape does not match the GraphRAG extraction schema',
  rejectedFactSchemaShapeDesc:
    'The response parsed as JSON, but required fields such as entities.name/typeId, relations.relationTypeId, or claims.text/claimTypeId did not match the expected structure.',
  rejectedFactUnknownRelationEntityTitle: 'Unable to find relation entity',
  rejectedFactUnknownRelationEntityDesc:
    'The relation source/target names returned by the model did not match the entities in the same response.',
  rejectedFactRelationMismatchTitle: 'Relation source/target type mismatch',
  rejectedFactRelationMismatchDesc:
    'A legacy extraction used a relation rejected by its old contract.',
  rejectedFactUnknownClaimTitle: 'Unknown claim type',
  rejectedFactUnknownClaimDesc:
    'A legacy extraction used a claim type that its old contract did not allow.',
  rejectedFactExtractionErrorTitle: 'Extraction call error',
  rejectedFactExtractionErrorDesc:
    'An exception occurred during the LLM call, network request, or provider response handling.',
  rejectedFactDefaultTitle: 'GraphRAG extraction result failed schema validation',
  rejectedFactDefaultDesc:
    'Some facts in the model response do not match the current knowledge contract or store validation rules.',
  rejectedFactEmptyResponse: '(empty response)',
  defaultObsidianSystemPrompt: [
    'You are a knowledge-work assistant that operates with an Obsidian vault.',
    'Respect the user vault as a personal knowledge base, and prioritize the provided Vault Context plus explicitly mentioned files or folders as evidence.',
    'Separate evidence-backed content from inference, and ask for more context instead of inventing details when uncertain.',
    'Write clear Markdown that the user can paste directly into their note-writing flow.',
    'Do not cite document names that are absent from Vault Context, and separate new note or link candidates as suggestions.',
    'If relevant evidence is insufficient, say that you could not find relevant documents.',
    'Do not treat code review, translation, or simple summarization as the default role; focus on those only when the user explicitly asks.',
  ].join('\n'),
  promptPresetKnowledgeConnectionLabel: 'Knowledge connections',
  promptPresetKnowledgeConnectionInstruction:
    'Actively find links between concepts, files, and headings in the vault so the user can build next note links and knowledge structure.',
  promptPresetResearchNotesLabel: 'Research notes',
  promptPresetResearchNotesInstruction:
    'Separate evidence, counterarguments, open questions, and follow-up research items into answers that are easy to reuse as research notes.',
  promptPresetProjectNotesLabel: 'Project notes',
  promptPresetProjectNotesInstruction:
    'Clearly separate decisions, action items, risks, and next steps so the answer can be moved directly into project operations notes.',
  promptPresetDailyReviewLabel: 'Daily review',
  promptPresetDailyReviewInstruction:
    'Use the user records to suggest observations, patterns, reflection questions, and next experiments while avoiding over-interpretation.',
  promptPresetWritingDraftLabel: 'Writing draft',
  promptPresetWritingDraftInstruction:
    'Respect the vault’s existing voice and arguments while proposing drafts, outlines, paragraph flow, and title candidates.',
  promptDefaultTitle: 'Obsidian knowledge work default',
  promptDefaultDescription:
    'Default system prompt for vault context, note links, and source-grounded answers',
  promptNewSystemPromptTitle: 'New system prompt',
  promptLegacyTitle: 'Previous user system prompt',
  promptLegacyDescription: 'Prompt imported from the existing systemPrompt setting',
  promptDirectionPresetLine: 'Direction preset: {label}\n{instruction}',
  promptAdditionalDirectionLine: 'Additional direction: {text}',
  promptGenerationSystemInstruction:
    'You are an expert at designing system prompts for Obsidian vaults. Output only the system prompt body, without explanation or preface.',
  promptGenerationUserIntro:
    'Using the following embedding index summary, write an English system prompt for this vault’s Chat tab.',
  promptGenerationRequirementsHeader: 'Requirements:',
  promptGenerationRequirementRole:
    '- Center the role on assisting Obsidian vault-based knowledge work.',
  promptGenerationRequirementContext:
    '- Instruct the assistant to prioritize Vault Context and explicit file/folder mentions.',
  promptGenerationRequirementEvidence:
    '- Separate evidence from inference, and do not invent unknown information.',
  promptGenerationRequirementLinks:
    '- Suggest related note names, link candidates, and next organization structures.',
  promptGenerationRequirementNoDefaultTasks:
    '- Do not make code review, translation, or simple summarization the default role.',
  promptGenerationRequirementLength: '- Write a practical system prompt within 900 characters.',
  promptNoEmbeddedVaultEntries: 'No embedded vault entries.',
  promptSummaryTotalChunks: 'Total chunks: {count}',
  promptSummaryTopFolders: '[Top folders]',
  promptSummaryTopFiles: '[Top files]',
  promptSummaryTopHeadings: '[Top headings]',
  promptSummaryRepresentativeSamples: '[Representative chunk samples]',
  promptSummaryNone: '- None',
  contextRuleNoSourceOutsideVault: 'Do not cite document names that are absent from Vault Context.',
  contextRuleSeparateSuggestions:
    'Separate new note suggestions from sources and mark them as "Suggestions".',
  contextRuleNoEvidence: 'If evidence is insufficient, say that relevant documents were not found.',
  contextAutoRagDetail: 'Auto RAG {count}',
  contextImplicitFolderDetail: '{count} automatically referenced from {name}',
  contextImplicitFolderNoMatch: 'No document in {name} directly matched this question.',
  contextImplicitFolderReason: 'Checked relevant source files in the mentioned {name} folder.',
  contextRejectedCandidatesExcluded: 'Excluded {count} validation-failed candidates from context.',
  contextNoRelevantDocs: 'No relevant documents met the similarity threshold.',
  contextRagLoadFailed: 'Unable to load RAG context: {error}',
  contextAutoRagTitle: 'Related notes',
  contextAutoRagReasonNoMentions: 'Automatically searched nearby vault notes for this question.',
  contextAutoRagReasonServerOnly:
    'Only @server was mentioned, so vault auto-search was skipped. Mention a file or folder if vault notes are also needed.',
  contextAutoRagReasonServerAndVault:
    '@server and vault mentions were both present, so external tools and vault notes were prepared together.',
  contextAutoRagReasonVaultMention:
    'Searched related notes around the mentioned vault file or folder.',
  contextAutoRagReasonImplicit: 'Automatically searched vault notes for this turn.',
  contextAutoRagReasonDisabled: 'Auto RAG is disabled for this turn.',
  contextDiagnosticProviderSummary: '{provider} {status}/{readiness} {count}',
  contextDiagnosticRerankerSummary: 'reranker {status} {count}',
  contextRerankStatusApplied: 'applied',
  contextRerankStatusEmpty: 'no returned order',
  contextRerankStatusInvalidJson: 'response format mismatch',
  contextRerankStatusError: 'failed',
  contextSearchDiagnostic: 'Search diagnostics: {summary}',
  contextFileMissing: 'File does not exist in the vault.',
  contextLegacyIndexNeedsReindex: 'This is an older index format and needs reindexing.',
  contextFileModified: 'The file changed since the last indexing run.',
  contextHashChanged: 'The file content hash changed since the last indexing run.',
  contextLineMismatch: 'The chunk line range does not match the current file.',
  contextUnsupportedGraphRagSource: 'Unsupported GraphRAG source.',
  contextPartialBudget: 'Only part of this was attached because of the context budget.',
  contextFolderNotFound: 'Folder not found.',
  contextFolderAttachedLimited: 'Attached up to {count} files within the context budget.',
  contextFolderPartialMaxFiles: 'The folder has many files, so only {count} were attached.',
  contextFolderPartialBudget: 'Only part of the folder was attached to fit the context budget.',
  contextFolderPartialReadError:
    'Only part of the folder was attached because {count} files could not be read.',
  contextMcpDisconnected: 'MCP server is not connected.',
  contextMcpNoTools: '(no available tools)',
  contextMcpServerBlock:
    '[MCP Server: {name}]\nAvailable tools:\n{tools}\n\nInstruction: The user explicitly mentioned this server as @{name}. If the question needs current information, search, or external data, call the tools above and use the tool results as evidence for the final answer. Include source links when answering from search results.',
  contextGraphRagEntitiesTitle: 'GraphRAG entities',
  contextGraphRagEntityNotFound: 'Mentioned entities were not found in the knowledge graph.',
  contextGraphRagEntitiesDetail: 'GraphRAG {count} entities',
  contextGraphRagRelationsDetail: '{count} relation records were attached.',
  contextGraphContributionTitle: 'Connected evidence',
  contextGraphContributionDetail: '{count} sources were strengthened by connections across notes.',
  graphRagViewMinConfidence: 'Minimum confidence:',
  graphRagViewTabCommunities: 'Communities',
  graphRagViewTabRejected: 'Rejected',
  graphRagViewLoadMore: 'Show {count} more',
  graphRagViewNoSearchResults: 'No search results.',
  graphRagViewBackToList: '← Back to list',
  graphRagViewAliases: 'Aliases: ',
  graphRagViewConfidence: 'Confidence: {percent}%',
  graphRagViewRelationsCount: 'Relations ({count})',
  graphRagViewEvidenceCount: 'Evidence ({count})',
  graphRagViewNoCommunities: 'No communities. Run GraphRAG indexing and then build communities.',
  graphRagViewNoRejectedFacts: 'No rejected facts.',
  graphRagViewPendingMerges: '{count} possible duplicates need review',
  graphRagViewPendingMergesDescription:
    'These items may refer to the same subject. Once decided, the same pair will not be shown again.',
  graphRagViewPendingMergeConfidence: '{percent}% similarity',
  graphRagViewMergeEntities: 'Merge as one',
  graphRagViewKeepEntitiesSeparate: 'Keep separate',
  graphRagViewPendingMergeUnavailable: 'This candidate was already handled or no longer exists.',
  graphRagViewRawResponse: 'Raw response: {preview}',
  graphRagViewDetails: 'Details',
  graphRagViewCopyDetails: 'Copy details',
  graphRagViewCopyResponse: 'Copy response',
  graphRagViewRawCopied: 'Copied GraphRAG raw response.',
  graphRagViewRetry: 'Retry',
  graphRagViewProcessing: 'Processing...',
  graphRagViewRetryFailed: 'GraphRAG retry failed: {message}',
  graphRagViewErrorCopied: 'Copied GraphRAG error details.',
  graphRagViewCopyFailed: 'Copy failed: {message}',
  graphRagViewIndexingProgress: 'Indexing: {done}/{total} files processed ({percent}%)',
  promptLibraryTitle: 'Prompt library',
  closeLabel: 'Close',
  settingsSaveMcpReconnectFailed: 'Settings saved, but {count} MCP server reconnects failed',
  manualPromptDescription: 'Manually written prompt',
  promptDeleteConfirm: 'Delete the "{title}" prompt?',
  promptBodyRequired: 'Enter the system prompt body.',
  promptSavedNotice: 'Prompt saved.',
  promptAppliedToSessionNotice: 'Applied "{title}" to the current session.',
  promptSetGlobalDefaultNotice: 'Set "{title}" as the global default.',
  promptGenerationModelRequired: 'Select a model for prompt generation.',
  promptRagStoreMissing:
    'RAG vector store is not initialized. Check RAG settings and indexing status.',
  generating: 'Generating...',
  promptNoEmbeddedVaultInfo: 'No embedded vault information. Run RAG indexing first.',
  promptEmptyModelResponse: 'The model returned an empty prompt.',
  vaultBasedPromptTitle: 'Vault-based prompt - {preset}',
  customLabel: 'Custom',
  generatedPromptDescription: 'System prompt generated from embedded vault information',
  vaultBasedPromptGeneratedNotice:
    'Generated a vault-based system prompt and saved it to the library.',
  promptGenerationFailed: 'Prompt generation failed: {message}',
  vaultBasedGeneration: 'Vault-based generation',
  newPromptButton: 'New prompt',
  promptEmptyState: 'No prompts.',
  titleLabel: 'Title',
  descriptionLabel: 'Description',
  applyToCurrentSession: 'Apply to current session',
  globalDefault: 'Global default',
  setGlobalDefault: 'Set as global default',
  deleteLabel: 'Delete',
  embeddedVaultGenerateTitle: 'Generate from embedded vault information',
  promptDirectionPlaceholder:
    'Add response attitude, tone, behaviors to avoid, or note-linking style.',
  promptSourceDefault: 'Default',
  promptSourceGenerated: 'Vault generated',
  promptSourceUser: 'User',
  cmdOpenAiChat: 'Open AI Chat',
  cmdReindexVault: 'Reindex Vault for RAG',
  cmdOpenGraphRagView: 'Open GraphRAG Explorer',
  cmdOpenAgentDiagnosticsView: 'Open Agent Diagnostics',
  graphRagViewTabTitle: 'GraphRAG Explorer',
  graphRagViewTabEntities: 'Entities',
  graphRagViewTabRelations: 'Relations',
  graphRagViewTabEvidence: 'Evidence',
  graphRagViewEmpty: 'No extracted data. Run GraphRAG indexing first.',
  graphRagViewSearchPlaceholder: 'Search...',
};

const STRINGS: Record<Language, I18nKeys> = { ko, en };

let currentLang: Language = 'ko';

/**
 * Set the global UI language.
 */
export function setLanguage(lang: Language): void {
  currentLang = lang;
}

/**
 * Get the current UI language.
 */
export function getLanguage(): Language {
  return currentLang;
}

/**
 * Translate a key into the current language.
 * Supports simple interpolation with {key} placeholders.
 */
export function t<K extends keyof I18nKeys>(
  key: K,
  vars?: Record<string, string | number>,
): string {
  let text = STRINGS[currentLang][key] ?? STRINGS['en'][key] ?? String(key);
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return text;
}

/**
 * Get all available languages as dropdown options.
 */
export function getLanguageOptions(): { value: Language; label: string }[] {
  return [
    { value: 'ko', label: t('langKo') },
    { value: 'en', label: t('langEn') },
  ];
}
