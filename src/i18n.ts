export type Language = 'ko' | 'en';

export interface I18nKeys {
  // General Tab
  autoSaveSettings: string;
  autoSaveSettingsDesc: string;
  autoSaveDelay: string;
  autoSaveDelayDesc: string;
  delayMs: string;
  defaultModel: string;
  defaultModelDesc: string;
  noModelsEnabled: string;
  pluginAwareGeneration: string;
  pluginAwareGenerationDesc: string;
  language: string;
  languageDesc: string;
  langKo: string;
  langEn: string;
  languageChangeConfirm: string;

  // Providers Tab
  apiKey: string;
  baseUrl: string;
  validateApiKey: string;
  valid: string;
  modelsFound: string;
  invalid: string;
  error: string;
  noModelsFound: string;
  enabled: string;

  // RAG Tab
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

  // RAG Stats
  indexStats: string;
  totalFiles: string;
  totalFilesDesc: string;
  indexedFiles: string;
  indexedFilesDesc: string;
  pendingFiles: string;
  pendingFilesDesc: string;
  totalVectors: string;
  totalVectorsDesc: string;
  refresh: string;
  loadStatsFailed: string;
  enableProviderFirst: string;
  enterApiKeyFirst: string;
  selectAndSaveModel: string;
  enterModelId: string;
  connectionFailedGeneric: string;

  // RAG Controls
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

  // RAG Options
  autoUpdate: string;
  autoUpdateDesc: string;
  autoUpdateInterval: string;
  autoUpdateIntervalDesc: string;
  intervalSeconds: string;
  excludePaths: string;
  excludePathsDesc: string;
  excludeExts: string;
  excludeExtsDesc: string;
  chunkSize: string;
  chunkSizeDesc: string;
  vectorStoreType: string;
  vectorStoreTypeDesc: string;
  jsonFile: string;
  indexedDB: string;

  // Chat Tab
  chatSaveFolder: string;
  chatSaveFolderDesc: string;

  // MCP PATH
  mcpPathTitle: string;
  mcpPathDesc: string;
  mcpPathFetch: string;
  mcpPathFetching: string;
  mcpPathFetchSuccess: string;
  mcpPathFetchError: string;
  mcpPathPlaceholder: string;

  // MCP Tab
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

  // Settings Header
  settingsTitle: string;
  securityWarning: string;

  // Tabs
  tabGeneral: string;
  tabProviders: string;
  tabRag: string;
  tabChat: string;
  tabMcp: string;
  tabAdvanced: string;

  // Commands
  cmdOpenAiChat: string;
  cmdReindexVault: string;
  cmdExecuteAiDirective: string;
  noDirectiveFound: string;
}

