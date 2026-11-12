// Executor (docs/05 §10): APPROVED decision → staleness check → simulate → send (AGENT key) → confirm → persist.
// Executions are serialized through the AGENT NonceQueue. State machine: docs/05 §2.1.
import type { Address, PublicClient } from 'viem';
import { treasuryAbi } from '@runwaymind/shared/abi';
import type { AgentActionType, ChainSnapshot } from '@runwaymind/shared';
import { decodeTrackedLogs } from '../chain/events';
import { readSnapshot as readChainSnapshot, type CoreAddresses } from '../chain/reader';
import { computeCashLadder } from '../engines/cashLadder';
import { decide } from '../engines/decide';
import { AuditLogger, silentLogger, type Logger } from '../audit/audit';
import type { ActionRecord, AgentFunctionName, AgentStore, DecisionRecord } from '../orchestrator/store';
import { computeSnapshotRisks } from '../orchestrator/risk';
import { NonceQueue } from './nonceQueue';
import {
  DEFAULT_RECEIPT_TIMEOUT_MS,
  DEFAULT_RETRY_DELAYS_MS,
  POLICY_ERRORS,
  SendRevertedError,
  errorMessage,
  sendAndConfirm,
  simulateCall,
  type AgentWallet,
} from './send';

export interface PreparedAction {
  decisionId: string;
  functionName: AgentFunctionName;
  args: readonly unknown[]; // [adapter, amount] | []
  expectedEvents: ('Invested' | 'Withdrawn' | 'CircuitBreakerTripped')[];
}

export interface ExecutorDeps {
  client: PublicClient;
  wallet: AgentWallet;
  addresses: CoreAddresses;
  store: AgentStore;
  audit: AuditLogger;
  queue?: NonceQueue;
  retryDelaysMs?: readonly number[];
  receiptTimeoutMs?: number;
  /** Injectable for tests; defaults to the multicall chain reader. */
  readSnapshot?: (client: PublicClient, addrs: CoreAddresses) => Promise<ChainSnapshot>;
  log?: Logger;
  /** Called after every execution settles (any terminal state). */
  onSettled?: (d: DecisionRecord) => void;
}

/** |a − b| ≤ 1% of `reference` (docs/05 §10 step 1). */
export function withinOnePercent(a: bigint, reference: bigint): boolean {
  const diff = a > reference ? a - reference : reference - a;
  return diff * 100n <= reference;
}

const sameAddr = (a: string | null, b: string | null) => (a ?? '').toLowerCase() === (b ?? '').toLowerCase();

export function prepareAction(d: Pick<DecisionRecord, 'id' | 'action' | 'adapter' | 'amount'>): PreparedAction | null {
  switch (d.action as AgentActionType) {
    case 'INVEST':
      return { decisionId: d.id, functionName: 'invest', args: [d.adapter, d.amount], expectedEvents: ['Invested'] };
    case 'WITHDRAW':
    case 'WITHDRAW_ALL':
      return { decisionId: d.id, functionName: 'withdraw', args: [d.adapter, d.amount], expectedEvents: ['Withdrawn'] };
    case 'TRIP_CIRCUIT_BREAKER':
      return { decisionId: d.id, functionName: 'tripCircuitBreaker', args: [], expectedEvents: ['CircuitBreakerTripped'] };
    default:
      return null; // HOLD: informational, nothing to send
  }
}

const TX_KIND = { invest: 'INVEST', withdraw: 'WITHDRAW', tripCircuitBreaker: 'TRIP_BREAKER' } as const;

export class Executor {
  readonly queue: NonceQueue;
  private readonly delays: readonly number[];
  private readonly log: Logger;

  constructor(private readonly deps: ExecutorDeps) {
    this.queue = deps.queue ?? new NonceQueue(deps.client, deps.wallet.account.address);
    this.delays = deps.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
    this.log = deps.log ?? silentLogger;
  }

  get address(): Address {
    return this.deps.wallet.account.address;
  }

