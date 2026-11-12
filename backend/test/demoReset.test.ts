// scripts/demo/reset.ts (D6-B1) with an injected fake runner — no chain, no forge, no DB is touched.
import { describe, expect, it } from 'vitest';
import {
  RESET_BUDGET_MS,
  backupName,
  buildResetPlan,
  describeStep,
  parseArgs,
  runReset,
  type ResetDeps,
  type Step,
} from '../../scripts/demo/reset';

const KEY = `0x${'ab'.repeat(32)}`;
const ENV = {
  CHAIN_ID: '43113',
  FUJI_RPC_URL: 'https://fuji.example.com/v2/RPCSECRET  # provider',
  DEPLOYER_PRIVATE_KEY: KEY,
  AGENT_ADDRESS: '0x901999461cB4ecF9d971458A6aaf4bFbEbbB0051',
  SAFETY_HORIZON_SEC: '1209600          # 14 days',
  SNOWTRACE_VERIFIER_URL: 'https://api.routescan.io/v2/network/testnet/evm/43113/etherscan',
  SNOWTRACE_API_KEY: 'SNOWSECRET',
  DATABASE_URL: 'file:./runwaymind-cp2.db',
};

function fakeDeps(opts: { chainId?: number; exists?: boolean; elapsedMs?: number } = {}) {
  const ran: Step[] = [];
  const logs: string[] = [];
  const copies: [string, string][] = [];
  let t = Date.UTC(2026, 10, 12, 9, 30, 0);
  const deps: ResetDeps = {
    run: async (s) => void ran.push(s),
    getChainId: async () => opts.chainId ?? 43113,
    fs: { exists: () => opts.exists ?? true, mkdir: () => undefined, copy: (a, b) => void copies.push([a, b]) },
    now: () => {
      const v = t;
      t += opts.elapsedMs ?? 60_000;
      return v;
    },
    log: (m) => void logs.push(m),
  };
  return { deps, ran, logs, copies };
}

describe('demo:reset plan (scripts/demo/reset.ts)', () => {
  it('parseArgs: defaults (fuji, seed) and flags', () => {
    expect(parseArgs([])).toEqual({ network: 'fuji', seed: true, verify: false, dryRun: false });
    expect(parseArgs(['--', '--no-seed', '--verify', '--dry-run', '--network', 'local'])).toEqual({ network: 'local', seed: false, verify: true, dryRun: true });
    expect(() => parseArgs(['--network', 'mainnet'])).toThrow(/fuji or local/);
  });

  it('step sequence: Deploy → SeedDemo → sync-abi → migrate reset → seed; --no-seed sets SEED_OBLIGATIONS=false', () => {
    const plan = buildResetPlan(parseArgs(['--no-seed']), ENV);
    expect(plan.map((s) => [s.cmd, s.args.slice(0, 4).join(' ')])).toEqual([
      ['forge', 'script scripts/Deploy.s.sol --rpc-url https://fuji.example.com/v2/RPCSECRET'],
      ['forge', 'script scripts/SeedDemo.s.sol --rpc-url https://fuji.example.com/v2/RPCSECRET'],
      ['pnpm', '--filter @runwaymind/shared run sync-abi'],
      ['pnpm', '--filter @runwaymind/backend exec prisma'],
      ['pnpm', '--filter @runwaymind/backend run db:seed'],
    ]);
    expect(plan[1]!.env).toMatchObject({ SEED_OBLIGATIONS: 'false' });
    expect(plan[4]!.env).toMatchObject({ SEED_OBLIGATIONS: 'false', CHAIN_ID: '43113' });
    expect(plan[3]!.args).toEqual(['--filter', '@runwaymind/backend', 'exec', 'prisma', 'migrate', 'reset', '--force', '--skip-seed']);
    expect(plan[0]!.args).toContain('--broadcast');
    expect(plan[0]!.env).toMatchObject({ SAFETY_HORIZON_SEC: '1209600', AGENT_ADDRESS: ENV.AGENT_ADDRESS }); // comments stripped
    expect(buildResetPlan(parseArgs([]), ENV)[1]!.env).toMatchObject({ SEED_OBLIGATIONS: 'true' });
  });

  it('secrets (private key, RPC URL, explorer API key) are passed to forge but redacted when printed', () => {
    const plan = buildResetPlan(parseArgs(['--verify']), ENV);
    expect(plan[0]!.args).toContain(KEY);
    expect(plan[0]!.args).toContain('SNOWSECRET');
    const shown = describeStep(plan[0]!);
    expect(shown).not.toContain(KEY);
    expect(shown).not.toContain('RPCSECRET');
    expect(shown).not.toContain('SNOWSECRET');
    expect(shown).toContain('--private-key <redacted>');
    expect(shown).toContain('--verifier-url https://api.routescan.io');
    expect(shown).toContain('--etherscan-api-key <redacted>');
  });

  it('local network uses the public Anvil mnemonic, no private key from .env', () => {
    const plan = buildResetPlan(parseArgs(['--network', 'local']), {});
    expect(plan[0]!.args).toEqual(expect.arrayContaining(['--rpc-url', 'http://127.0.0.1:8545', '--mnemonics']));
    expect(describeStep(plan[0]!)).toContain('"test test test');
  });

  it('missing / malformed deployer key or RPC → clear error', () => {
    expect(() => buildResetPlan(parseArgs([]), { ...ENV, DEPLOYER_PRIVATE_KEY: '0x12' })).toThrow(/DEPLOYER_PRIVATE_KEY/);
    expect(() => buildResetPlan(parseArgs([]), { ...ENV, FUJI_RPC_URL: '' })).toThrow(/FUJI_RPC_URL/);
    expect(() => buildResetPlan(parseArgs(['--verify']), { ...ENV, SNOWTRACE_API_KEY: '' })).toThrow(/--verify/);
  });

  it('backupName is timestamped and never the live file name', () => {
    expect(backupName('fuji', Date.UTC(2026, 10, 12, 9, 30, 0))).toBe('fuji-20261112-093000-pre-reset.json');
  });
});

