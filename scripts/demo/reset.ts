// pnpm demo:reset [-- --no-seed] [--network fuji|local] [--verify] [--dry-run]   (docs/12 §1 pre-flight, §6, D6-B1)
// Fresh demo in < 5 minutes: chain-id check → back up deployment/<network>.json → Deploy.s.sol → SeedDemo.s.sol
// (SEED_OBLIGATIONS=false with --no-seed) → sync-abi → `prisma migrate reset --force` + seed (registers every
// deployment/*.json of the chain, e.g. fuji.json + fuji-usdc.json) → restart instructions.
// Keys come only from .env (rule 7) and are never printed: secret arguments are redacted in the step log.
// The command runner, chain-id lookup, filesystem and clock are injectable (unit-tested in backend/test/demoReset.test.ts).
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPublicClient, http } from 'viem';

export type Network = 'fuji' | 'local';

export interface ResetOptions {
  network: Network;
  seed: boolean;
  verify: boolean;
  dryRun: boolean;
}

export interface Step {
  name: string;
  cmd: string;
  args: string[];
  /** Indexes into `args` whose values are secrets (redacted in logs). */
  secretArgs?: number[];
  env?: Record<string, string>;
}

export const EXPECTED_CHAIN_ID: Record<Network, number> = { fuji: 43113, local: 31337 };
export const RESET_BUDGET_MS = 5 * 60_000;
const ANVIL_MNEMONIC = 'test test test test test test test test test test test junk'; // public Anvil default
const ANVIL_ACCOUNT_0 = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
/** Deploy/seed parameters forwarded to forge (comment-stripped; docs/11 §4). */
const FORWARDED_ENV = [
  'ADMIN_ADDRESS',
  'AGENT_ADDRESS',
  'DEMO_MODE',
  'SAFETY_HORIZON_SEC',
  'EMERGENCY_BUFFER',
  'MAX_EXPOSURE_BPS',
  'POOL_INITIAL_APY_BPS',
  'POOL_INITIAL_UTILIZATION_BPS',
  'TREASURY_SEED_AMOUNT',
  'POOL_INTEREST_RESERVE',
  'RECIPIENT_PAYROLL',
  'RECIPIENT_PAYROLL_2',
  'RECIPIENT_GRANT',
] as const;