  /** Queues an APPROVED decision; resolves with the final record once it has been processed. */
  enqueue(decisionId: string): Promise<DecisionRecord | null> {
    return this.queue.run(async () => {
      try {
        const d = await this.execute(decisionId);
        if (d) this.deps.onSettled?.(d);
        return d;
      } catch (e) {
        this.log.error('executor crashed', { decisionId, error: errorMessage(e) });
        const d = await this.deps.store.transitionDecision(decisionId, ['EXECUTING', 'APPROVED'], { status: 'FAILED' });
        await this.deps.audit.record('ACTION_FAILED', { reason: 'EXECUTOR_ERROR', message: errorMessage(e) }, {
          entityType: 'DECISION',
          entityId: decisionId,
        });
        if (d) this.deps.onSettled?.(d);
        return d;
      }
    });
  }

  private async execute(decisionId: string): Promise<DecisionRecord | null> {
    const { store, audit } = this.deps;
    const entity = { entityType: 'DECISION' as const, entityId: decisionId };
    let d = await store.transitionDecision(decisionId, ['APPROVED'], { status: 'EXECUTING' });
    if (!d) return store.getDecision(decisionId); // not APPROVED (already handled, rejected, …)

    const prepared0 = prepareAction(d);
    if (!prepared0) return store.transitionDecision(d.id, ['EXECUTING'], { status: 'EXECUTED' });

    // 1. Staleness check — re-read chain, re-run decide(); intent gone or amount moved > 1% → SUPERSEDED.
    const stale = await this.stalenessCheck(d);
    if (stale.superseded) {
      const res = await store.transitionDecision(d.id, ['EXECUTING'], { status: 'SUPERSEDED' });
      await audit.record('DECISION_SUPERSEDED', { reason: stale.reason, stage: 'EXECUTOR' }, entity);
      return res;
    }
    if (stale.amount !== undefined && stale.amount !== d.amount) {
      d = (await store.transitionDecision(d.id, ['EXECUTING'], { status: 'EXECUTING', amount: stale.amount })) ?? d;
    }
    const prepared = prepareAction(d)!;
    const call = { address: this.deps.addresses.treasury, abi: treasuryAbi, functionName: prepared.functionName, args: prepared.args };
    let action = await store.createAction({
      decisionId: d.id,
      functionName: prepared.functionName,
      args: prepared.args,
      status: 'SIMULATING',
    });

    // 2. Simulate from the AGENT account.
    const sim = await simulateCall(this.deps.client, this.deps.wallet.account, call, this.delays);
    if (!sim.ok) {
      const policy = sim.reverted && sim.error !== null && POLICY_ERRORS.has(sim.error.name);
      const decodedError = sim.error ?? { name: 'UNKNOWN', args: { message: sim.message } };
      action = await store.updateAction(action.id, { status: policy ? 'BLOCKED_BY_POLICY' : 'FAILED', decodedError });
      await audit.record('ACTION_SIMULATION_REVERTED', { actionId: action.id, error: decodedError, policy }, entity);
      if (!policy) await audit.record('ACTION_FAILED', { actionId: action.id, stage: 'SIMULATION', error: decodedError }, entity);
      return store.transitionDecision(d.id, ['EXECUTING'], { status: policy ? 'BLOCKED_BY_POLICY' : 'FAILED' });
    }

    // 3–4. Send with nonce manager + retries, then wait for 1 confirmation.
    try {
      const { hash, receipt } = await sendAndConfirm({
        client: this.deps.client,
        wallet: this.deps.wallet,
        queue: this.queue,
        call,
        delays: this.delays,
        receiptTimeoutMs: this.deps.receiptTimeoutMs ?? DEFAULT_RECEIPT_TIMEOUT_MS,
        onSent: async (txHash, attempt) => {
          action = await store.updateAction(action.id, { status: 'SENT', txHash, attempt });
          await store.upsertTransaction({
            hash: txHash,
            kind: TX_KIND[prepared.functionName],
            from: this.address,
            initiator: 'AGENT',
            status: 'PENDING',
            blockNumber: null,
            decodedEvents: null,
            error: null,
            relatedId: d!.id,
          });
          await audit.record('ACTION_SENT', { actionId: action.id, txHash, functionName: prepared.functionName, args: prepared.args }, entity);
        },
      });
      const events = decodeTrackedLogs(receipt.logs, this.deps.addresses);
      const reverted = receipt.status !== 'success';
      const missing = prepared.expectedEvents.filter((n) => !events.some((e) => e.name === n));
      const ok = !reverted && missing.length === 0;
      action = await store.updateAction(action.id, {
        status: reverted ? 'REVERTED' : 'CONFIRMED',
        gasUsed: receipt.gasUsed,
        blockNumber: receipt.blockNumber,
        ...(ok ? {} : { decodedError: { name: reverted ? 'TransactionReverted' : 'ExpectedEventMissing', args: { missing } } }),
      });
      await store.upsertTransaction({
        hash,
        kind: TX_KIND[prepared.functionName],
        from: this.address,
        initiator: 'AGENT',
        status: reverted ? 'REVERTED' : 'CONFIRMED',
        blockNumber: receipt.blockNumber,
        decodedEvents: events,
        error: reverted ? { name: 'TransactionReverted' } : null,
        relatedId: d.id,
        confirmedAt: new Date(),
      });
      if (!ok) {
        await audit.record('ACTION_FAILED', { actionId: action.id, txHash: hash, reverted, missing }, entity);
        return store.transitionDecision(d.id, ['EXECUTING'], { status: 'FAILED' });
      }
      await audit.record('ACTION_CONFIRMED', { actionId: action.id, txHash: hash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed, events }, entity);
      return store.transitionDecision(d.id, ['EXECUTING'], { status: 'EXECUTED' });
    } catch (e) {
      const policy = e instanceof SendRevertedError && e.decoded !== null && POLICY_ERRORS.has(e.decoded.name);
      const decodedError = e instanceof SendRevertedError && e.decoded ? e.decoded : { name: 'SEND_FAILED', args: { message: errorMessage(e) } };
      action = await store.updateAction(action.id, { status: policy ? 'BLOCKED_BY_POLICY' : 'FAILED', decodedError });
      await audit.record(policy ? 'ACTION_SIMULATION_REVERTED' : 'ACTION_FAILED', { actionId: action.id, stage: 'SEND', error: decodedError }, entity);
      return store.transitionDecision(d.id, ['EXECUTING'], { status: policy ? 'BLOCKED_BY_POLICY' : 'FAILED' });
    }
  }

