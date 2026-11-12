// D6-B1 multi-treasury: GET /treasuries, `?treasury=` routing (default primary, unknown → 404), per-treasury admin
// checks and data scoping, one scheduler per treasury, and the seed registering fuji.json + fuji-usdc.json.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeFunctionData, type Abi, type Address } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { policyEngineAbi } from '@runwaymind/shared/abi';
import type { SchedulerContext } from '../src/app';
import { createScheduler } from '../src/scheduler';
import { CIRCLE_USDC_FUJI, seedTreasuries } from '../prisma/seed';
import { FakeChain, TREASURY_ID, USDC, loginCookie, makeApp, prisma, resetDb } from './helpers';

const admin = privateKeyToAccount(generatePrivateKey());
const API = '/api/v1';
const USDC_ID = 'fuji-usdc';
const T2: Address = '0x00000000000000000000000000000000000000E1';
const POLICY2: Address = '0x00000000000000000000000000000000000000E3';

function usdcChain() {
  const c = new FakeChain();
  (c as { addresses: FakeChain['addresses'] }).addresses = { treasury: T2, registry: '0x00000000000000000000000000000000000000E2', policy: POLICY2 };
  c.snapshot = { ...c.snapshot, treasury: T2, idle: USDC(15), obligations: [], adapters: [], onchainRequiredReserve: 2_000_000n };
  return c;
}

async function seedSecondTreasury() {
  await prisma.treasuryConfig.create({
    data: {
      id: USDC_ID,
      chainId: 31337,
      treasuryAddress: T2,
      registryAddress: '0x00000000000000000000000000000000000000E2',
      policyAddress: POLICY2,
      assetAddress: CIRCLE_USDC_FUJI,
      assetSymbol: 'USDC',
      assetDecimals: 6,
      deployBlock: '60926117',
      demoStartTime: 1794453783,
      isPrimary: false,
    },
  });
  await prisma.pool.create({
    data: { adapterAddress: '0x00000000000000000000000000000000000000E5', poolAddress: '0x00000000000000000000000000000000000000E4', treasuryId: USDC_ID, name: 'Mock Lending Pool (USDC)', kind: 'MOCK' },
  });
}

async function setup(opts: { schedulers?: string[]; adminOnUsdc?: boolean } = {}) {
  const c1 = new FakeChain();
  const c2 = usdcChain();
  c1.admins.add(admin.address);
  if (opts.adminOnUsdc) c2.admins.add(admin.address);
  const factory = (ctx: SchedulerContext) => {
    opts.schedulers?.push(ctx.treasuryId);
    return createScheduler({ loop: null, executor: null, keeper: null, indexer: null, getSettings: () => ctx.repos.agentSettings() });
  };
  const built = await makeApp(c1, undefined, {
    treasuries: [
      { id: TREASURY_ID, chain: c1, poolAddress: '0x00000000000000000000000000000000000000B0', scheduler: factory },
      { id: USDC_ID, chain: c2, poolAddress: '0x00000000000000000000000000000000000000E4', scheduler: factory },
    ],
    primaryTreasuryId: TREASURY_ID,
  });
  const cookie = await loginCookie(built.app, admin);
  const req = (method: 'GET' | 'POST' | 'DELETE', url: string, payload?: unknown) =>
    built.app.inject({ method, url: `${API}${url}`, headers: { cookie }, ...(payload !== undefined ? { payload: payload as object } : {}) });
  return { ...built, c1, c2, req };
}

