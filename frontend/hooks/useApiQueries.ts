'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
  AGENT_ACTIVITY_LIMIT,
  agentActivityQuery,
  agentSettingsQuery,
  cashLadderQuery,
  keeperStatusQuery,
  obligationsQuery,
  overviewQuery,
  transactionsQuery,
  withdrawalScheduleQuery,
  type TransactionFilters,
} from '@/lib/queries';
import type { Address, PoolRiskBand } from '@runwaymind/shared';

// docs/08 §5: dashboard data refreshes every 5 s.
const DASHBOARD_REFRESH_MS = 5_000;

export function useOverview() {
  return useQuery({ ...overviewQuery(), refetchInterval: DASHBOARD_REFRESH_MS });
}

export function useActiveObligations() {
  return useQuery({ ...obligationsQuery('ACTIVE'), refetchInterval: DASHBOARD_REFRESH_MS });
}

export function useWithdrawalSchedule() {
  return useQuery({ ...withdrawalScheduleQuery(), refetchInterval: DASHBOARD_REFRESH_MS });
}

// ---- D4 pages (docs/08 §3.4, §3.8–§3.10) ---------------------------------------------------------------------------

export function useCashLadder(projectionDays: number, includeYield: boolean) {
  return useQuery({ ...cashLadderQuery(projectionDays, includeYield), refetchInterval: DASHBOARD_REFRESH_MS });
}

export function useTransactions(filters: TransactionFilters) {
  return useQuery({ ...transactionsQuery(filters), refetchInterval: 10_000 });
}

export function useAgentActivity(limit = AGENT_ACTIVITY_LIMIT) {
  return useQuery({ ...agentActivityQuery(limit), refetchInterval: DASHBOARD_REFRESH_MS });
}

export function useKeeperStatus() {
  return useQuery({ ...keeperStatusQuery(), refetchInterval: DASHBOARD_REFRESH_MS });
}

export function useAgentSettings() {
  return useQuery(agentSettingsQuery());
}

// ---- D5 (docs/08 §3.6) -------------------------------------------------------------------------------------

export interface PoolJson {
  address: Address;
  name: string;
  status: string;
  balance: string;
  apyBps: number;
  paused: boolean;
  availableLiquidity: string;
  utilizationBps: number;
  tvl: string;
  riskScore: number;
  band: PoolRiskBand;
}

export interface PoolDetailJson extends PoolJson {
  risk: { score: number; band: PoolRiskBand; components: { utilization: number; apyVolatility: number; tvl: number; paused: boolean }; weights: Record<string, number>; samplesUsed: number };
  samples: { sampledAt: number; apyBps: number; utilizationBps: number; tvl: string; paused: boolean }[];
  riskHistory: { computedAt: number; score: number; band: PoolRiskBand }[];
}

export const poolsQuery = () => ({ queryKey: ['pools'] as const, queryFn: () => api.get<PoolJson[]>('/pools') });

export function usePools() {
  return useQuery({ ...poolsQuery(), refetchInterval: 10_000 });
}

export function usePool(adapter: string) {
  return useQuery({ queryKey: ['pools', adapter], queryFn: () => api.get<PoolDetailJson>(`/pools/${adapter}`), refetchInterval: 10_000 });
}

