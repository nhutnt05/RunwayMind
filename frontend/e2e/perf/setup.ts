import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { API_URL, FRONTEND, RPC_URL, STATE, WEB_PORT, WEB_URL, killTree, startStack, stopStack } from '../stack';

/**
 * Boots the E2E stack (Anvil 8547, backend 4100, `next dev` 3100). With PERF_MODE=prod the dev server is replaced by
 * `next start` on the same port (the backend's CORS origin) serving the production build in NEXT_DIST_DIR=.next-perf.
 */
export default async function setup(): Promise<void> {
  try {
    await startStack();
    if (process.env.PERF_MODE !== 'prod') return;
    const pidsFile = resolve(STATE, 'pids.json');
    const pids = JSON.parse(readFileSync(pidsFile, 'utf8')) as Record<string, number | undefined>;
    killTree(pids.frontend);
    await new Promise((r) => setTimeout(r, 2_000));
    if (!existsSync(resolve(FRONTEND, '.next-perf', 'BUILD_ID'))) throw new Error('missing production build in .next-perf');
    const child = spawn(process.execPath, [resolve(FRONTEND, 'node_modules', 'next', 'dist', 'bin', 'next'), 'start', '-p', String(WEB_PORT)], {
      cwd: FRONTEND,
      env: {
        ...process.env,
        NEXT_DIST_DIR: '.next-perf',
        NEXT_PUBLIC_E2E: 'true',
        NEXT_PUBLIC_CHAIN_ID: '31337',
        NEXT_PUBLIC_FUJI_RPC_URL: RPC_URL,
        NEXT_PUBLIC_API_BASE_URL: API_URL,
      },
      stdio: 'ignore',
    });
    pids.frontend = child.pid;
    writeFileSync(pidsFile, JSON.stringify(pids));
    const until = Date.now() + 60_000;
    while (Date.now() < until) {
      try {
        if ((await fetch(WEB_URL)).ok) return;
      } catch {
        /* not up yet */
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error('next start did not come up');
  } catch (e) {
    stopStack();
    throw e;
  }
}
