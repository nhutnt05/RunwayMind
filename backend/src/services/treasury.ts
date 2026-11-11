// Read services for /treasury/overview, /obligations, /cash-ladder (docs/07 §4.1–§4.3).
// All financial numbers come from agent engines (rule 4); this layer only joins chain data with off-chain metadata.
import {
  baselineRunwayInput,
  computeCashLadder,
  computeRunway,
  expandOccurrences,
  riskScoreOf,
  withdrawalDeadline,
} from '@runwaymind/agent';
import type {
  ChainSnapshot,
  ObligationDerivedState,
  ObligationOnChain,
  CashLadderOptions,
} from '@runwaymind/shared';
import { notFound } from '../errors';
import type { Repositories, MetadataView } from '../repositories';
import type { ChainService } from './chain';

const DAY = 86_400;

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

export function createTreasuryService(chain: ChainService, repos: Repositories) {
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
        // null until the event indexer (D3-B2) has populated principal accounting
        accruedYield: principal.indexed ? ladder.vaultTotal - principal.principal : null,
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
          riskScore: riskScoreOf(a, []),
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
