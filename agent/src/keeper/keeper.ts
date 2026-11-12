// Keeper loop (docs/05 §10.1, REQ-047). Uses the KEEPER key, which holds NO role: it can only call the public
// `enforceDeadlines()` and `pay(id)`. Every run is recorded as a KeeperRun; transactions are tracked.
import type { Address, PublicClient } from 'viem';
import { obligationRegistryAbi, treasuryAbi } from '@runwaymind/shared/abi';
import { decodeTrackedLogs } from '../chain/events';
import { toObligation, type CoreAddresses } from '../chain/reader';
import { AuditLogger, silentLogger, type Logger } from '../audit/audit';
import { NonceQueue } from '../executor/nonceQueue';
import {
  DEFAULT_RECEIPT_TIMEOUT_MS,
  DEFAULT_RETRY_DELAYS_MS,
  SendRevertedError,
  errorMessage,
  sendAndConfirm,
  simulateCall,
  type AgentWallet,
} from '../executor/send';
import type { AgentStore, KeeperRunError } from '../orchestrator/store';

export const MAX_PAYS_PER_TICK = 5;

const isInsufficientLiquidity = (e: KeeperRunError['error']): boolean => typeof e === 'object' && e !== null && e.name === 'InsufficientLiquidity';

export interface KeeperDeps {
  client: PublicClient;
  wallet: AgentWallet;
  addresses: CoreAddresses;
  store: AgentStore;
  audit: AuditLogger;
  queue?: NonceQueue;
  maxPaysPerTick?: number;
  retryDelaysMs?: readonly number[];
  receiptTimeoutMs?: number;
  log?: Logger;
  now?: () => Date;
}

export interface KeeperRunResult {
  id: string;
  chainTime: number;
  shortfallBefore: bigint;
  enforced: boolean;
  paidIds: bigint[];
  txHashes: string[];
  errors: KeeperRunError[];
  startedAt: Date;
  finishedAt: Date;
}

