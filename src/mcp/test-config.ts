import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { MCPServerConfig, ProviderConfig, SuperObsidianSettings } from '../settings';

export interface LiveMcpTestConfig {
  source: 'data.json' | '.env.test.local' | 'environment';
  defaultModel: string;
  providers: Partial<Record<keyof SuperObsidianSettings, ProviderConfig>>;
  mcpServers: MCPServerConfig[];
  mcpPath: string;
}

interface RawTestConfig {
  chat?: { defaultModel?: unknown };
  mcpServers?: unknown;
  mcpPath?: unknown;
  openai?: unknown;
  claude?: unknown;
  ollama?: unknown;
  ollamaCloud?: unknown;
  openRouter?: unknown;
}

export function loadLiveMcpTestConfig(cwd = process.cwd()): LiveMcpTestConfig | null {
  const dataPath = path.join(cwd, 'data.json');
  if (existsSync(dataPath)) {
    return fromRawConfig(readJsonFile(dataPath), 'data.json');
  }

  const envPath = path.join(cwd, '.env.test.local');
  if (existsSync(envPath)) {
    const env = { ...process.env, ...parseEnvFile(readFileSync(envPath, 'utf8')) };
    return fromEnv(env, '.env.test.local');
  }

  return fromEnv(process.env, 'environment');
}

function fromRawConfig(raw: RawTestConfig, source: LiveMcpTestConfig['source']): LiveMcpTestConfig {
  return {
    source,
    defaultModel: typeof raw.chat?.defaultModel === 'string' ? raw.chat.defaultModel : '',
    providers: {
      openai: toProviderConfig(raw.openai),
      claude: toProviderConfig(raw.claude),
      ollama: toProviderConfig(raw.ollama),
      ollamaCloud: toProviderConfig(raw.ollamaCloud),
      openRouter: toProviderConfig(raw.openRouter),
    },
    mcpServers: Array.isArray(raw.mcpServers) ? raw.mcpServers.flatMap(toMcpServerConfig) : [],
    mcpPath: typeof raw.mcpPath === 'string' ? raw.mcpPath : '',
  };
}

function fromEnv(
  env: NodeJS.ProcessEnv,
  source: LiveMcpTestConfig['source'],
): LiveMcpTestConfig | null {
  const serversJson = env.MCP_TEST_SERVERS_JSON;
  if (!serversJson) return null;

  const rawServers = JSON.parse(serversJson) as unknown;
  return {
    source,
    defaultModel: env.MCP_TEST_DEFAULT_MODEL ?? '',
    providers: {},
    mcpServers: Array.isArray(rawServers) ? rawServers.flatMap(toMcpServerConfig) : [],
    mcpPath: env.MCP_TEST_MCP_PATH ?? env.PATH ?? '',
  };
}

function readJsonFile(filePath: string): RawTestConfig {
  return JSON.parse(readFileSync(filePath, 'utf8')) as RawTestConfig;
}

function parseEnvFile(content: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const equalsIndex = trimmed.indexOf('=');
    if (equalsIndex === -1) continue;
    const key = trimmed.slice(0, equalsIndex).trim();
    const value = trimmed.slice(equalsIndex + 1).trim();
    env[key] = stripEnvQuotes(value);
  }
  return env;
}

function stripEnvQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function toProviderConfig(value: unknown): ProviderConfig | undefined {
  if (!isRecord(value)) return undefined;
  const models = Array.isArray(value.models)
    ? value.models.filter((model): model is string => typeof model === 'string')
    : [];
  return {
    apiKey: typeof value.apiKey === 'string' ? value.apiKey : '',
    baseUrl: typeof value.baseUrl === 'string' ? value.baseUrl : undefined,
    models,
    enabled: value.enabled === true,
  };
}

function toMcpServerConfig(value: unknown): MCPServerConfig[] {
  if (!isRecord(value)) return [];
  if (typeof value.name !== 'string' || typeof value.command !== 'string') return [];
  return [
    {
      name: value.name,
      command: value.command,
      args: Array.isArray(value.args)
        ? value.args.filter((arg): arg is string => typeof arg === 'string')
        : undefined,
      env: isStringRecord(value.env) ? value.env : undefined,
    },
  ];
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isRecord(value)) return false;
  return Object.values(value).every((item) => typeof item === 'string');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
