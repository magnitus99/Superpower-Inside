import type { Vault, TFile, DataAdapter } from 'obsidian';
import type { RAGConfig, ChatConfig } from '../settings';

/**
 * 볼트에서 마크다운 파일 목록을 가져오되, 제외 패턴을 적용합니다.
 */
export function getMarkdownFilesFiltered(vault: Vault, excludePatterns: string[]): TFile[] {
  const allFiles = vault.getMarkdownFiles();
  return allFiles.filter((file) => !isExcluded(file.path, excludePatterns));
}

/**
 * 주어진 경로가 제외 패턴에 매칭되는지 확인합니다.
 * 패턴은 폴더 이름(정확 매칭) 또는 glob-like 패턴을 지원합니다.
 */
export function isExcluded(filePath: string, patterns: string[]): boolean {
  const lowerPath = filePath.toLowerCase();
  for (const pattern of patterns) {
    const p = pattern.trim().toLowerCase();
    if (!p) continue;
    // 정확한 폴더/파일명 매칭
    if (lowerPath.includes('/' + p + '/') || lowerPath.startsWith(p + '/')) {
      return true;
    }
    // 파일명 끝 매칭 (확장자 제외용)
    if (lowerPath.endsWith('.' + p)) {
      return true;
    }
    // 간단한 glob: **/pattern
    if (p.startsWith('**/')) {
      const rest = p.slice(3);
      if (lowerPath.includes(rest)) return true;
    }
  }
  return false;
}

/**
 * 파일 확장자가 제외 목록에 있는지 확인합니다.
 */
export function isExcludedExt(filePath: string, excludeExts: string[]): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return excludeExts.map((e) => e.toLowerCase()).includes(ext);
}

/**
 * Vault adapter를 통해 JSON 파일을 씁니다.
 * 상위 디렉토리가 없으면 자동으로 생성합니다.
 */
export async function writeJsonToVault(
  adapter: DataAdapter,
  path: string,
  data: unknown,
): Promise<void> {
  const dir = path.split('/').slice(0, -1).join('/');
  if (dir) {
    await adapter.mkdir(dir);
  }
  const json = JSON.stringify(data, null, 2);
  await adapter.write(path, json);
}

/**
 * Vault adapter를 통해 JSON 파일을 읽어 파싱합니다.
 * 파일이 없으면 null을 반환합니다.
 */
export async function readJsonFromVault(adapter: DataAdapter, path: string): Promise<unknown> {
  if (!(await adapter.exists(path))) {
    return null;
  }
  const raw = await adapter.read(path);
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export function getEffectiveExcludePaths(
  ragConfig: RAGConfig,
  chatConfig: ChatConfig,
): string[] {
  const paths = [...ragConfig.excludePaths];
  if (ragConfig.excludeChatFolder && chatConfig.saveFolder) {
    if (!paths.includes(chatConfig.saveFolder)) {
      paths.push(chatConfig.saveFolder);
    }
  }
  return paths;
}
