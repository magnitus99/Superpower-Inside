import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/.sisyphus/**', '**/.test-vault/**'],
    setupFiles: ['./src/test/setup.ts'],
  },
});
