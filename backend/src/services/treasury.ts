// Read services for /treasury/overview, /obligations, /cash-ladder (docs/07 §4.1–§4.3).
// All financial numbers come from agent engines (rule 4); this layer only joins chain data with off-chain metadata.
import {
  baselineRunwayInput,
  computeCashLadder,
  computeRunway,
  expandOccurrences,
  computeSnapshotRisks,
  riskScoreOf,
  type AgentStore,
  type DecodedEvent,
  withdrawalDeadline,
} from '@runwaymind/agent';
import type { Address, Hex } from 'viem';
import type {
  ChainSnapshot,
  ObligationDerivedState,
  ObligationOnChain,
  CashLadderOptions,
} from '@runwaymind/shared';
import { notFound } from '../errors';
import { pulledIntoTreasury } from '../indexer';
import { principalDelta, type Repositories, type MetadataView } from '../repositories';
import type { ChainService } from './chain';

const DAY = 86_400;

/** Blocks the event indexer may trail the snapshot by and still count as fully synced (a few polls on Fuji). */
export const ACCRUED_YIELD_MAX_LAG_BLOCKS = 50n;

export type AccruedYieldStatus = 'OK' | 'LIVE' | 'SYNCING' | 'NOT_INDEXED';

/**
 * Accrued yield = vault balance − net principal (invested − withdrawn).
 * Net principal = indexed events up to the indexer cursor + `gapPrincipal`, the principal change of the app's own
 * confirmed transactions mined after the cursor (null when it could not be computed).
 *  - OK: indexer in sync.
 *  - LIVE: indexer still catching up, value includes the app's recent transactions (provisional until synced).
 *  - SYNCING: indexer behind and the gap could not be computed → no number rather than a wrong one.
 *  - NOT_INDEXED: the indexer has never run.
 */
export function accruedYieldView(
  principal: { indexed: boolean; principal: bigint; lastBlock: bigint | null },
  snapshotBlock: bigint,
  vaultTotal: bigint,
  gapPrincipal: bigint | null = 0n,
): { accruedYield: bigint | null; accruedYieldStatus: AccruedYieldStatus; indexerLagBlocks: number | null } {
  if (!principal.indexed || principal.lastBlock === null) return { accruedYield: null, accruedYieldStatus: 'NOT_INDEXED', indexerLagBlocks: null };
  const lag = snapshotBlock > principal.lastBlock ? snapshotBlock - principal.lastBlock : 0n;
  const synced = lag <= ACCRUED_YIELD_MAX_LAG_BLOCKS;
  if (gapPrincipal === null) {
    return synced
      ? { accruedYield: vaultTotal - principal.principal, accruedYieldStatus: 'OK', indexerLagBlocks: Number(lag) }
      : { accruedYield: null, accruedYieldStatus: 'SYNCING', indexerLagBlocks: Number(lag) };
  }
  return { accruedYield: vaultTotal - principal.principal - gapPrincipal, accruedYieldStatus: synced ? 'OK' : 'LIVE', indexerLagBlocks: Number(lag) };
}

/** docs/07 §4.2 derivedState. DUE = due within the current day; OVERDUE = at least one day past due. */
export function derivedState(ob: ObligationOnChain, now: number, safetyHorizonSec: number): ObligationDerivedState {
  if (ob.status === 'CANCELLED') return 'CANCELLED';
  if (ob.status === 'COMPLETED') return 'PAID';
  if (ob.nextDueDate <= now) return now - ob.nextDueDate >= DAY ? 'OVERDUE' : 'DUE';
  if (ob.nextDueDate <= now + safetyHorizonSec) return 'IN_WINDOW';
  return 'SCHEDULED';
}

function obligationItem(ob: ObligationOnChain, s: Pick<ChainSnapshot, 'chainTime' | 'policy'>, meta: MetadataView | undefined) {
  const H = s.policy.safetyHorizonSec;
  return {
    id: ob.id,
    recipient: ob.recipient,
    amount: ob.amount,
    nextDueDate: ob.nextDueDate,
    interval: ob.interval,
    maxOccurrences: ob.maxOccurrences,
    paidOccurrences: ob.paidOccurrences,
    category: ob.category,
    status: ob.status,
    withdrawalDeadline: withdrawalDeadline(ob.nextDueDate, H),
    derivedState: derivedState(ob, s.chainTime, H),
    metadata: meta ?? null,
  };
}

export type ObligationStatusFilter = 'ACTIVE' | 'COMPLETED' | 'CANCELLED' | 'ALL';

/**
 * `store` (optional) supplies PoolMetricSample history so overview risk scores match GET /pools (docs/06 §4.1);
 * without it the current state alone is scored.
 */
