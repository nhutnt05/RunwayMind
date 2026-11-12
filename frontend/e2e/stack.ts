// E2E stack (docs/10 §6, §8): Anvil :8547 → Deploy + SeedDemo → backend :4100 (own SQLite) → frontend :3100 (dev,
// NEXT_PUBLIC_E2E=true). Ports never collide with the developer's 3000 / 4000 / 8545. Keys are Anvil's public test
// accounts derived from the well-known mnemonic at runtime (never written to the repo).
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bytesToHex } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '..', '..');
export const FRONTEND = resolve(ROOT, 'frontend');
export const BACKEND = resolve(ROOT, 'backend');
export const STATE = resolve(HERE, '.state');

export const ANVIL_PORT = 8547;
export const API_PORT = 4100;
export const WEB_PORT = 3100;
export const RPC_URL = `http://127.0.0.1:${ANVIL_PORT}`;
export const API_URL = `http://localhost:${API_PORT}/api/v1`;
export const WEB_URL = `http://localhost:${WEB_PORT}`;

const MNEMONIC = 'test test test test test test test test test test test junk';
const acct = (i: number) => mnemonicToAccount(MNEMONIC, { addressIndex: i });
const pk = (i: number) => bytesToHex(acct(i).getHdKey().privateKey!);
export const ADMIN = acct(0).address;
export const AGENT = acct(1).address;

const isWin = process.platform === 'win32';

export function killTree(pid: number | undefined): void {
  if (!pid) return;
  try {
    if (isWin) spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(-pid, 'SIGTERM');
  } catch {
    /* already gone */
  }
}

function start(cmd: string, args: string[], cwd: string, env: Record<string, string>, log: string): ChildProcess {
  const out = resolve(STATE, log);
  writeFileSync(out, '');
  const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, detached: !isWin, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
  const append = (d: Buffer) => writeFileSync(out, d, { flag: 'a' });
  child.stdout?.on('data', append);
  child.stderr?.on('data', append);
  return child;
}

function run(cmd: string, args: string[], cwd: string, env: Record<string, string>): void {
  const r = spawnSync(cmd, args, { cwd, env: { ...process.env, ...env }, encoding: 'utf8', shell: isWin, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`${cmd} ${args.slice(0, 3).join(' ')} failed:\n${(r.stdout ?? '').slice(-2000)}\n${(r.stderr ?? '').slice(-2000)}`);
}

async function waitFor(what: string, check: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      if (await check()) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error(`timed out waiting for ${what}`);
}

const rpc = (method: string) =>
  fetch(RPC_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: [] }) });

/** Contract-script env: Anvil roles, demo parameters (process env wins over the root .env forge loads). */
const CHAIN_ENV = {
  AGENT_ADDRESS: AGENT,
  ADMIN_ADDRESS: ADMIN,
  DEMO_MODE: 'true',
  SAFETY_HORIZON_SEC: '1209600',
  EMERGENCY_BUFFER: '10000000000',
  MAX_EXPOSURE_BPS: '7000',
  POOL_INITIAL_APY_BPS: '800',
  POOL_INITIAL_UTILIZATION_BPS: '5000',
  TREASURY_SEED_AMOUNT: '100000000000',
  POOL_INTEREST_RESERVE: '10000000000',
  RECIPIENT_PAYROLL: acct(3).address,
  RECIPIENT_PAYROLL_2: acct(4).address,
  RECIPIENT_GRANT: acct(5).address,
  SEED_OBLIGATIONS: 'true',
};

