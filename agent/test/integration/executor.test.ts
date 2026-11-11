// docs/10 §4.6 executor_* (Anvil): approve flow end-to-end against the local deployment (docs/11 §5).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Hex } from 'viem';
import { AuditLogger, MemoryAuditSink } from '../../src/audit/audit';
import { Executor } from '../../src/executor/executor';
import { createApprovalService } from '../../src/orchestrator/approval';
import { MemoryAgentStore } from '../../src/orchestrator/store';
import { createAgentLoop } from '../../src/orchestrator/tick';
import { USDC, anvilReachable, deploymentAvailable, harness, type Harness } from './anvil';

const enabled = deploymentAvailable && (await anvilReachable());

describe.skipIf(!enabled)('executor on Anvil (docs/05 §10)', () => {
  let h: Harness;
  let snap: Hex;
  let store: MemoryAgentStore;
  let sink: MemoryAuditSink;
  let audit: AuditLogger;
  let executor: Executor;

  beforeEach(async () => {
    h = harness();
    snap = await h.test.snapshot();
    store = new MemoryAgentStore();
    sink = new MemoryAuditSink();
    audit = new AuditLogger(sink);
    executor = new Executor({ client: h.client, wallet: h.agent, addresses: h.addresses, store, audit, retryDelaysMs: [50, 50, 50] });
  });

  afterEach(async () => {
    await h.test.revert({ id: snap });
  });

  const loop = () => createAgentLoop({ client: h.client, addresses: h.addresses, store, audit, agentAccount: h.agent.account.address });

  it('executor_happyPath: INVEST 70,000 PENDING_APPROVAL → approve → tx confirmed → EXECUTED, idle 30,000', async () => {
    const tick = await loop().tick();
    expect(tick.mismatch).toBe(false);
    expect(tick.created).toHaveLength(1);
    const d = tick.created[0]!;
    expect(d).toMatchObject({ action: 'INVEST', adapter: h.adapter, amount: USDC(70_000), reasonCode: 'IDLE_SURPLUS', status: 'PENDING_APPROVAL', mode: 'APPROVE' });
    expect(d.explanation?.headline).toContain('70000.00');

    // Second tick: same intent → deduped (no new decision).
    expect((await loop().tick()).created).toHaveLength(0);

    const approval = createApprovalService({ store, audit });
    const approved = await approval.approve(d.id, h.admin.account.address);
    expect(approved.status).toBe('APPROVED');

    const done = await executor.enqueue(d.id);
    expect(done?.status).toBe('EXECUTED');
    const [action] = await store.listActions(d.id);
    expect(action).toMatchObject({ functionName: 'invest', status: 'CONFIRMED' });
    expect(action!.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    const tx = store.transactions.get(action!.txHash!);
    expect(tx).toMatchObject({ kind: 'INVEST', initiator: 'AGENT', status: 'CONFIRMED', relatedId: d.id });
    expect(tx!.decodedEvents!.map((e) => e.name)).toContain('Invested');

    expect(await h.read<bigint>('idleBalance')).toBe(USDC(30_000));
    expect(sink.entries.map((e) => e.eventType)).toEqual(
      expect.arrayContaining(['DECISION_CREATED', 'DECISION_APPROVED', 'ACTION_SENT', 'ACTION_CONFIRMED', 'AGENT_TICK']),
    );
  });

  it('executor_simulationRevert_blockedByPolicy: forced over-reserve decision → BLOCKED_BY_POLICY, no tx sent', async () => {
    const nonceBefore = await h.client.getTransactionCount({ address: h.agent.account.address });
    const forced = await store.createDecision({
      snapshotId: 'forced',
      action: 'INVEST',
      adapter: h.adapter,
      amount: USDC(80_000), // idle 100,000 − 80,000 = 20,000 < required reserve 30,000 → R1
      reasonCode: 'MANUAL',
      status: 'APPROVED',
      mode: 'APPROVE',
      facts: {} as never,
      explanation: null,
      expiresAt: new Date(Date.now() + 600_000),
    });
    const res = await executor.enqueue(forced.id);
    expect(res?.status).toBe('BLOCKED_BY_POLICY');
    const [action] = await store.listActions(forced.id);
    expect(action).toMatchObject({ status: 'BLOCKED_BY_POLICY', txHash: null });
    expect(action!.decodedError).toEqual({ name: 'ReserveViolation', args: { idleAfter: USDC(20_000).toString(), requiredReserve: USDC(30_000).toString() } });
    expect(store.transactions.size).toBe(0);
    expect(await h.client.getTransactionCount({ address: h.agent.account.address })).toBe(nonceBefore);
    expect(await h.read<bigint>('idleBalance')).toBe(USDC(100_000));
    expect(sink.entries.some((e) => e.eventType === 'ACTION_SIMULATION_REVERTED')).toBe(true);
  });

  it('executor_staleness_superseded: state changes between approval and execution → SUPERSEDED', async () => {
    const [d] = (await loop().tick()).created;
    expect(d?.amount).toBe(USDC(70_000));
    await createApprovalService({ store, audit }).approve(d!.id, h.admin.account.address);

    // ADMIN invests 30,000 manually in the meantime → investable now 40,000 (≠ 70,000 by > 1%).
    await h.adminSend('invest', [h.adapter, USDC(30_000)]);

    const res = await executor.enqueue(d!.id);
    expect(res?.status).toBe('SUPERSEDED');
    expect(await store.listActions(d!.id)).toHaveLength(0);
    expect(await h.read<bigint>('idleBalance')).toBe(USDC(70_000));
    expect(sink.entries.find((e) => e.eventType === 'DECISION_SUPERSEDED')?.payload).toMatchObject({ reason: 'AMOUNT_CHANGED' });
  });

  it('withdraw execution re-caps the amount and confirms Withdrawn', async () => {
    await h.adminSend('invest', [h.adapter, USDC(70_000)]);
    const dec = await store.createDecision({
      snapshotId: 'manual',
      action: 'WITHDRAW',
      adapter: h.adapter,
      amount: USDC(20_000),
      reasonCode: 'MANUAL',
      status: 'APPROVED',
      mode: 'APPROVE',
      facts: {} as never,
      explanation: null,
      expiresAt: new Date(Date.now() + 600_000),
    });
    expect((await executor.enqueue(dec.id))?.status).toBe('EXECUTED');
    expect(await h.read<bigint>('idleBalance')).toBe(USDC(50_000));
  });
});