export function createTreasuryService(chain: ChainService, repos: Repositories, store?: Pick<AgentStore, 'poolHistory'>) {
  /** Liquidity pulled inside pay() per tx hash (receipt-derived, immutable once mined): avoids refetching receipts. */
  const pulledCache = new Map<string, bigint>();

  /**
   * Principal change from the app's confirmed transactions mined after the indexer cursor. ObligationPaid needs the
   * receipt (liquidity pulled from adapters emits no event of its own); null when a receipt cannot be read.
   */
  async function gapPrincipal(afterBlock: bigint, asset: Address, treasury: Address): Promise<bigint | null> {
    let sum = 0n;
    for (const tx of await repos.confirmedPrincipalTxsAfter(afterBlock)) {
      for (const e of tx.events) if (e.name !== 'ObligationPaid') sum += principalDelta(e.name, e.args);
      if (!tx.events.some((e) => e.name === 'ObligationPaid')) continue;
      let pulled = pulledCache.get(tx.hash);
      if (pulled === undefined) {
        const receipt = await chain.waitForReceipt(tx.hash as Hex, 5_000).catch(() => null);
        if (!receipt) return null;
        pulled = pulledIntoTreasury(receipt.logs, asset, treasury, tx.events as unknown as DecodedEvent[]);
        pulledCache.set(tx.hash, pulled);
      }
      sum -= pulled;
    }
    return sum;
  }

  return {
    async overview() {
      const [s, cfg, inflows, pending, principal, metadata] = await Promise.all([
        chain.getSnapshot(),
        repos.treasuryConfig(),
        repos.inflows(),
        repos.pendingRecommendationCount(),
        repos.netPrincipal(),
        repos.metadataByObligation(),
      ]);
      const ladder = computeCashLadder(s);
      const runway = computeRunway(baselineRunwayInput(s, inflows));
      const risks = store ? (await computeSnapshotRisks(store, s, await repos.agentSettings())).risks : [];
      const next = ladder.occurrences.find((o) => o.dueDate > s.chainTime) ?? null;
      const data = {
        treasury: s.treasury,
        asset: { address: s.asset, symbol: cfg?.assetSymbol ?? 'mUSDC', decimals: s.assetDecimals },
        chainTime: s.chainTime,
        demoMode: s.demoMode,
        demoStartTime: cfg?.demoStartTime ?? null,
        timeOffset: s.timeOffset,
        circuitBreakerActive: s.circuitBreakerActive,
        idle: ladder.idle,
        vaultTotal: ladder.vaultTotal,
        totalAssets: ladder.totalAssets,
        requiredReserve: ladder.requiredReserve,
        shortfall: ladder.shortfall,
        investableCapital: ladder.investableCapital,
        capitalEfficiencyBps: ladder.capitalEfficiencyBps,
        actualEfficiencyBps: ladder.actualEfficiencyBps,
        // vault balance − net principal from indexed Invested/Withdrawn events. Only valid when the indexer has caught
        // up with the snapshot block: a lagging indexer misses recent withdrawals and would report a wrong (even
        // negative) yield, so it is null with status SYNCING until then (null + NOT_INDEXED before the first run).
        ...accruedYieldView(principal, s.blockNumber, ladder.vaultTotal, principal.lastBlock === null ? 0n : await gapPrincipal(principal.lastBlock, s.asset, s.treasury)),
        runway: { runwayDays: runway.runwayDays, capped: runway.capped, classification: runway.classification },
        policy: s.policy,
        adapters: s.adapters.map((a) => ({
          address: a.address,
          name: a.name,
          status: a.status,
          balance: a.balance,
          apyBps: a.apyBps,
          paused: a.paused,
          utilizationBps: a.utilizationBps,
          riskScore: riskScoreOf(a, risks),
        })),
        nextObligation: next
          ? {
              id: next.obligationId,
              label: metadata.get(next.obligationId.toString())?.label ?? null,
              amount: next.amount,
              dueDate: next.dueDate,
            }
          : null,
        pendingRecommendations: pending,
      };
      return { data, chainTime: s.chainTime, blockNumber: s.blockNumber };
    },

    async listObligations(status: ObligationStatusFilter) {
      const [s, all, metadata] = await Promise.all([chain.getSnapshot(), chain.getAllObligations(), repos.metadataByObligation()]);
      const items = all.obligations
        .filter((o) => status === 'ALL' || o.status === status)
        .map((o) => obligationItem(o, s, metadata.get(o.id.toString())));
      return { data: items, chainTime: s.chainTime, blockNumber: all.blockNumber };
    },

    async getObligation(id: bigint) {
      const [s, all, metadata] = await Promise.all([chain.getSnapshot(), chain.getAllObligations(), repos.metadataByObligation()]);
      const ob = all.obligations.find((o) => o.id === id);
      if (!ob) throw notFound(`Obligation ${id}`);
      const H = s.policy.safetyHorizonSec;
      const occurrences =
        ob.status === 'ACTIVE' ? expandOccurrences([ob], s.chainTime, s.chainTime + 5 * 365 * DAY, 12, H) : [];
      const payments = await repos.obligationPayments(id.toString());
      return {
        data: { ...obligationItem(ob, s, metadata.get(id.toString())), occurrences, payments },
        chainTime: s.chainTime,
        blockNumber: all.blockNumber,
      };
    },

    async cashLadder(opts: Pick<CashLadderOptions, 'projectionDays' | 'includeProjectedYield'>) {
      const s = await chain.getSnapshot();
      return { data: computeCashLadder(s, opts), chainTime: s.chainTime, blockNumber: s.blockNumber };
    },

    async withdrawalSchedule() {
      const s = await chain.getSnapshot();
      const ladder = computeCashLadder(s);
      return { data: { items: ladder.withdrawalSchedule }, chainTime: s.chainTime, blockNumber: s.blockNumber };
    },
  };
}

export type TreasuryService = ReturnType<typeof createTreasuryService>;
