import { defineConfig, devices } from '@playwright/test';

// Navigation performance harness (docs/NAVIGATION_PERFORMANCE.md). Not part of the E2E suite (`*.perf.ts` does not
// match the main config's `*.spec.ts`). Run from frontend/:
//   PERF_MODE=dev  pnpm exec playwright test -c e2e/perf/perf.config.ts
//   PERF_MODE=prod pnpm exec playwright test -c e2e/perf/perf.config.ts   (needs `NEXT_DIST_DIR=.next-perf next build`
//                                                                         with the E2E NEXT_PUBLIC_* env, see setup.ts)
// Results are written as JSON to PERF_OUT (default e2e/perf/.results/<mode>.json).
export default defineConfig({
  testDir: '.',
  testMatch: /.*\.perf\.ts/,
  globalSetup: './setup.ts',
  globalTeardown: '../global-teardown.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 1_800_000,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:3100', ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
});
