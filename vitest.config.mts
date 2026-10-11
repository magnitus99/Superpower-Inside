import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Windows의 프로세스 생성 경합으로 기존 테스트 제한 시간을 넘지 않도록 합니다.
    maxWorkers: process.platform === 'win32' ? 4 : undefined,
    exclude: ['**/node_modules/**', '**/.test-vault/**'],
    setupFiles: ['./src/test/setup.ts'],
  },
});