const ko: I18nKeys = {
  // General
  autoSaveSettings: '설정 자동 저장',
  autoSaveSettingsDesc: '변경 사항 후 자동으로 설정 저장 (디스크 I/O 감소)',
  autoSaveDelay: '설정 변경 자동 저장 딜레이',
  autoSaveDelayDesc: '설정 값을 변경한 후 자동으로 저장되기까지 대기 시간 (0–5000 ms)',
  delayMs: 'ms',
  defaultModel: '기본 모델',
  defaultModelDesc: '채팅 및 명령어에 사용할 기본 모델',
  noModelsEnabled: '활성화된 모델 없음',
  pluginAwareGeneration: '플러그인 인식 생성 활성화',
  pluginAwareGenerationDesc: 'LLM 프롬프트에 활성 플러그인 목록을 포함하여 호환 문법을 유도합니다. (비공식 API 사용)',
  language: '언어',
  languageDesc: '플러그인 전체 UI 언어를 선택합니다',
  langKo: '한국어',
  langEn: 'English',
  languageChangeConfirm: '언어를 변경하시겠습니까? 변경 사항을 적용하려면 Obsidian을 다시 로드해야 합니다.',

  // Providers
  apiKey: 'API 키',
  baseUrl: 'Base URL',
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
  totalFilesDesc: '볼트 내 마크다운 파일 수',
  indexedFiles: '인덱싱 완료',
  indexedFilesDesc: '임베딩 처리된 파일 수',
  pendingFiles: '대기 중',
  pendingFilesDesc: '아직 인덱싱되지 않은 파일 수',
  totalVectors: '전체 벡터',
  totalVectorsDesc: '저장된 임베딩 벡터 개수',
  refresh: '새로고침',
  loadStatsFailed: '통계를 불러올 수 없습니다.',
  enableProviderFirst: 'Providers 탭에서 "{provider}"의 Enabled 토글을 켜주세요.',
  enterApiKeyFirst: 'Providers 탭에서 "{provider}"의 API Key를 입력하세요.',
  selectAndSaveModel: '임베딩 모델이 선택되지 않았습니다. Embedding Provider 섹션에서 모델을 선택하고 "저장" 버튼을 클릭하세요.',
  enterModelId: '임베딩 모델 ID를 직접 입력하고 "저장" 버튼을 클릭하세요.',
  connectionFailedGeneric: '프로바이더 "{provider}"({model}) 연결에 실패했습니다. Base URL이나 API Key를 확인하세요.',

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

  // RAG Options
  autoUpdate: '자동 업데이트',
  autoUpdateDesc: '설정된 간격으로 새 파일을 자동으로 인덱싱합니다',
  autoUpdateInterval: '자동 업데이트 간격',
  autoUpdateIntervalDesc: '자동 인덱싱 간격 (1초 – 60초)',
  intervalSeconds: '초',
  excludePaths: '제외할 경로',
  excludePathsDesc: '인덱싱에서 제외할 폴더 (쉼표로 구분)',
  excludeExts: '제외할 확장자',
  excludeExtsDesc: '인덱싱에서 제외할 파일 확장자 (쉼표로 구분, 점 제외)',
  chunkSize: '청크 크기',
  chunkSizeDesc: '마크다운 청크당 최대 문자 수',
  vectorStoreType: '벡터 저장소 유형',
  vectorStoreTypeDesc:
    'JSON File은 볼트 안의 JSON 파일에 저장되어 Obsidian Sync/Git 등으로 동기화됩니다. IndexedDB는 브라우저 로컬 데이터베이스에 저장되며, 큰 임베딩 데이터에서 더 빠르고 효율적이지만 수동 백업 없이는 동기화되지 않습니다.',
  jsonFile: 'JSON File',
  indexedDB: 'IndexedDB',

  // Chat
  chatSaveFolder: '채팅 저장 폴더',
  chatSaveFolderDesc: '대화를 저장할 볼트 내 폴더 경로',

  // MCP PATH
  mcpPathTitle: 'MCP PATH 환경변수',
  mcpPathDesc: 'MCP 서버 실행 시 사용할 PATH 값을 설정합니다. 비워두면 기본 PATH를 사용합니다.',
  mcpPathFetch: '터미널에서 PATH 불러오기',
  mcpPathFetching: '불러오는 중...',
  mcpPathFetchSuccess: '터미널 PATH 불러오기 완료',
  mcpPathFetchError: '터미널 PATH 불러오기 실패',
  mcpPathPlaceholder: '예: /opt/homebrew/bin:/usr/local/bin:/usr/bin',

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

  // Settings Header
  settingsTitle: 'Super Obsidian by AI — 설정',
  securityWarning: '경고: API 키는 data.json에 평문으로 저장됩니다. 민감 정보 노출에 주의하세요.',

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
  cmdExecuteAiDirective: 'AI 지시어 실행',
  noDirectiveFound: '현재 줄에서 AI 지시어를 찾을 수 없습니다.',
};

