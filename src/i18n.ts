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

  // RAG 탭
  embeddingProvider: string;
  embeddingProviderDesc: string;
  embeddingModel: string;
  embeddingModelDesc: string;
  embeddingModelId: string;
  embeddingModelIdDesc: string;
  save: string;
  cancel: string;
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
  excludeExtMarkdownWarning: string;
  chunkSize: string;
  chunkSizeDesc: string;
  ragChunkSizeOllamaWarning: string;
  ollamaEmbeddingContextError: string;
  vectorStoreType: string;
  vectorStoreTypeDesc: string;
  jsonFile: string;
  indexedDB: string;
  minScore: string;
  minScoreDesc: string;
  enableBM25: string;
  enableBM25Desc: string;
  bm25Weight: string;
  bm25WeightDesc: string;
  bm25Guidance: string;

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
  mcpRefreshing: string;
  mcpConnecting: string;
  mcpPartialError: string;
  mcpNoActiveServers: string;
  mcpActiveServers: string;
  quickPresetGeneral: string;
  quickPresetCodeReview: string;
  quickPresetTranslate: string;
  quickPresetSummarize: string;

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
  tabRag: string;
  tabChat: string;
  tabMcp: string;
  tabAdvanced: string;

  // 명령어
  cmdOpenAiChat: string;
  cmdReindexVault: string;
}

