import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  findReusablePromptRust,
  isLocalSettingsProviderRust,
  isValidSettingsFolderRust,
  parseSettingsNumberRust,
} from './rag/rust-core';
import { validateMcpJson } from './utils/mcp-json';

const settings = readFileSync(resolve(__dirname, 'settings.ts'), 'utf8');
const prompt = readFileSync(resolve(__dirname, 'chat/prompt-library-modal.ts'), 'utf8');
const method = (start: string, end: string): string =>
  settings.slice(settings.indexOf(start), settings.indexOf(end, settings.indexOf(start)));

describe('설정창 전체 개선 회귀 계약', () => {
  it('실제 WASM 입력 검증은 빈 숫자·소수 정수·볼트 밖 경로를 거부한다', () => {
    expect(parseSettingsNumberRust('', 0, 1, false)).toBeNull();
    expect(parseSettingsNumberRust('1.5', 1, 10)).toBeNull();
    expect(parseSettingsNumberRust('0.85', 0, 1, false)).toBe(0.85);
    expect(isValidSettingsFolderRust('../outside')).toBe(false);
    expect(isValidSettingsFolderRust('채팅/기록')).toBe(true);
  });
  it('실제 WASM은 원격 Ollama와 로컬 호환 서버를 주소로 구별하고 기존 프롬프트를 재사용한다', () => {
    expect(isLocalSettingsProviderRust('ollama', 'https://remote.example')).toBe(false);
    expect(isLocalSettingsProviderRust('openAICompatible', 'http://localhost:8080/v1')).toBe(true);
    expect(isLocalSettingsProviderRust('openAICompatible', 'http://localhost.example/v1')).toBe(
      false,
    );
    expect(findReusablePromptRust([{ content: 'sample' }], 'sample')).toBe(0);
  });
  it('MCP 입력 검증은 실행할 수 없는 명령과 잘못된 인수·환경 변수를 거부한다', () => {
    for (const command of ['', 1])
      expect(validateMcpJson(JSON.stringify({ mcpServers: { sample: { command } } })).valid).toBe(
        false,
      );
    expect(validateMcpJson('{"mcpServers":{"sample":{"command":"npx","args":[1]}}}').valid).toBe(
      false,
    );
    expect(
      validateMcpJson('{"mcpServers":{"sample":{"command":"npx","env":{"token":1}}}}').valid,
    ).toBe(false);
  });
  it('MCP 편집은 적용을 누르기 전 서버를 재시작하지 않고 Tab을 가로채지 않는다', () => {
    const editor = method('private buildMCPTab(', 'private buildDetailedMcpError(');
    expect(editor).not.toContain('autoSaveTimeout');
    expect(editor).not.toContain("e.key === 'Tab'");
    expect(editor).toContain("t('settingsApplyServers')");
    expect(editor).toContain("'aria-label': t('settingsMcpJsonLabel')");
    expect(editor).toContain('this.mcpLintTimeout');
    expect(editor).toContain('draftRevision === this.mcpDraftRevision');
    expect(editor).toContain('if (this.mcpApplying) return');
  });
  it('JSON 구문 오류는 위치를 보존하고 접두어를 한 번만 표시한다', () => {
    const result = validateMcpJson('{"mcpServers":');
    expect(result.valid).toBe(false);
    expect(result.error?.match(/Invalid JSON:/g)).toHaveLength(1);
    expect(result.error).toMatch(/line|column/);
  });
  it('범위 입력에 슬라이더가 없으며 병합 기준의 개별 이름이 존재한다', () => {
    expect(settings).not.toContain('.addSlider(');
    expect(settings).toContain("t('settingsAutoMergeLabel')");
    expect(settings).toContain("t('settingsPendingMergeLabel')");
    expect(settings).toContain('parseSettingsNumberRust');
    expect(settings).toContain('private labelSettingsControls(');
  });
  it('일상 설정은 저장 상태와 재시도 버튼을 제공한다', () => {
    expect(settings).toContain('private renderSaveState(');
    expect(settings).toContain('if (!result.success)');
    expect(settings).toContain("t('settingsSaveRetry')");
    expect(settings).not.toContain("new Notice(t('autoSaveSuccessNotice'))");
  });
  it('프롬프트 편집 이탈은 미저장 변경을 확인하고 초점을 복원한다', () => {
    expect(prompt).toContain('confirmDiscardDraft');
    expect(prompt).toContain("t('settingsDiscardPromptDraft')");
    expect(prompt).toContain('previousFocus?.isConnected');
    expect(settings).toContain('superpower-inside-settings-block');
    expect(settings).toContain('findReusablePromptRust');
  });
  it('임베딩 전송 안내와 그래프 비용은 선택한 실제 연결을 사용한다', () => {
    expect(settings).toContain('isLocalSettingsProviderRust');
    expect(settings).toContain("t('settingsRemoteEmbeddingDetail')");
    expect(settings).not.toContain("rag.graphRagModel.trim().toLowerCase().startsWith('ollama:')");
  });
});
