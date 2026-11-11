// Agent loop (docs/05 §2), state machine (§2.1), approval (§8), templates (§7.3) — no chain required.
import { describe, expect, it } from 'vitest';
import type { ChainSnapshot } from '@runwaymind/shared';
import { AuditLogger, MemoryAuditSink } from '../src/audit/audit';
import { prepareAction, withinOnePercent } from '../src/executor/executor';
import { NonceQueue } from '../src/executor/nonceQueue';
import { templateExplanation } from '../src/llm/templates';
import { ApprovalError, createApprovalService } from '../src/orchestrator/approval';
import { MemoryAgentStore } from '../src/orchestrator/store';
import { createAgentLoop, sameIntent } from '../src/orchestrator/tick';
import { ADAPTER, USDC, adapter, investedSnapshot, snapshot } from './fixtures';

function setup(initial: ChainSnapshot = snapshot()) {
  let clock = new Date('2026-11-11T00:00:00Z');
  const store = new MemoryAgentStore(() => clock);
  const sink = new MemoryAuditSink();
  const audit = new AuditLogger(sink);
  const state = { snapshot: initial };
  const enqueued: string[] = [];
  const loop = createAgentLoop({
    client: {} as never,
    addresses: { treasury: '0x00000000000000000000000000000000000000f1', registry: '0x00000000000000000000000000000000000000f3', policy: '0x00000000000000000000000000000000000000f4' },
    store,
    audit,
    executor: { enqueue: async (id) => void enqueued.push(id) },
    readSnapshot: async () => state.snapshot,
    now: () => clock,
  });
  return {
    store,
    sink,
    audit,
    state,
    loop,
    enqueued,
    advance: (sec: number) => {
      clock = new Date(clock.getTime() + sec * 1000);
    },
    now: () => clock,
  };
}

describe('agent tick (docs/05 §2)', () => {
  it('creates INVEST 70,000 PENDING_APPROVAL with a template explanation, and audits the tick', async () => {
    const t = setup();
    const r = await t.loop.tick();
    expect(r.created).toHaveLength(1);
    expect(r.created[0]).toMatchObject({
      action: 'INVEST',
      adapter: ADAPTER,
      amount: USDC(70_000),
      reasonCode: 'IDLE_SURPLUS',
      status: 'PENDING_APPROVAL',
      mode: 'APPROVE',
      explanation: { source: 'TEMPLATE', headline: 'Invest 70000.00 USDC into Mock Lending Pool (mUSDC)' },
    });
    expect(r.created[0]!.expiresAt.getTime() - t.now().getTime()).toBe(600_000);
    expect(t.store.snapshots).toHaveLength(1);
    expect(t.sink.entries.map((e) => e.eventType)).toEqual(['DECISION_CREATED', 'AGENT_TICK']);
    expect(t.enqueued).toEqual([]);
  });

  it('dedupes the same intent and supersedes a pending decision whose amount moved > 1%', async () => {
    const t = setup();
    const first = (await t.loop.tick()).created[0]!;
    const again = await t.loop.tick();
    expect(again.created).toHaveLength(0);
    expect(again.skipped).toEqual([{ action: 'INVEST', adapter: ADAPTER, reason: 'SAME_INTENT_OPEN' }]);

    // idle grows by 10,000 → investable 80,000 → new decision supersedes the 70,000 one.
    t.state.snapshot = snapshot({ idle: USDC(110_000) });
    const next = await t.loop.tick();
    expect(next.superseded).toEqual([first.id]);
    expect(next.created[0]!.amount).toBe(USDC(77_000)); // R3 cap: 70% of 110,000
    expect((await t.store.getDecision(first.id))!.status).toBe('SUPERSEDED');
    expect(t.sink.entries.some((e) => e.eventType === 'DECISION_SUPERSEDED' && e.entityId === first.id)).toBe(true);
  });

  it('does not propose a duplicate while the same slot is APPROVED / EXECUTING', async () => {
    const t = setup();
    const d = (await t.loop.tick()).created[0]!;
    await t.store.transitionDecision(d.id, ['PENDING_APPROVAL'], { status: 'EXECUTING' });
    t.state.snapshot = snapshot({ idle: USDC(110_000) });
    const r = await t.loop.tick();
    expect(r.created).toHaveLength(0);
    expect(r.skipped[0]!.reason).toBe('IN_FLIGHT');
  });

  it('expires pending decisions older than decisionTtlSec', async () => {
    const t = setup();
    const d = (await t.loop.tick()).created[0]!;
    t.advance(601);
    const r = await t.loop.tick();
    expect(r.expired).toEqual([d.id]);
    expect((await t.store.getDecision(d.id))!.status).toBe('EXPIRED');
    expect(r.created).toHaveLength(1); // re-proposed with a fresh TTL
  });

  it('Auto Mode: decisions are APPROVED and enqueued; HOLD stays informational', async () => {
    const t = setup();
    t.store.settings = { ...t.store.settings, mode: 'AUTO' };
    const r = await t.loop.tick();
    expect(r.created[0]).toMatchObject({ status: 'APPROVED', mode: 'AUTO' });
    expect(t.enqueued).toEqual([r.created[0]!.id]);
  });

  it('ONCHAIN_MISMATCH: no INVEST and ENGINE_MISMATCH audited (docs/05 §4)', async () => {
    const t = setup(snapshot({ onchainRequiredReserve: USDC(31_000) }));
    const r = await t.loop.tick();
    expect(r.mismatch).toBe(true);
    expect(r.created).toHaveLength(0);
    expect(t.sink.entries.some((e) => e.eventType === 'ENGINE_MISMATCH')).toBe(true);
  });

  it('crisis: WITHDRAW_ALL + TRIP_CIRCUIT_BREAKER decisions', async () => {
    const t = setup(investedSnapshot({ adapters: [adapter(USDC(70_000), { paused: true })] }));
    const r = await t.loop.tick();
    expect(r.created.map((d) => [d.action, d.reasonCode])).toEqual([
      ['WITHDRAW_ALL', 'POOL_RISK_CRITICAL'],
      ['TRIP_CIRCUIT_BREAKER', 'ALL_POOLS_CRITICAL'],
    ]);
  });
});