export const clean = (v: string | undefined) => v?.replace(/\s+#.*$/, '').trim() || undefined;

export function parseArgs(argv: readonly string[]): ResetOptions {
  const i = argv.indexOf('--network');
  const network = (i >= 0 ? argv[i + 1] : 'fuji') as Network;
  if (network !== 'fuji' && network !== 'local') throw new Error(`--network must be fuji or local, got ${network}`);
  return { network, seed: !argv.includes('--no-seed'), verify: argv.includes('--verify'), dryRun: argv.includes('--dry-run') };
}

export function rpcUrlFor(opts: ResetOptions, env: Record<string, string | undefined>): string {
  if (opts.network === 'local') return 'http://127.0.0.1:8545';
  const url = clean(env.FUJI_RPC_URL);
  if (!url) throw new Error('FUJI_RPC_URL is not set in .env');
  return url;
}

/** The ordered commands of a reset. Pure: no I/O. */
export function buildResetPlan(opts: ResetOptions, env: Record<string, string | undefined>): Step[] {
  const dbUrl = clean(env.DATABASE_URL);
  const rpc = rpcUrlFor(opts, env);
  const forgeEnv: Record<string, string> = {};
  for (const k of FORWARDED_ENV) {
    const v = clean(env[k]);
    if (v !== undefined) forgeEnv[k] = v;
  }
  const seedFlag = opts.seed ? 'true' : 'false';

  let signer: { args: string[]; secretArgs: number[] };
  if (opts.network === 'local') {
    signer = { args: ['--mnemonics', ANVIL_MNEMONIC, '--mnemonic-indexes', '0', '--sender', ANVIL_ACCOUNT_0], secretArgs: [] };
  } else {
    const key = clean(env.DEPLOYER_PRIVATE_KEY);
    if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error('DEPLOYER_PRIVATE_KEY missing or malformed in .env');
    signer = { args: ['--private-key', key], secretArgs: [1] };
  }
  const forgeScript = (script: string, extra: string[] = [], extraSecret: number[] = []): Pick<Step, 'cmd' | 'args' | 'secretArgs'> => {
    const base = ['script', script, '--rpc-url', rpc, '--broadcast'];
    const args = [...base, ...signer.args, ...extra];
    const secrets = [
      ...(opts.network === 'fuji' ? [3] : []), // RPC URLs may embed provider API keys
      ...signer.secretArgs.map((i) => base.length + i),
      ...extraSecret.map((i) => base.length + signer.args.length + i),
    ];
    return { cmd: 'forge', args, secretArgs: secrets };
  };

  const verifyArgs: string[] = [];
  const verifySecret: number[] = [];
  if (opts.verify && opts.network === 'fuji') {
    const url = clean(env.SNOWTRACE_VERIFIER_URL);
    const apiKey = clean(env.SNOWTRACE_API_KEY);
    if (!url || !apiKey) throw new Error('--verify needs SNOWTRACE_VERIFIER_URL and SNOWTRACE_API_KEY in .env');
    verifyArgs.push('--verify', '--verifier-url', url, '--etherscan-api-key', apiKey);
    verifySecret.push(4);
  }

  return [
    { name: 'Deploy contracts (Deploy.s.sol)', ...forgeScript('scripts/Deploy.s.sol', verifyArgs, verifySecret), env: forgeEnv },
    {
      name: `Record T0${opts.seed ? ' + seed 3 demo obligations' : ' (no obligations)'} (SeedDemo.s.sol)`,
      ...forgeScript('scripts/SeedDemo.s.sol'),
      env: { ...forgeEnv, SEED_OBLIGATIONS: seedFlag },
    },
    { name: 'Sync ABIs + deployments (sync-abi)', cmd: 'pnpm', args: ['--filter', '@runwaymind/shared', 'run', 'sync-abi'] },
    {
      name: 'Reset backend DB (prisma migrate reset --force)',
      cmd: 'pnpm',
      args: ['--filter', '@runwaymind/backend', 'exec', 'prisma', 'migrate', 'reset', '--force', '--skip-seed'],
      // Prisma's CLI only reads backend/.env, not the root .env: pass the cleaned URL explicitly.
      ...(dbUrl ? { env: { DATABASE_URL: dbUrl } } : {}),
    },
    {
      name: 'Seed backend DB (all deployment files of this chain)',
      cmd: 'pnpm',
      args: ['--filter', '@runwaymind/backend', 'run', 'db:seed'],
      env: { SEED_OBLIGATIONS: seedFlag, CHAIN_ID: String(EXPECTED_CHAIN_ID[opts.network]), ...(dbUrl ? { DATABASE_URL: dbUrl } : {}) },
    },
  ];
}

/** Printable command with secrets redacted. */
export function describeStep(step: Step): string {
  const shown = step.args.map((a, i) => (step.secretArgs?.includes(i) ? '<redacted>' : /\s/.test(a) ? `"${a}"` : a));
  return `${step.cmd} ${shown.join(' ')}`;
}

export function backupName(network: Network, nowMs: number): string {
  const stamp = new Date(nowMs).toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  return `${network}-${stamp}-pre-reset.json`;
}

export interface ResetDeps {
  run: (step: Step) => Promise<void>;
  getChainId: (rpcUrl: string) => Promise<number>;
  fs: { exists: (p: string) => boolean; mkdir: (p: string) => void; copy: (from: string, to: string) => void };
  now: () => number;
  log: (msg: string) => void;
}

export interface ResetResult {
  backup: string | null;
  steps: string[];
  elapsedMs: number;
  withinBudget: boolean;
}

export async function runReset(opts: ResetOptions, env: Record<string, string | undefined>, root: string, deps: ResetDeps): Promise<ResetResult> {
  const started = deps.now();
  const expected = EXPECTED_CHAIN_ID[opts.network];
  const configured = Number(clean(env.CHAIN_ID) ?? expected);
  if (opts.network === 'fuji' && configured !== expected) {
    throw new Error(`.env CHAIN_ID is ${configured}, expected ${expected} for --network fuji — refusing to reset`);
  }
  const rpc = rpcUrlFor(opts, env);
  const actual = await deps.getChainId(rpc);
  if (actual !== expected) throw new Error(`RPC chain id is ${actual}, expected ${expected} for --network ${opts.network} — refusing to reset`);

  const plan = buildResetPlan(opts, env);
  deps.log(`demo:reset on ${opts.network} (chain ${actual})${opts.dryRun ? ' — DRY RUN, nothing is executed' : ''}`);
  deps.log(`Backend DB to reset: ${clean(env.DATABASE_URL) ?? '(DATABASE_URL unset)'}`);

  const current = resolve(root, 'deployment', `${opts.network}.json`);
  let backup: string | null = null;
  if (deps.fs.exists(current)) {
    const dir = resolve(root, 'deployment', 'backup');
    backup = resolve(dir, backupName(opts.network, started));
    if (!opts.dryRun) {
      deps.fs.mkdir(dir);
      deps.fs.copy(current, backup);
    }
    deps.log(`Backed up deployment/${opts.network}.json → ${backup}`);
  }

  for (const [i, step] of plan.entries()) {
    deps.log(`[${i + 1}/${plan.length}] ${step.name}\n      $ ${describeStep(step)}`);
    if (!opts.dryRun) await deps.run(step);
  }

  const elapsedMs = deps.now() - started;
  const withinBudget = elapsedMs <= RESET_BUDGET_MS;
  deps.log(`\nDone in ${(elapsedMs / 1000).toFixed(1)} s${withinBudget ? '' : ` — over the 5-minute budget (${RESET_BUDGET_MS / 60_000} min)`}.`);
  deps.log(
    [
      'Next:',
      '  1. Restart the backend (Ctrl+C, then `pnpm dev`) so it loads the new TreasuryConfig rows.',
      '  2. Restart the frontend with a clean cache (stop it, delete frontend/.next, `pnpm dev`) — stale bundles keep old addresses.',
      '  3. Hard-refresh the browser (Ctrl+Shift+R) and sign in again (SIWE).',
      opts.seed ? '' : '  4. Create the demo obligations in the UI (scene 0:20).',
    ]
      .filter(Boolean)
      .join('\n'),
  );
  return { backup, steps: plan.map((s) => s.name), elapsedMs, withinBudget };
}

// ---- real I/O (only when executed directly) -------------------------------------------------------------------

function realRun(env: Record<string, string | undefined>) {
  return (step: Step) =>
    new Promise<void>((done, fail) => {
      const win = process.platform === 'win32';
      // On Windows pnpm is a .cmd shim → needs a shell; quote arguments with spaces (Anvil mnemonic).
      const args = win ? step.args.map((a) => (/\s/.test(a) ? `"${a}"` : a)) : step.args;
      const child = spawn(step.cmd, args, { stdio: 'inherit', shell: win, env: { ...process.env, ...env, ...step.env } });
      child.on('error', fail);
      child.on('exit', (code) => (code === 0 ? done() : fail(new Error(`${step.name} failed (exit ${code})`))));
    });
}

async function main() {
  const root = resolve(import.meta.dirname, '..', '..');
  if (existsSync(resolve(root, '.env'))) process.loadEnvFile(resolve(root, '.env'));
  const opts = parseArgs(process.argv.slice(2));
  const env = process.env as Record<string, string | undefined>;
  await runReset(opts, env, root, {
    run: realRun(env),
    getChainId: (url) => createPublicClient({ transport: http(url) }).getChainId(),
    fs: { exists: existsSync, mkdir: (p) => mkdirSync(p, { recursive: true }), copy: copyFileSync },
    now: () => Date.now(),
    log: (m) => console.log(m),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e: unknown) => {
    console.error(`demo:reset failed: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}
