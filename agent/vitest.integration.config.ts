import { defineConfig } from 'vitest/config';

// Needs a running Anvil with the local deployment (docs/11 §5). Run: pnpm --filter @runwaymind/agent test:integration
export default defineConfig({
  test: {
    include: ['test/integration/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    fileParallelism: false,
  },
});