export function createKeeper(deps: KeeperDeps) {
  const queue = deps.queue ?? new NonceQueue(deps.client, deps.wallet.account.address);
  const delays = deps.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const maxPays = deps.maxPaysPerTick ?? MAX_PAYS_PER_TICK;
  const log = deps.log ?? silentLogger;
  const now = deps.now ?? (() => new Date());
  const t = { address: deps.addresses.treasury, abi: treasuryAbi } as const;
  const r = { address: deps.addresses.registry, abi: obligationRegistryAbi } as const;

  type Outcome = { ok: true; hash: string } | { ok: false; error: KeeperRunError['error']; hash?: string };

  async function send(functionName: 'enforceDeadlines' | 'pay', args: readonly unknown[], runId: string): Promise<Outcome> {
    const call = { ...t, functionName, args };
    const sim = await simulateCall(deps.client, deps.wallet.account, call, delays);
    if (!sim.ok) return { ok: false, error: sim.error ?? sim.message };
    const kind = functionName === 'pay' ? 'PAY' : 'ENFORCE_DEADLINES';
    const base = { kind, from: deps.wallet.account.address, initiator: 'KEEPER', relatedId: runId } as const;
    try {
      const { hash, receipt } = await sendAndConfirm({
        client: deps.client,
        wallet: deps.wallet,
        queue,
        call,
        delays,
        receiptTimeoutMs: deps.receiptTimeoutMs ?? DEFAULT_RECEIPT_TIMEOUT_MS,
        onSent: (h) =>
          deps.store.upsertTransaction({ ...base, hash: h, status: 'PENDING', blockNumber: null, decodedEvents: null, error: null }),
      });
      const ok = receipt.status === 'success';
      await deps.store.upsertTransaction({
        ...base,
        hash,
        status: ok ? 'CONFIRMED' : 'REVERTED',
        blockNumber: receipt.blockNumber,
        decodedEvents: decodeTrackedLogs(receipt.logs, deps.addresses),
        error: ok ? null : { name: 'TransactionReverted' },
        confirmedAt: new Date(),
      });
      return ok ? { ok: true, hash } : { ok: false, error: 'TransactionReverted', hash };
    } catch (e) {
      return { ok: false, error: e instanceof SendRevertedError && e.decoded ? e.decoded : errorMessage(e) };
    }
  }

  async function readState() {
    const blockNumber = await deps.client.getBlockNumber({ cacheTime: 0 });
    const [chainTime, shortfall, ids] = (await Promise.all([
      deps.client.readContract({ ...t, functionName: 'currentTime', blockNumber }),
      deps.client.readContract({ ...t, functionName: 'shortfall', blockNumber }),
      deps.client.readContract({ ...r, functionName: 'getActiveObligationIds', blockNumber }),
    ])) as [bigint, bigint, readonly bigint[]];
    return { chainTime: Number(chainTime), shortfall, ids };
  }

  async function readObligation(id: bigint) {
    const raw = await deps.client.readContract({ ...r, functionName: 'getObligation', args: [id] });
    return toObligation(raw as Parameters<typeof toObligation>[0]);
  }

  /** One keeper pass: enforceDeadlines() if shortfall > 0, then pay every due obligation (≤ maxPays per tick). */
  async function tick(): Promise<KeeperRunResult> {
    return queue.run(async () => {
      const startedAt = now();
      const state = await readState();
      const runId = await deps.store.startKeeperRun({ chainTime: state.chainTime, shortfallBefore: state.shortfall, startedAt });
      const errors: KeeperRunError[] = [];
      const paidIds: bigint[] = [];
      const txHashes: string[] = [];
      let enforced = false;

      try {
        // R2: pull any overdue reserve shortfall back from the adapters.
        if (state.shortfall > 0n) {
          const res = await send('enforceDeadlines', [], runId);
          if (res.hash) txHashes.push(res.hash);
          if (res.ok) {
            enforced = true;
            await deps.audit.record('KEEPER_ENFORCE', { txHash: res.hash, shortfallBefore: state.shortfall, chainTime: state.chainTime }, {
              actor: deps.wallet.account.address,
              entityType: 'KEEPER',
              entityId: runId,
            });
          } else {
            errors.push({ step: 'enforceDeadlines', error: res.error });
          }
        }

        // Pay due obligations, oldest first; recurring ones repeat while still due (bounded per tick).
        const obligations = await Promise.all(state.ids.map((id) => readObligation(id)));
        const due = obligations
          .filter((o) => o.status === 'ACTIVE' && o.nextDueDate <= state.chainTime)
          .sort((a, b) => a.nextDueDate - b.nextDueDate || (a.id < b.id ? -1 : 1));
        let pays = 0;
        for (const ob of due) {
          let current = ob;
          while (current.status === 'ACTIVE' && current.nextDueDate <= state.chainTime && pays < maxPays) {
            let res = await send('pay', [current.id], runId);
            if (res.hash) txHashes.push(res.hash);
            // docs/01 §9: pay() reverts InsufficientLiquidity → enforceDeadlines() then retry the pay once; else alert.
            if (!res.ok && isInsufficientLiquidity(res.error)) {
              const enf = await send('enforceDeadlines', [], runId);
              if (enf.hash) txHashes.push(enf.hash);
              if (enf.ok) {
                enforced = true;
                await deps.audit.record(
                  'KEEPER_ENFORCE',
                  { txHash: enf.hash, trigger: 'PAY_INSUFFICIENT_LIQUIDITY', obligationId: current.id, chainTime: state.chainTime },
                  { actor: deps.wallet.account.address, entityType: 'KEEPER', entityId: runId },
                );
              } else {
                errors.push({ step: 'enforceDeadlines', error: enf.error });
              }
              res = await send('pay', [current.id], runId);
              if (res.hash) txHashes.push(res.hash);
              if (!res.ok) log.error('keeper alert: pay still failing after enforceDeadlines retry', { obligationId: current.id, error: res.error });
            }
            if (!res.ok) {
              errors.push({ step: 'pay', obligationId: current.id.toString(), error: res.error });
              log.warn('keeper pay failed', { obligationId: current.id, error: res.error });
              break;
            }
            pays += 1;
            paidIds.push(current.id);
            await deps.audit.record('KEEPER_PAY', { obligationId: current.id, txHash: res.hash, chainTime: state.chainTime }, {
              actor: deps.wallet.account.address,
              entityType: 'OBLIGATION',
              entityId: current.id.toString(),
            });
            current = await readObligation(current.id);
          }
          if (pays >= maxPays) break;
        }
      } catch (e) {
        errors.push({ step: 'read', error: errorMessage(e) });
      }

      const finishedAt = now();
      await deps.store.finishKeeperRun(runId, { finishedAt, enforced, paidIds, txHashes, errors });
      return { id: runId, chainTime: state.chainTime, shortfallBefore: state.shortfall, enforced, paidIds, txHashes, errors, startedAt, finishedAt };
    });
  }

  return { tick, address: deps.wallet.account.address as Address, queue };
}

export type Keeper = ReturnType<typeof createKeeper>;
