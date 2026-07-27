import { describe, expect, it } from 'vitest';

import { resolveSettingsLoadData } from './settings-storage';

describe('resolveSettingsLoadData', () => {
  it('data.json의 RAG 운영 설정이 localStorage보다 최신이면 RAG 값을 data.json에서 가져온다', () => {
    const localRaw = {
      language: 'ko',
      rag: {
        excludePaths: ['**/.git', '**/node_modules', '**/.obsidian'],
        autoUpdateEnabled: true,
        enableBM25: true,
        graphRagEnabled: false,
        graphRagAutoSyncEnabled: false,
      },
      mcpServers: [{ name: 'context7', command: 'npx', args: ['-y', '@upstash/context7-mcp'] }],
    };
    const legacyRaw = {
      language: 'ko',
      rag: {
        excludePaths: [
          '**/.git',
          '**/node_modules',
          '**/.obsidian',
          '**/.venv',
          '**/__pycache__',
        ],
        autoUpdateEnabled: false,
        enableBM25: false,
        graphRagEnabled: false,
        graphRagAutoSyncEnabled: false,
      },
      mcpServers: [],
    };

    const result = resolveSettingsLoadData(localRaw, legacyRaw);

    expect(result.migratedFromLegacyData).toBe(false);
    expect(result.raw.rag).toMatchObject({
      excludePaths: [
        '**/.git',
        '**/node_modules',
        '**/.obsidian',
        '**/.venv',
        '**/__pycache__',
      ],
      autoUpdateEnabled: false,
      enableBM25: false,
    });
    expect(result.raw.mcpServers).toEqual([]);
  });

  it('localStorage만 있으면 localStorage 값을 그대로 사용한다', () => {
    const localRaw = {
      rag: {
        autoUpdateEnabled: true,
        enableBM25: true,
      },
    };

    const result = resolveSettingsLoadData(localRaw, null);

    expect(result).toEqual({ raw: localRaw, migratedFromLegacyData: false });
  });

  it('localStorage가 없으면 data.json을 legacy source로 사용한다', () => {
    const legacyRaw = {
      rag: {
        autoUpdateEnabled: false,
        enableBM25: false,
      },
    };

    const result = resolveSettingsLoadData(null, legacyRaw);

    expect(result).toEqual({ raw: legacyRaw, migratedFromLegacyData: true });
  });
});
