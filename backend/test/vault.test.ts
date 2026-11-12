// docs/07 §5.5–§5.7: manual vault actions (AGENT | ADMIN_WALLET), policy & demo prepared transactions.
// FakeChain SRC snapshot; a fake executor records enqueued decisions (no RPC).
import { decodeFunctionData, maxUint256, type Abi, type Address, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { mockLendingPoolAbi, policyEngineAbi, treasuryAbi } from '@runwaymind/shared/abi';
import { createScheduler } from '../src/scheduler';
import { ADAPTER, FakeChain, TREASURY, USDC, loginCookie, makeApp, prisma, resetDb } from './helpers';

const admin = privateKeyToAccount(generatePrivateKey());
const viewer = privateKeyToAccount(generatePrivateKey());
const AGENT_ADDR: Address = '0x00000000000000000000000000000000000000aa';
const POOL: Address = '0x00000000000000000000000000000000000000B0';
const API = '/api/v1';

async function setup(opts: { executor?: boolean; pool?: Address | null } = {}) {
  const chain = new FakeChain();
  chain.admins.add(admin.address);
  const enqueued: string[] = [];
  const built = await makeApp(chain, undefined, {
    poolAddress: opts.pool === undefined ? POOL : opts.pool,
    scheduler: (c) =>
      createScheduler({
        loop: null,
        executor:
          opts.executor === false
            ? null
            : { address: AGENT_ADDR, enqueue: async (id: string) => void enqueued.push(id) },
        keeper: null,
        indexer: null,
        getSettings: () => c.repos.agentSettings(),
      }),
  });
  const adminCookie = await loginCookie(built.app, admin);
  const viewerCookie = await loginCookie(built.app, viewer);
  const post = (url: string, payload: unknown, cookie = adminCookie) =>
    built.app.inject({ method: 'POST', url: `${API}${url}`, headers: { cookie }, payload: payload as object });
  return { ...built, chain, enqueued, adminCookie, viewerCookie, post };
}

const decode = (abi: unknown, data: Hex) => decodeFunctionData({ abi: abi as Abi, data });
const reserveViolation = {
  ok: false as const,
  error: { name: 'ReserveViolation', args: { idleAfter: '10000000000', requiredReserve: '30000000000' } },
  message: 'reverted',
};

describe('vault actions (docs/07 §5.5–§5.6)', () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it('POST /vault/withdrawals via AGENT → MANUAL decision APPROVED by the admin, simulated as AGENT, enqueued, audited', async () => {
    const { post, chain, enqueued } = await setup();
    const res = await post('/vault/withdrawals', { adapter: ADAPTER, amount: '20000000000' });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data).toMatchObject({
      executeVia: 'AGENT',
      preparedTx: null,
      simulation: { ok: true, error: null },
      decision: { action: 'WITHDRAW', adapter: ADAPTER, amount: '20000000000', reasonCode: 'MANUAL', status: 'APPROVED', approvedBy: admin.address },
    });
    expect(data.decision.explanation.source).toBe('TEMPLATE');
    expect(data.decision.facts).toMatchObject({ amount: '20000.00', idle: '100000.00' });
    expect(enqueued).toEqual([data.decision.id]);
    expect(chain.simulations[0]).toMatchObject({ account: AGENT_ADDR, call: { address: TREASURY, functionName: 'withdraw', args: [ADAPTER, USDC(20_000)] } });
    const events = (await prisma.auditLog.findMany({ where: { entityId: data.decision.id } })).map((a) => [a.eventType, a.actor]);
    expect(events).toEqual([
      ['DECISION_CREATED', admin.address],
      ['DECISION_APPROVED', admin.address],
    ]);
  });

  it('withdraw "MAX" via AGENT → WITHDRAW_ALL of the adapter balance; contract call uses type(uint256).max', async () => {
    const { post, chain } = await setup();
    chain.snapshot = { ...chain.snapshot, idle: USDC(30_000), adapters: [{ ...chain.snapshot.adapters[0]!, balance: USDC(70_000) }] };
    const res = await post('/vault/withdrawals', { adapter: ADAPTER, amount: 'MAX' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.decision).toMatchObject({ action: 'WITHDRAW_ALL', amount: '70000000000' });
    expect(chain.simulations[0]!.call.args).toEqual([ADAPTER, maxUint256]);
  });

  it('withdraw "MAX" with zero balance → 409 INVALID_STATE', async () => {
    const { post } = await setup();
    const res = await post('/vault/withdrawals', { adapter: ADAPTER, amount: 'MAX' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('INVALID_STATE');
  });

  it('withdraw via ADMIN_WALLET → prepared Treasury.withdraw simulated from the admin; no decision', async () => {
    const { post, chain, enqueued } = await setup();
    const res = await post('/vault/withdrawals', { adapter: ADAPTER, amount: 'MAX', executeVia: 'ADMIN_WALLET' });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data).toMatchObject({ executeVia: 'ADMIN_WALLET', decision: null, preparedTx: { to: TREASURY, value: '0', chainId: 43113, functionName: 'withdraw' } });
    expect(decode(treasuryAbi, data.preparedTx.data)).toMatchObject({ functionName: 'withdraw', args: [ADAPTER, maxUint256] });
    expect(chain.simulations[0]!.account).toBe(admin.address);
    expect(enqueued).toEqual([]);
    expect(await prisma.agentDecision.count()).toBe(0);
  });

  it('POST /vault/investments via AGENT → INVEST MANUAL decision enqueued', async () => {
    const { post, enqueued } = await setup();
    const res = await post('/vault/investments', { adapter: ADAPTER, amount: '50000000000' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.decision).toMatchObject({ action: 'INVEST', amount: '50000000000', reasonCode: 'MANUAL', status: 'APPROVED' });
    expect(enqueued).toHaveLength(1);
  });

  it('invest beyond reserve → 409 POLICY_VIOLATION with decoded ReserveViolation and rule; nothing persisted', async () => {
    for (const executeVia of ['AGENT', 'ADMIN_WALLET'] as const) {
      const { post, chain, enqueued } = await setup();
      chain.simulation = reserveViolation;
      const res = await post('/vault/investments', { adapter: ADAPTER, amount: '90000000000', executeVia });
      expect(res.statusCode).toBe(409);
      const err = res.json().error;
      expect(err.code).toBe('POLICY_VIOLATION');
      expect(err.message).toContain('R1 Reserve Ratio');
      expect(err.details).toMatchObject({ rule: 'R1 Reserve Ratio', error: reserveViolation.error });
      expect(enqueued).toEqual([]);
      expect(await prisma.agentDecision.count()).toBe(0);
    }
  });

  it('executeVia AGENT without an AGENT executor → 409 INVALID_STATE', async () => {
    const { post } = await setup({ executor: false });
    const res = await post('/vault/investments', { adapter: ADAPTER, amount: '1000000' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('INVALID_STATE');
  });

  it('validation: bad amount / address → 400', async () => {
    const { post } = await setup();
    expect((await post('/vault/withdrawals', { adapter: ADAPTER, amount: '-5' })).statusCode).toBe(400);
    expect((await post('/vault/investments', { adapter: '0x123', amount: '1' })).statusCode).toBe(400);
    expect((await post('/vault/investments', { adapter: ADAPTER, amount: 'MAX' })).statusCode).toBe(400);
  });
});

describe('policy & demo helpers (docs/07 §5.7)', () => {
  beforeEach(resetDb);

  it('POST /policy/prepare encodes each PolicyEngine setter and simulates from the admin', async () => {
    const { post, chain } = await setup();
    const status = await post('/policy/prepare', { fn: 'setAdapterStatus', args: [ADAPTER, 'WITHDRAW_ONLY'] });
    expect(status.statusCode).toBe(200);
    const tx = status.json().data.preparedTx;
    expect(tx).toMatchObject({ to: chain.addresses.policy, contract: 'PolicyEngine', functionName: 'setAdapterStatus' });
    expect(decode(policyEngineAbi, tx.data)).toMatchObject({ functionName: 'setAdapterStatus', args: [ADAPTER, 2] });
    expect(chain.simulations[0]!.account).toBe(admin.address);

    const h = (await post('/policy/prepare', { fn: 'setSafetyHorizon', args: [7 * 86_400] })).json().data.preparedTx;
    expect(decode(policyEngineAbi, h.data).args).toEqual([604_800n]);
    const b = (await post('/policy/prepare', { fn: 'setEmergencyBuffer', args: ['5000000000'] })).json().data.preparedTx;
    expect(decode(policyEngineAbi, b.data).args).toEqual([USDC(5_000)]);
    const e = (await post('/policy/prepare', { fn: 'setMaxExposureBps', args: [5000] })).json().data.preparedTx;
    expect(decode(policyEngineAbi, e.data).args).toEqual([5000]);
  });

  it('policy simulation revert is returned (not thrown) like other prepared txs', async () => {
    const { post, chain } = await setup();
    chain.simulation = { ok: false, error: { name: 'InvalidParameter', args: { name: 'safetyHorizon' } }, message: 'reverted' };
    const res = await post('/policy/prepare', { fn: 'setSafetyHorizon', args: [100 * 86_400] });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.simulation).toMatchObject({ ok: false, error: { name: 'InvalidParameter' } });
    expect((await post('/policy/prepare', { fn: 'setMaxExposureBps', args: [20_000] })).statusCode).toBe(400);
  });

  it('POST /demo/prepare: advanceTime / resetCircuitBreaker → Treasury; pool knobs → MockLendingPool', async () => {
    const { post } = await setup();
    const adv = (await post('/demo/prepare', { fn: 'advanceTime', args: [2 * 86_400] })).json().data.preparedTx;
    expect(adv).toMatchObject({ to: TREASURY, contract: 'Treasury' });
    expect(decode(treasuryAbi, adv.data)).toMatchObject({ functionName: 'advanceTime', args: [172_800n] });

    const reset = (await post('/demo/prepare', { fn: 'resetCircuitBreaker' })).json().data.preparedTx;
    expect(decode(treasuryAbi, reset.data).functionName).toBe('resetCircuitBreaker');

    const apy = (await post('/demo/prepare', { fn: 'setAPY', args: [100] })).json().data.preparedTx;
    expect(apy).toMatchObject({ to: POOL, contract: 'MockLendingPool' });
    expect(decode(mockLendingPoolAbi, apy.data)).toMatchObject({ functionName: 'setAPY', args: [100n] });
    const paused = (await post('/demo/prepare', { fn: 'setPaused', args: [true] })).json().data.preparedTx;
    expect(decode(mockLendingPoolAbi, paused.data)).toMatchObject({ functionName: 'setPaused', args: [true] });
    const util = (await post('/demo/prepare', { fn: 'setUtilization', args: [9500] })).json().data.preparedTx;
    expect(decode(mockLendingPoolAbi, util.data).args).toEqual([9500n]);
    const short = (await post('/demo/prepare', { fn: 'setLiquidityShortage', args: [true] })).json().data.preparedTx;
    expect(decode(mockLendingPoolAbi, short.data).functionName).toBe('setLiquidityShortage');
  });

  it('demo: time travel when demoMode == false → 409 INVALID_STATE; no pool → 409; bad args → 400', async () => {
    const a = await setup();
    a.chain.snapshot = { ...a.chain.snapshot, demoMode: false };
    const res = await a.post('/demo/prepare', { fn: 'advanceTime', args: [86_400] });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('INVALID_STATE');
    expect((await a.post('/demo/prepare', { fn: 'advanceTime', args: [0] })).statusCode).toBe(400);
    expect((await a.post('/demo/prepare', { fn: 'setAPY', args: [10_001] })).statusCode).toBe(400);
    expect((await a.post('/demo/prepare', { fn: 'setPaused', args: ['yes'] })).statusCode).toBe(400);

    const b = await setup({ pool: null });
    expect((await b.post('/demo/prepare', { fn: 'setAPY', args: [100] })).statusCode).toBe(409);
  });

  it('every §5.5–§5.7 endpoint: 403 for a non-admin session, 401 without a session', async () => {
    const { app, post, viewerCookie } = await setup();
    const calls: [string, unknown][] = [
      ['/vault/withdrawals', { adapter: ADAPTER, amount: '1' }],
      ['/vault/investments', { adapter: ADAPTER, amount: '1' }],
      ['/policy/prepare', { fn: 'setMaxExposureBps', args: [5000] }],
      ['/demo/prepare', { fn: 'advanceTime', args: [86_400] }],
    ];
    for (const [url, payload] of calls) {
      const forbidden = await post(url, payload, viewerCookie);
      expect(forbidden.statusCode, url).toBe(403);
      expect(forbidden.json().error.code).toBe('FORBIDDEN_NOT_ADMIN');
      const anon = await app.inject({ method: 'POST', url: `${API}${url}`, payload: payload as object });
      expect(anon.statusCode, url).toBe(401);
    }
  });
});