const ko: I18nKeys = {
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

  // RAG
  embeddingProvider: '임베딩 프로바이더',
  embeddingProviderDesc: '임베딩에 사용할 프로바이더를 선택하세요',
  embeddingModel: '임베딩 모델',
  embeddingModelDesc: '사용할 임베딩 모델을 선택하세요',
  embeddingModelId: '모델 ID',
  embeddingModelIdDesc: '임베딩 모델 ID를 직접 입력하세요',
  save: '저장',
  cancel: '취소',
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
  excludePathMissingWarning: '현재 볼트에서 찾을 수 없습니다. 패턴이라면 그대로 저장할 수 있습니다.',
  excludeExtLeadingDot: '앞의 점은 저장 시 제거됩니다.',
  excludeExtInvalid: '확장자는 영문/숫자/하이픈/밑줄만 입력하세요.',
  excludeExtMarkdownWarning: 'md를 제외하면 마크다운 노트가 인덱싱되지 않습니다.',
  excludeChatFolder: '채팅 저장 폴더 RAG 제외',
  excludeChatFolderDesc: '채팅 저장 폴더를 RAG 인덱싱 대상에서 자동으로 제외합니다',
  chunkSize: '청크 크기',
  chunkSizeDesc: '문서 청크당 최대 문자 수 (100~5000)',
  ragChunkSizeOllamaWarning: 'Ollama 로컬 임베딩 모델 중 일부는 컨텍스트 길이 제한이 작습니다. 400 오류가 발생하면 이 값을 500 이하로 줄여보세요.',
  ollamaEmbeddingContextError: 'Ollama 임베딩 모델의 최대 컨텍스트 길이를 초과했습니다. 설정 > RAG > 청크 크기(chunkSize)를 줄이고 다시 인덱싱해보세요.',
  vectorStoreType: '벡터 저장소 유형',
  vectorStoreTypeDesc:
    'JSON File은 볼트 내부 JSON 파일에 저장되어 동기화/백업이 쉽지만 대용량 벡터에서는 파일 쓰기와 충돌 부담이 큽니다. IndexedDB는 로컬 브라우저 DB라 대용량 구조화 데이터에 적합하지만 장치별 로컬 데이터라 자동 동기화되지 않습니다.',
  jsonFile: 'JSON File',
  indexedDB: 'IndexedDB',
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

  // Chat
  chatTabTitle: 'AI 채팅',
  toolbarTools: '🔧 도구',
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
  chatScrollToBottom: '맨 아래로',
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
  mcpMentionServers: 'MCP 서버',
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
  mcpRefreshing: '재연결 중...',
  mcpConnecting: 'MCP 연결 중...',
  mcpPartialError: '일부 MCP 서버 실패',
  mcpNoActiveServers: '활성 MCP 서버 없음',
  mcpActiveServers: '활성 {count} / 전체 {total}',
  quickPresetGeneral: '일반',
  quickPresetCodeReview: '코드 리뷰',
  quickPresetTranslate: '번역',
  quickPresetSummarize: '요약',

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
    '경고: 설정과 API 키는 이 기기의 Obsidian 로컬 저장소에 저장되며 볼트 동기화 대상 data.json에는 새로 저장하지 않습니다. 민감 정보 노출에 주의하세요.',

  // Tabs
  tabGeneral: '일반',
  tabProviders: '프로바이더',
  tabRag: 'RAG',
  tabChat: '채팅',
  tabMcp: 'MCP',
  tabAdvanced: '고급',

  // Commands
  cmdOpenAiChat: 'AI 채팅 열기',
  cmdReindexVault: '볼트 RAG 재인덱싱',
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

  // RAG
  embeddingProvider: 'Embedding Provider',
  embeddingProviderDesc: 'Select the provider for embeddings',
  embeddingModel: 'Embedding Model',
  embeddingModelDesc: 'Choose the embedding model to use',
  embeddingModelId: 'Model ID',
  embeddingModelIdDesc: 'Enter the embedding model ID directly',
  save: 'Save',
  cancel: 'Cancel',
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
  excludeExtMarkdownWarning: 'Excluding md prevents markdown notes from being indexed.',
  excludeChatFolder: 'Exclude Chat Folder from RAG',
  excludeChatFolderDesc: 'Automatically exclude the chat save folder from RAG indexing',
  chunkSize: 'Chunk Size',
  chunkSizeDesc: 'Maximum characters per document chunk (100–5000)',
  ragChunkSizeOllamaWarning: 'Some Ollama local embedding models have small context limits. If you get a 400 error, try reducing this value to 500 or less.',
  ollamaEmbeddingContextError: 'The input exceeds the maximum context length of the Ollama embedding model. Go to Settings > RAG > Chunk size and lower it, then reindex.',
  vectorStoreType: 'Vector Store Type',
  vectorStoreTypeDesc:
    'JSON File stores vectors in vault JSON, making sync and backups easy but large vector files can be slow and conflict-prone. IndexedDB stores vectors in the local browser DB, better for large structured data but device-local and not automatically synced.',
  jsonFile: 'JSON File',
  indexedDB: 'IndexedDB',
  minScore: 'Minimum Relevance Score',
  minScoreDesc:
    'Filter out embedding results below this threshold (0–1). Lower values include more results but may reduce quality.',
  enableBM25: 'Enable BM25 Keyword Search',
  enableBM25Desc:
    'Combine embedding similarity with BM25 keyword matching for hybrid search. Improves Korean text retrieval accuracy.',
  bm25Weight: 'BM25 Weight',
  bm25WeightDesc:
    'Closer to 0 favors embedding similarity, closer to 1 favors keyword matching.',
  bm25Guidance:
    '💡 BM25 complements embedding search by adding keyword matching, which helps with Korean text where semantic embeddings alone may miss relevant terms. If RAG frequently returns irrelevant results, enable BM25 and adjust the weight.',

  // Chat
  chatTabTitle: 'AI Chat',
  toolbarTools: '🔧 Tools',
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
  chatScrollToBottom: 'Scroll to Bottom',
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
  mcpMentionServers: 'MCP Servers',
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
  mcpRefreshing: 'Reconnecting...',
  mcpConnecting: 'Connecting MCP...',
  mcpPartialError: 'Some MCP servers failed',
  mcpNoActiveServers: 'No active MCP servers',
  mcpActiveServers: 'Active {count} / Total {total}',
  quickPresetGeneral: 'General',
  quickPresetCodeReview: 'Code Review',
  quickPresetTranslate: 'Translate',
  quickPresetSummarize: 'Summarize',

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
    'Warning: settings and API keys are stored in this device’s Obsidian local storage and are no longer newly saved to synced data.json. Be aware of sensitive information exposure.',

  // Tabs
  tabGeneral: 'General',
  tabProviders: 'Providers',
  tabRag: 'RAG',
  tabChat: 'Chat',
  tabMcp: 'MCP',
  tabAdvanced: 'Advanced',

  // Commands
  cmdOpenAiChat: 'Open AI Chat',
  cmdReindexVault: 'Reindex Vault for RAG',
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
