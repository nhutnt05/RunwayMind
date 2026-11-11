import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['test/globalSetup.ts'],
    fileParallelism: false, // one SQLite test database
    testTimeout: 20_000,
  },
});