describe('demo:reset run', () => {
  it('backs up deployment/fuji.json, runs every step in order, reports elapsed time within budget', async () => {
    const { deps, ran, copies, logs } = fakeDeps();
    const r = await runReset(parseArgs(['--no-seed']), ENV, '/repo', deps);
    expect(ran.map((s) => s.name)).toEqual(r.steps);
    expect(ran).toHaveLength(5);
    expect(copies).toHaveLength(1);
    expect(copies[0]![0].replace(/\\/g, '/')).toMatch(/\/deployment\/fuji\.json$/);
    expect(copies[0]![1].replace(/\\/g, '/')).toMatch(/\/deployment\/backup\/fuji-\d{8}-\d{6}-pre-reset\.json$/);
    expect(r.withinBudget).toBe(true);
    expect(logs.join('\n')).toContain('Restart the backend');
    expect(logs.join('\n')).not.toContain(KEY);
  });

  it('refuses when the RPC chain id or .env CHAIN_ID mismatch — nothing runs, nothing is copied', async () => {
    const a = fakeDeps({ chainId: 43114 });
    await expect(runReset(parseArgs([]), ENV, '/repo', a.deps)).rejects.toThrow(/chain id is 43114/);
    expect(a.ran).toHaveLength(0);
    expect(a.copies).toHaveLength(0);
    const b = fakeDeps();
    await expect(runReset(parseArgs([]), { ...ENV, CHAIN_ID: '31337' }, '/repo', b.deps)).rejects.toThrow(/refusing/);
    expect(b.ran).toHaveLength(0);
  });

  it('--dry-run prints the plan without running or copying', async () => {
    const { deps, ran, copies, logs } = fakeDeps();
    await runReset(parseArgs(['--dry-run']), ENV, '/repo', deps);
    expect(ran).toHaveLength(0);
    expect(copies).toHaveLength(0);
    expect(logs[0]).toContain('DRY RUN');
  });

  it('no existing deployment file → no backup; over 5 minutes → flagged', async () => {
    const { deps, copies } = fakeDeps({ exists: false, elapsedMs: RESET_BUDGET_MS + 1 });
    const r = await runReset(parseArgs([]), ENV, '/repo', deps);
    expect(r.backup).toBeNull();
    expect(copies).toHaveLength(0);
    expect(r.withinBudget).toBe(false);
  });
});

describe('demo:reset passes a clean DATABASE_URL to Prisma (CP2 B-11)', () => {
  it('strips an inline .env comment and sets it on the migrate-reset and seed steps', () => {
    const plan = buildResetPlan(parseArgs(['--no-seed']), { ...ENV, DATABASE_URL: 'file:./runwaymind-cp2.db  # CP2 rehearsal DB' });
    const reset = plan.find((s) => s.args.includes('reset'))!;
    const seed = plan.find((s) => s.args.includes('db:seed'))!;
    expect(reset.env).toMatchObject({ DATABASE_URL: 'file:./runwaymind-cp2.db' });
    expect(seed.env).toMatchObject({ DATABASE_URL: 'file:./runwaymind-cp2.db' });
  });
});
