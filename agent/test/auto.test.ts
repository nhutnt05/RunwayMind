// Auto Mode (docs/05 §8) — orchestrator/auto.ts rules and their wiring into the agent tick.
import { describe, expect, it } from 'vitest';
import type { AgentSettings, ChainSnapshot } from '@runwaymind/shared';
import { AuditLogger, MemoryAuditSink } from '../src/audit/audit';
import { computeCashLadder } from '../src/engines/cashLadder';
import { manualFacts } from '../src/engines/decide';
import { AUTO_ACTOR, autoApprovable, executeAutoApproved, initialStatus } from '../src/orchestrator/auto';
import { MemoryAgentStore } from '../src/orchestrator/store';
import { createAgentLoop } from '../src/orchestrator/tick';
import { ADAPTER, USDC, adapter, investedSnapshot, snapshot } from './fixtures';

function setup(initial: ChainSnapshot, mode: AgentSettings['mode'], withExecutor = true) {
  const clock = new Date('2026-11-11T00:00:00Z');
  const store = new MemoryAgentStore(() => clock);
  store.settings = { ...store.settings, mode };
  const sink = new MemoryAuditSink();
  const audit = new AuditLogger(sink);
  const enqueued: string[] = [];
  const loop = createAgentLoop({
    client: {} as never,
    addresses: {
      treasury: '0x00000000000000000000000000000000000000f1',
      registry: '0x00000000000000000000000000000000000000f3',
      policy: '0x00000000000000000000000000000000000000f4',
    },
    store,
    audit,
    executor: withExecutor ? { enqueue: async (id) => void enqueued.push(id) } : null,
    readSnapshot: async () => initial,
    now: () => clock,
  });
  return { store, sink, audit, loop, enqueued };
}

describe('auto mode rules (docs/05 §8)', () => {
  it('auto_rules: withdrawals and breaker always approvable; INVEST only from P6; HOLD never', () => {
    expect(autoApprovable({ action: 'WITHDRAW', reasonCode: 'DEADLINE_REACHED' })).toBe(true);
    expect(autoApprovable({ action: 'WITHDRAW_ALL', reasonCode: 'POOL_RISK_CRITICAL' })).toBe(true);
    expect(autoApprovable({ action: 'TRIP_CIRCUIT_BREAKER', reasonCode: 'ALL_POOLS_CRITICAL' })).toBe(true);
    expect(autoApprovable({ action: 'INVEST', reasonCode: 'IDLE_SURPLUS' })).toBe(true);
    expect(autoApprovable({ action: 'INVEST', reasonCode: 'MANUAL' })).toBe(false);
    expect(autoApprovable({ action: 'HOLD', reasonCode: 'POOL_RISK_WATCH' })).toBe(false);
  });

  it('auto_initialStatus: APPROVE mode always PENDING_APPROVAL; AUTO approves only approvable decisions', () => {
    expect(initialStatus('APPROVE', { action: 'WITHDRAW', reasonCode: 'DEADLINE_REACHED' })).toBe('PENDING_APPROVAL');
    expect(initialStatus('AUTO', { action: 'INVEST', reasonCode: 'IDLE_SURPLUS' })).toBe('APPROVED');
    expect(initialStatus('AUTO', { action: 'HOLD', reasonCode: 'POOL_RISK_WATCH' })).toBe('PENDING_APPROVAL');
  });
});

describe('auto mode in the agent tick', () => {
  it('auto_invest: INVEST 70,000 created APPROVED, audited as approved by system, enqueued', async () => {
    const t = setup(snapshot(), 'AUTO');
    const r = await t.loop.tick();
    expect(r.created).toHaveLength(1);
    expect(r.created[0]).toMatchObject({ action: 'INVEST', amount: USDC(70_000), status: 'APPROVED', mode: 'AUTO' });
    expect(t.enqueued).toEqual([r.created[0]!.id]);
    const approved = t.sink.entries.find((e) => e.eventType === 'DECISION_APPROVED');
    expect(approved).toMatchObject({ actor: AUTO_ACTOR, entityId: r.created[0]!.id });
    expect(t.sink.entries.map((e) => e.eventType)).toEqual(['DECISION_CREATED', 'DECISION_APPROVED', 'AGENT_TICK']);
  });

  it('auto_crisis: WITHDRAW_ALL and TRIP_CIRCUIT_BREAKER both auto-approved and executed', async () => {
    const t = setup(investedSnapshot({ adapters: [adapter(USDC(70_000), { paused: true })] }), 'AUTO');
    const r = await t.loop.tick();
    expect(r.created.map((d) => [d.action, d.status])).toEqual([
      ['WITHDRAW_ALL', 'APPROVED'],
      ['TRIP_CIRCUIT_BREAKER', 'APPROVED'],
    ]);
    expect(t.enqueued).toEqual(r.created.map((d) => d.id));
  });

  it('approve mode: nothing auto-approved or enqueued', async () => {
    const t = setup(snapshot(), 'APPROVE');
    const r = await t.loop.tick();
    expect(r.created[0]!.status).toBe('PENDING_APPROVAL');
    expect(t.enqueued).toEqual([]);
    expect(t.sink.entries.some((e) => e.eventType === 'DECISION_APPROVED')).toBe(false);
  });

  it('auto without executor: decisions stay APPROVED (executed once an AGENT key is configured)', async () => {
    const t = setup(snapshot(), 'AUTO', false);
    const r = await t.loop.tick();
    expect(r.created[0]!.status).toBe('APPROVED');
    expect(await executeAutoApproved({ audit: t.audit, executor: null }, r.created)).toEqual([]);
  });
});

describe('manualFacts (docs/07 §5.5)', () => {
  it('grounded facts for an ADMIN-initiated decision', () => {
    const s = snapshot();
    const l = computeCashLadder(s);
    const settings = new MemoryAgentStore().settings;
    const f = manualFacts(s, l, settings, ADAPTER, USDC(20_000));
    expect(f).toMatchObject({ idle: '100000.00', requiredReserve: '30000.00', amount: '20000.00', investableNow: '70000.00', mode: 'APPROVE' });
    expect(f.adapterName).not.toBeNull();
  });
});