  private async stalenessCheck(d: DecisionRecord): Promise<{ superseded: false; amount?: bigint } | { superseded: true; reason: string }> {
    const read = this.deps.readSnapshot ?? readChainSnapshot;
    const s = await read(this.deps.client, this.deps.addresses);
    const adapterState = d.adapter ? s.adapters.find((a) => sameAddr(a.address, d.adapter)) : undefined;
    let amount = d.amount ?? undefined;

    if (d.reasonCode !== 'MANUAL') {
      const settings = await this.deps.store.getSettings();
      const { risks } = await computeSnapshotRisks(this.deps.store, s, settings);
      const fresh = decide(s, computeCashLadder(s), risks, settings).find((x) => x.action === d.action && sameAddr(x.adapter, d.adapter));
      if (!fresh) return { superseded: true, reason: 'INTENT_GONE' };
      if (d.amount !== null && fresh.amount !== null && !withinOnePercent(fresh.amount, d.amount)) {
        return { superseded: true, reason: 'AMOUNT_CHANGED' };
      }
    }
    if ((d.action === 'WITHDRAW' || d.action === 'WITHDRAW_ALL') && amount !== undefined) {
      if (!adapterState) return { superseded: true, reason: 'ADAPTER_GONE' };
      const cap = adapterState.balance < adapterState.availableLiquidity ? adapterState.balance : adapterState.availableLiquidity;
      if (cap < amount) amount = cap;
      if (amount <= 0n) return { superseded: true, reason: 'NOTHING_WITHDRAWABLE' };
    }
    return amount === undefined ? { superseded: false } : { superseded: false, amount };
  }
}

export type { ActionRecord };
