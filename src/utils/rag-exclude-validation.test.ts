import { describe, expect, it } from 'vitest';
import {
  validateExcludeExtensionInput,
  validateExcludePathInput,
} from './rag-exclude-validation';

describe('RAG 제외 경로 검증', () => {
  it('앞뒤 공백을 제거하고 경고를 반환한다', () => {
    const result = validateExcludePathInput('  Archive  ', []);

    expect(result.normalized).toBe('Archive');
    expect(result.valid).toBe(true);
    expect(result.issues).toContainEqual({ level: 'warning', code: 'trimmed' });
  });

  it('중복 경로는 오류로 처리한다', () => {
    const result = validateExcludePathInput('archive', ['Archive']);

    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual({ level: 'error', code: 'duplicate' });
  });

  it('없는 경로는 저장 가능한 경고로 처리한다', () => {
    const result = validateExcludePathInput('Missing', [], () => false);

    expect(result.valid).toBe(true);
    expect(result.issues).toContainEqual({ level: 'warning', code: 'path-missing' });
  });

  it('쉼표, 역슬래시, 선행 슬래시는 오류로 처리한다', () => {
    const comma = validateExcludePathInput('a,b', []);
    const backslash = validateExcludePathInput('folder\\note', []);
    const leadingSlash = validateExcludePathInput('/folder', []);

    expect(comma.issues).toContainEqual({ level: 'error', code: 'comma' });
    expect(backslash.issues).toContainEqual({ level: 'error', code: 'path-backslash' });
    expect(leadingSlash.issues).toContainEqual({ level: 'error', code: 'path-leading-slash' });
  });
});

describe('RAG 제외 확장자 검증', () => {
  it('앞 점을 제거하고 소문자로 정규화한다', () => {
    const result = validateExcludeExtensionInput('.PDF', []);

    expect(result.normalized).toBe('pdf');
    expect(result.valid).toBe(true);
    expect(result.issues).toContainEqual({ level: 'warning', code: 'extension-leading-dot' });
  });

  it('잘못된 확장자와 쉼표 포함 입력을 오류로 처리한다', () => {
    const invalid = validateExcludeExtensionInput('tar.gz', []);
    const comma = validateExcludeExtensionInput('pdf,docx', []);

    expect(invalid.issues).toContainEqual({ level: 'error', code: 'extension-invalid' });
    expect(comma.issues).toContainEqual({ level: 'error', code: 'comma' });
  });

  it('md 제외는 저장 가능한 경고로 처리한다', () => {
    const result = validateExcludeExtensionInput('md', []);

    expect(result.valid).toBe(true);
    expect(result.issues).toContainEqual({ level: 'warning', code: 'extension-markdown' });
  });
});
