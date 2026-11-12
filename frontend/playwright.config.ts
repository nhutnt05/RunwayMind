import { defineConfig, devices } from '@playwright/test';

// docs/10 §6: Playwright against Anvil + deployed fixture + backend + frontend (see e2e/stack.ts). Specs share one
// chain, so they run serially in a fixed order.
export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.ts/,
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3100',
    ...devices['Desktop Chrome'],
    trace: 'retain-on-failure',
  },
});