const en: I18nKeys = {
  // General
  autoSaveSettings: 'Auto-save settings',
  autoSaveSettingsDesc: 'Automatically save settings after changes (reduces disk I/O)',
  autoSaveDelay: 'Settings auto-save delay',
  autoSaveDelayDesc: 'Milliseconds to wait after changing a setting value before auto-saving (0–5000 ms)',
  delayMs: 'ms',
  defaultModel: 'Default Model',
  defaultModelDesc: 'Default model for chat and commands',
  noModelsEnabled: 'No models enabled',
  pluginAwareGeneration: 'Enable Plugin-Aware Generation',
  pluginAwareGenerationDesc: 'Include active plugin list in LLM prompts to encourage compatible syntax. (Uses unofficial API)',
  language: 'Language',
  languageDesc: 'Select the plugin UI language',
  langKo: 'Korean',
  langEn: 'English',
  languageChangeConfirm: 'Are you sure you want to change the language? Obsidian must be reloaded to apply the changes.',

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
  totalFilesDesc: 'Markdown files in vault',
  indexedFiles: 'Indexed',
  indexedFilesDesc: 'Files with embeddings',
  pendingFiles: 'Pending',
  pendingFilesDesc: 'Files not yet indexed',
  totalVectors: 'Total Vectors',
  totalVectorsDesc: 'Stored embedding vectors',
  refresh: 'Refresh',
  loadStatsFailed: 'Unable to load statistics.',
  enableProviderFirst: 'Please enable "{provider}" in the Providers tab.',
  enterApiKeyFirst: 'Please enter the API Key for "{provider}" in the Providers tab.',
  selectAndSaveModel: 'Embedding model not selected. Please select a model in the Embedding Provider section and click "Save".',
  enterModelId: 'Please enter the embedding model ID and click "Save".',
  connectionFailedGeneric: 'Failed to connect to provider "{provider}" ({model}). Please check Base URL or API Key.',

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

  // RAG Options
  autoUpdate: 'Auto Update',
  autoUpdateDesc: 'Automatically index new files at the set interval',
  autoUpdateInterval: 'Auto-update Interval',
  autoUpdateIntervalDesc: 'Automatic indexing interval (1–60 seconds)',
  intervalSeconds: 'seconds',
  excludePaths: 'Exclude Paths',
  excludePathsDesc: 'Folders to exclude from indexing (comma-separated)',
  excludeExts: 'Exclude Extensions',
  excludeExtsDesc: 'File extensions to exclude (comma-separated, no dot)',
  chunkSize: 'Chunk Size',
  chunkSizeDesc: 'Maximum characters per markdown chunk',
  vectorStoreType: 'Vector Store Type',
  vectorStoreTypeDesc:
    'JSON File stores in vault JSON, syncable via Obsidian Sync/Git. IndexedDB stores in browser local DB, faster for large embeddings but not auto-synced without manual backup.',
  jsonFile: 'JSON File',
  indexedDB: 'IndexedDB',

  // Chat
  chatSaveFolder: 'Chat Save Folder',
  chatSaveFolderDesc: 'Vault folder path to save conversations',

  // MCP PATH
  mcpPathTitle: 'MCP PATH Environment Variable',
  mcpPathDesc: 'Set the PATH value used when running MCP servers. Leave empty to use the default PATH.',
  mcpPathFetch: 'Fetch PATH from Terminal',
  mcpPathFetching: 'Fetching...',
  mcpPathFetchSuccess: 'Terminal PATH fetched successfully',
  mcpPathFetchError: 'Failed to fetch terminal PATH',
  mcpPathPlaceholder: 'e.g., /usr/local/bin:/usr/bin:/bin',

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

  // Settings Header
  settingsTitle: 'Super Obsidian by AI — Settings',
  securityWarning: 'Warning: API keys are stored in plain text in data.json. Be aware of sensitive information exposure.',

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
  cmdExecuteAiDirective: 'Execute AI Directive',
  noDirectiveFound: 'No AI directive found on the current line.',
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
export function t<K extends keyof I18nKeys>(key: K, vars?: Record<string, string | number>): string {
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
