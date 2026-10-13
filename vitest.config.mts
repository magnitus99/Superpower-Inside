import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/.test-vault/**', '**/.agents/**'],
    setupFiles: ['./src/test/setup.ts'],
    // 전체 스위트를 병렬 실행하면 무거운 통합·서브프로세스 테스트가 기본 5초를 넘깁니다.
    // 단정은 그대로 두고 실제 실행 예산만 넉넉히 잡습니다.
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