describe('approval (docs/05 §8, §2.1)', () => {
  it('approve → APPROVED with approver, audit, executor enqueued', async () => {
    const t = setup();
    const d = (await t.loop.tick()).created[0]!;
    const enq: string[] = [];
    const svc = createApprovalService({ store: t.store, audit: t.audit, executor: { enqueue: async (id) => void enq.push(id) }, now: t.now });
    const res = await svc.approve(d.id, '0xAdmin');
    expect(res).toMatchObject({ status: 'APPROVED', approvedBy: '0xAdmin' });
    expect(enq).toEqual([d.id]);
    expect(t.sink.entries.find((e) => e.eventType === 'DECISION_APPROVED')).toMatchObject({ actor: '0xAdmin', entityId: d.id });
    await expect(svc.approve(d.id, '0xAdmin')).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('reject → REJECTED with reason; unknown id → NOT_FOUND; expired → EXPIRED + INVALID_STATE', async () => {
    const t = setup();
    const svc = createApprovalService({ store: t.store, audit: t.audit, now: t.now });
    const d = (await t.loop.tick()).created[0]!;
    expect(await svc.reject(d.id, '0xAdmin', 'not now')).toMatchObject({ status: 'REJECTED', rejectReason: 'not now', rejectedBy: '0xAdmin' });
    await expect(svc.reject('nope', '0xAdmin')).rejects.toBeInstanceOf(ApprovalError);

    const d2 = (await t.loop.tick()).created[0]!;
    t.advance(700);
    await expect(svc.approve(d2.id, '0xAdmin')).rejects.toMatchObject({ code: 'INVALID_STATE', status: 'EXPIRED' });
    expect((await t.store.getDecision(d2.id))!.status).toBe('EXPIRED');
  });
});

describe('helpers', () => {
  it('withinOnePercent / sameIntent', () => {
    expect(withinOnePercent(USDC(70_700), USDC(70_000))).toBe(true);
    expect(withinOnePercent(USDC(70_701), USDC(70_000))).toBe(false);
    const draft = { action: 'INVEST', adapter: ADAPTER, amount: USDC(70_000), reasonCode: 'IDLE_SURPLUS' } as const;
    expect(sameIntent(draft, { ...draft, amount: USDC(70_500), facts: {} as never, snapshotId: 's' })).toBe(true);
    expect(sameIntent(draft, { ...draft, reasonCode: 'MANUAL', facts: {} as never, snapshotId: 's' })).toBe(false);
  });

  it('prepareAction maps actions to Treasury functions (docs/05 §10)', () => {
    expect(prepareAction({ id: 'x', action: 'INVEST', adapter: ADAPTER, amount: 1n })).toMatchObject({ functionName: 'invest', args: [ADAPTER, 1n] });
    expect(prepareAction({ id: 'x', action: 'WITHDRAW_ALL', adapter: ADAPTER, amount: 2n })).toMatchObject({ functionName: 'withdraw' });
    expect(prepareAction({ id: 'x', action: 'TRIP_CIRCUIT_BREAKER', adapter: null, amount: null })).toMatchObject({ functionName: 'tripCircuitBreaker', args: [] });
    expect(prepareAction({ id: 'x', action: 'HOLD', adapter: ADAPTER, amount: null })).toBeNull();
  });

  it('templates only print numbers from facts (APY_BELOW_MINIMUM example, docs/05 §7.3)', () => {
    const e = templateExplanation({
      action: 'WITHDRAW_ALL',
      reasonCode: 'APY_BELOW_MINIMUM',
      minApyBps: 300,
      facts: { apyPercent: '1.00', amount: '70030.68', adapterName: 'Mock Lending Pool', nextObligation: null } as never,
    });
    expect(e.explanation).toBe('APY dropped to 1.00% (minimum 3.00%). Withdraw 70030.68 USDC from Mock Lending Pool back to the Treasury.');
    expect(e.source).toBe('TEMPLATE');
  });

  it('NonceQueue serializes jobs and hands out increasing nonces', async () => {
    let count = 0;
    const client = { getTransactionCount: async () => (count += 1, 7) } as never;
    const q = new NonceQueue(client, '0x0000000000000000000000000000000000000001');
    const order: number[] = [];
    const slow = q.run(async () => {
      await new Promise((r) => setTimeout(r, 20));
      order.push(1);
      return q.next();
    });
    const fast = q.run(async () => {
      order.push(2);
      return q.next();
    });
    expect(await Promise.all([slow, fast])).toEqual([7, 8]);
    expect(order).toEqual([1, 2]);
    q.reset();
    expect(await q.run(() => q.next())).toBe(7);
    expect(count).toBe(2);
    await expect(q.run(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(await q.run(async () => 'still works')).toBe('still works');
  });
});
