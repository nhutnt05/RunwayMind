// docs/10 §4.6 keeper_* (Anvil). The KEEPER key holds no role (docs/05 §9); ADMIN only moves demo time.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Hex } from 'viem';
import { obligationRegistryAbi } from '@runwaymind/shared/abi';
import { AuditLogger, MemoryAuditSink } from '../../src/audit/audit';
import { createKeeper } from '../../src/keeper/keeper';
import { MemoryAgentStore } from '../../src/orchestrator/store';
import { USDC, anvilReachable, deploymentAvailable, harness, type Harness } from './anvil';

const enabled = deploymentAvailable && (await anvilReachable());

describe.skipIf(!enabled)('keeper on Anvil (docs/05 §10.1)', () => {
  let h: Harness;
  let snap: Hex;
  let store: MemoryAgentStore;
  let sink: MemoryAuditSink;

  beforeEach(async () => {
    h = harness();
    snap = await h.test.snapshot();
    await h.test.setBalance({ address: h.keeper.account.address, value: 10n ** 18n });
    store = new MemoryAgentStore();
    sink = new MemoryAuditSink();
  });

  afterEach(async () => {
    await h.test.revert({ id: snap });
  });

  const keeper = () =>
    createKeeper({ client: h.client, wallet: h.keeper, addresses: h.addresses, store, audit: new AuditLogger(sink), retryDelaysMs: [50] });

  const obligation = async (id: bigint) =>
    (await h.client.readContract({ address: h.addresses.registry, abi: obligationRegistryAbi, functionName: 'getObligation', args: [id] })) as {
      status: number;
      paidOccurrences: number;
    };

  it('keeper has no role on Treasury', async () => {
    const agentRole = await h.read<Hex>('AGENT_ROLE');
    expect(await h.read<boolean>('hasRole', [agentRole, h.keeper.account.address])).toBe(false);
    expect(await h.read<boolean>('hasRole', [`0x${'0'.repeat(64)}`, h.keeper.account.address])).toBe(false);
  });

  it('nothing due at Day 0 → empty run recorded', async () => {
    const run = await keeper().tick();
    expect(run).toMatchObject({ enforced: false, paidIds: [], txHashes: [], errors: [] });
    expect(store.keeperRuns.get(run.id)).toMatchObject({ enforced: false });
  });

  it('keeper_paysDueObligation: after advanceTime(7d) the keeper pays O1 within one tick', async () => {
    await h.adminSend('invest', [h.adapter, USDC(70_000)]);
    await h.advanceDays(7n);
    const run = await keeper().tick();
    expect(run.errors).toEqual([]);
    expect(run.paidIds).toEqual([1n]);
    expect(run.txHashes).toHaveLength(1);
    expect((await obligation(1n)).status).toBe(1); // COMPLETED
    const tx = store.transactions.get(run.txHashes[0]!);
    expect(tx).toMatchObject({ kind: 'PAY', initiator: 'KEEPER', status: 'CONFIRMED', relatedId: run.id });
    expect(tx!.decodedEvents!.find((e) => e.name === 'ObligationPaid')?.args).toMatchObject({ id: '1', amount: USDC(20_000).toString() });
    expect(await h.read<bigint>('idleBalance')).toBe(USDC(10_000));
    expect(sink.entries.filter((e) => e.eventType === 'KEEPER_PAY')).toHaveLength(1);

    // Second tick: nothing left to do.
    expect((await keeper().tick()).paidIds).toEqual([]);
  });

  it('keeper_enforcesShortfall: at D16 with funds invested → enforceDeadlines sent, shortfall cleared', async () => {
    await h.adminSend('invest', [h.adapter, USDC(70_000)]);
    await h.advanceDays(7n);
    await h.adminSend('pay', [1n]); // O1 paid on time at D7 (anyone may pay)
    await h.advanceDays(9n); // D16: O2's withdrawal deadline
    expect(await h.read<bigint>('shortfall')).toBe(USDC(20_000));

    const run = await keeper().tick();
    expect(run.errors).toEqual([]);
    expect(run.enforced).toBe(true);
    expect(run.shortfallBefore).toBe(USDC(20_000));
    expect(run.paidIds).toEqual([]);
    expect(await h.read<bigint>('shortfall')).toBe(0n);
    const tx = store.transactions.get(run.txHashes[0]!);
    expect(tx).toMatchObject({ kind: 'ENFORCE_DEADLINES', status: 'CONFIRMED' });
    expect(tx!.decodedEvents!.find((e) => e.name === 'DeadlineEnforced')?.args).toMatchObject({ shortfallBefore: USDC(20_000).toString() });
    expect(sink.entries.some((e) => e.eventType === 'KEEPER_ENFORCE')).toBe(true);
  });
});