describe('multi-treasury API (D6-B1)', () => {
  beforeEach(async () => {
    await resetDb();
    await seedSecondTreasury();
  });
  afterAll(() => prisma.$disconnect());

  it('GET /treasuries → configured treasuries, primary first, documented shape', async () => {
    const { req } = await setup();
    const res = await req('GET', '/treasuries');
    expect(res.statusCode).toBe(200);
    const data = res.json().data as Record<string, unknown>[];
    expect(data.map((t) => [t.id, t.isPrimary])).toEqual([
      [TREASURY_ID, true],
      [USDC_ID, false],
    ]);
    expect(Object.keys(data[1]!).sort()).toEqual(
      ['adapterAddress', 'assetAddress', 'assetDecimals', 'assetSymbol', 'chainId', 'demoStartTime', 'deployBlock', 'id', 'isPrimary', 'poolAddress', 'policyAddress', 'registryAddress', 'treasuryAddress'].sort(),
    );
    expect(data[1]).toMatchObject({
      treasuryAddress: T2,
      assetAddress: CIRCLE_USDC_FUJI,
      assetSymbol: 'USDC',
      deployBlock: '60926117',
      poolAddress: '0x00000000000000000000000000000000000000E4',
      adapterAddress: '0x00000000000000000000000000000000000000E5',
    });
    expect(data[0]).toMatchObject({ poolAddress: null, adapterAddress: null }); // primary has no Pool row in this fixture
  });

  it('?treasury= selects the ChainService; default = primary; unknown id → 404', async () => {
    const { req } = await setup();
    expect((await req('GET', '/treasury/overview')).json().data).toMatchObject({ treasury: '0x00000000000000000000000000000000000000F1', idle: '100000000000' });
    expect((await req('GET', `/treasury/overview?treasury=${USDC_ID}`)).json().data).toMatchObject({ treasury: T2, idle: '15000000' });
    expect((await req('GET', `/treasury/overview?treasury=${TREASURY_ID}`)).json().data.idle).toBe('100000000000');
    const unknown = await req('GET', '/treasury/overview?treasury=nope');
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error.code).toBe('NOT_FOUND');
    // query params of the route still work alongside ?treasury=
    expect((await req('GET', `/cash-ladder?treasury=${USDC_ID}&projectionDays=30`)).statusCode).toBe(200);
  });

  it('admin endpoints check ADMIN on the selected treasury and prepare txs for its contracts', async () => {
    const { req, c2 } = await setup();
    expect((await req('POST', '/policy/prepare', { fn: 'setMaxExposureBps', args: [5000] })).statusCode).toBe(200);
    const forbidden = await req('POST', `/policy/prepare?treasury=${USDC_ID}`, { fn: 'setMaxExposureBps', args: [5000] });
    expect(forbidden.statusCode).toBe(403);
    expect(c2.roleCalls).toBeGreaterThan(0); // the USDC treasury's chain was asked, not the primary's
    const fresh = await setup({ adminOnUsdc: true });
    const res = await fresh.req('POST', `/policy/prepare?treasury=${USDC_ID}`, { fn: 'setMaxExposureBps', args: [5000] });
    expect(res.statusCode).toBe(200);
    const tx = res.json().data.preparedTx;
    expect(tx.to).toBe(POLICY2);
    expect(decodeFunctionData({ abi: policyEngineAbi as Abi, data: tx.data }).functionName).toBe('setMaxExposureBps');
  });

  it('off-chain data is scoped per treasury (inflows)', async () => {
    const { req } = await setup({ adminOnUsdc: true });
    const created = await req('POST', `/inflows?treasury=${USDC_ID}`, { label: 'USDC grant', amount: '5000000', expectedDate: 1_793_318_400 + 10 * 86_400 });
    expect(created.statusCode).toBe(200);
    expect((await req('GET', `/inflows?treasury=${USDC_ID}`)).json().data).toHaveLength(1);
    expect((await req('GET', '/inflows')).json().data).toHaveLength(0);
    expect(await prisma.expectedInflow.findFirst()).toMatchObject({ treasuryId: USDC_ID });
  });

  it('one scheduler per treasury (agent loop + executor + keeper + indexer each)', async () => {
    const ids: string[] = [];
    const { schedulers, bundles, primaryId } = await setup({ schedulers: ids });
    expect(ids).toEqual([TREASURY_ID, USDC_ID]);
    expect(schedulers).toHaveLength(2);
    expect([...bundles.keys()]).toEqual([TREASURY_ID, USDC_ID]);
    expect(primaryId).toBe(TREASURY_ID);
  });
});

describe('seedTreasuries (D6-B1)', () => {
  beforeEach(resetDb);

  it('registers fuji.json as primary fuji-musdc and fuji-usdc.json as fuji-usdc (Circle USDC); idempotent; ignores other chains', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rm-seed-'));
    const A = (n: number) => `0x${n.toString(16).padStart(40, '0')}`;
    const dep = (base: number, mock: boolean, chainId = 43113) => ({
      chainId,
      deployBlock: String(1000 + base),
      demoMode: true,
      demoStartTime: 1794382804,
      contracts: {
        ...(mock ? { MockUSDC: A(base) } : {}),
        ObligationRegistry: A(base + 1),
        PolicyEngine: A(base + 2),
        Treasury: A(base + 3),
        MockLendingPool: A(base + 4),
        VaultAdapter: A(base + 5),
      },
      roles: { admin: A(0xaa), agent: A(0xbb) },
    });
    writeFileSync(join(dir, 'fuji-usdc.json'), JSON.stringify(dep(0x200, false)));
    writeFileSync(join(dir, 'fuji.json'), JSON.stringify(dep(0x100, true)));
    writeFileSync(join(dir, 'local.json'), JSON.stringify(dep(0x300, true, 31337)));
    writeFileSync(join(dir, 'notes.json'), JSON.stringify({ hello: 'world' }));

    for (let i = 0; i < 2; i++) {
      const seeded = await seedTreasuries(prisma, dir, { chainId: 43113, seedObligations: true });
      expect(seeded).toEqual(['fuji-musdc', 'fuji-usdc']);
    }
    const rows = await prisma.treasuryConfig.findMany({ where: { chainId: 43113 }, orderBy: { id: 'asc' } });
    expect(rows.map((r) => [r.id, r.isPrimary, r.assetSymbol, r.assetAddress.toLowerCase()])).toEqual([
      ['fuji-musdc', true, 'mUSDC', A(0x100)],
      ['fuji-usdc', false, 'USDC', CIRCLE_USDC_FUJI.toLowerCase()],
    ]);
    expect(await prisma.pool.count({ where: { treasuryId: 'fuji-usdc' } })).toBe(1);
    expect(await prisma.agentSettings.count({ where: { treasuryId: { in: ['fuji-musdc', 'fuji-usdc'] } } })).toBe(2);
    // demo obligation labels only for the primary treasury
    expect(await prisma.obligationMetadata.count({ where: { treasuryId: 'fuji-musdc' } })).toBe(3);
    expect(await prisma.obligationMetadata.count({ where: { treasuryId: 'fuji-usdc' } })).toBe(0);
  });
});