export async function startStack(): Promise<void> {
  mkdirSync(STATE, { recursive: true });
  const pids: Record<string, number | undefined> = {};
  const save = () => writeFileSync(resolve(STATE, 'pids.json'), JSON.stringify(pids));
  // Deploy.s.sol / SeedDemo.s.sol write deployment/local.json; restored by stopStack().
  copyFileSync(resolve(ROOT, 'deployment', 'local.json'), resolve(STATE, 'local.json.bak'));
  copyFileSync(resolve(FRONTEND, 'tsconfig.json'), resolve(STATE, 'tsconfig.json.bak'));

  pids.anvil = start('anvil', ['--port', String(ANVIL_PORT), '--chain-id', '31337', '--silent'], ROOT, {}, 'anvil.log').pid;
  save();
  await waitFor('anvil', async () => (await rpc('eth_chainId')).ok, 30_000);

  const forgeArgs = (script: string) => ['script', `scripts/${script}`, '--rpc-url', RPC_URL, '--broadcast', '--private-key', pk(0)];
  run('forge', forgeArgs('Deploy.s.sol'), ROOT, CHAIN_ENV);
  run('forge', forgeArgs('SeedDemo.s.sol'), ROOT, CHAIN_ENV);

  const dbEnv = { DATABASE_URL: 'file:./e2e.db', DEPLOYMENT_FILE: '../deployment/local.json', SEED_OBLIGATIONS: 'true', CHAIN_ID: '31337' };
  rmSync(resolve(BACKEND, 'prisma', 'e2e.db'), { force: true });
  run('npx', ['prisma', 'migrate', 'deploy'], BACKEND, dbEnv);
  run('npx', ['tsx', 'prisma/seed.ts'], BACKEND, dbEnv);

  pids.backend = start(process.execPath, ['--import', 'tsx', 'src/server.ts'], BACKEND, {
    ...dbEnv,
    NODE_ENV: 'development',
    PORT: String(API_PORT),
    CHAIN_ID: '31337',
    FUJI_RPC_URL: RPC_URL,
    FUJI_RPC_URL_FALLBACK: '',
    APP_ORIGIN: WEB_URL,
    SESSION_SECRET: 'e2e-session-secret-e2e-session-secret-0123',
    AGENT_ENABLED: 'true',
    KEEPER_ENABLED: 'false',
    LLM_ENABLED: 'false',
    AGENT_PRIVATE_KEY: pk(1),
    KEEPER_PRIVATE_KEY: pk(2),
    INDEXER_BLOCK_RANGE: '2000',
  }, 'backend.log').pid;
  save();
  await waitFor('backend', async () => (await fetch(`${API_URL}/health`)).ok, 90_000);

  pids.frontend = start(process.execPath, [resolve(FRONTEND, 'node_modules', 'next', 'dist', 'bin', 'next'), 'dev', '-p', String(WEB_PORT)], FRONTEND, {
    NEXT_DIST_DIR: '.next-e2e',
    NEXT_PUBLIC_E2E: 'true',
    NEXT_PUBLIC_CHAIN_ID: '31337',
    NEXT_PUBLIC_FUJI_RPC_URL: RPC_URL,
    NEXT_PUBLIC_API_BASE_URL: API_URL,
    NEXT_PUBLIC_SNOWTRACE_BASE: 'https://testnet.snowtrace.io',
  }, 'frontend.log').pid;
  save();
  // First dev compile of the dashboard is slow; warm the routes the specs use.
  await waitFor('frontend', async () => (await fetch(WEB_URL)).ok, 240_000);
  for (const path of ['/obligations', '/vault', '/agent']) await fetch(`${WEB_URL}${path}`).catch(() => undefined);
}

export function stopStack(): void {
  const file = resolve(STATE, 'pids.json');
  if (existsSync(file)) {
    const pids = JSON.parse(readFileSync(file, 'utf8')) as Record<string, number | undefined>;
    for (const name of ['frontend', 'backend', 'anvil']) killTree(pids[name]);
    rmSync(file, { force: true });
  }
  const bak = resolve(STATE, 'local.json.bak');
  if (existsSync(bak)) copyFileSync(bak, resolve(ROOT, 'deployment', 'local.json'));
  const ts = resolve(STATE, 'tsconfig.json.bak');
  if (existsSync(ts)) copyFileSync(ts, resolve(FRONTEND, 'tsconfig.json'));
  rmSync(resolve(BACKEND, 'prisma', 'e2e.db'), { force: true });
  rmSync(resolve(BACKEND, 'prisma', 'e2e.db-journal'), { force: true });
}
