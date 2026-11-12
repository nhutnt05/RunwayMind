'use client';

import { useQuery } from '@tanstack/react-query';
import {
  api,
  type AgentSettingsJson,
  type CashLadderJson,
  type KeeperStatusJson,
  type ObligationItem,
  type TransactionItemJson,
  type TreasuryOverview,
  type WithdrawalScheduleJson,
} from '@/lib/api';
import type { Address, PoolRiskBand, RiskClass } from '@runwaymind/shared';
import type { ScenarioJson } from '@/lib/insights';
import type { ActivityItemJson } from '@/lib/views';

// docs/08 §5: dashboard data refreshes every 5 s.
const DASHBOARD_REFRESH_MS = 5_000;

export function useOverview() {
  return useQuery({
    queryKey: ['overview'],
    queryFn: () => api.get<TreasuryOverview>('/treasury/overview'),
    refetchInterval: DASHBOARD_REFRESH_MS,
  });
}

export function useActiveObligations() {
  return useQuery({
    queryKey: ['obligations', 'ACTIVE'],
    queryFn: () => api.get<ObligationItem[]>('/obligations?status=ACTIVE'),
    refetchInterval: DASHBOARD_REFRESH_MS,
  });
}

export function useWithdrawalSchedule() {
  return useQuery({
    queryKey: ['cash-ladder', 'withdrawal-schedule'],
    queryFn: () => api.get<WithdrawalScheduleJson>('/cash-ladder/withdrawal-schedule'),
    refetchInterval: DASHBOARD_REFRESH_MS,
  });
}

// ---- D4 pages (docs/08 §3.4, §3.8–§3.10) ---------------------------------------------------------------------------

export function useCashLadder(projectionDays: number, includeYield: boolean) {
  return useQuery({
    queryKey: ['cash-ladder', projectionDays, includeYield],
    queryFn: () => api.get<CashLadderJson>(`/cash-ladder?projectionDays=${projectionDays}&includeYield=${includeYield}`),
    refetchInterval: DASHBOARD_REFRESH_MS,
  });
}

export function useTransactions(filters: { kind?: string; status?: string; cursor?: string | null; limit?: number }) {
  const qs = new URLSearchParams({ limit: String(filters.limit ?? 20) });
  if (filters.kind) qs.set('kind', filters.kind);
  if (filters.status) qs.set('status', filters.status);
  if (filters.cursor) qs.set('cursor', filters.cursor);
  return useQuery({
    queryKey: ['transactions', filters],
    queryFn: () => api.get<TransactionItemJson[]>(`/transactions?${qs.toString()}`),
    refetchInterval: 10_000,
  });
}

export function useAgentActivity(limit = 50) {
  return useQuery({
    queryKey: ['agent', 'activity', limit],
    queryFn: () => api.get<ActivityItemJson[]>(`/agent/activity?limit=${limit}`),
    refetchInterval: DASHBOARD_REFRESH_MS,
  });
}

export function useKeeperStatus() {
  return useQuery({
    queryKey: ['keeper', 'status'],
    queryFn: () => api.get<KeeperStatusJson>('/keeper/status'),
    refetchInterval: DASHBOARD_REFRESH_MS,
  });
}

export function useAgentSettings() {
  return useQuery({
    queryKey: ['agent', 'settings'],
    queryFn: () => api.get<AgentSettingsJson>('/agent/settings'),
  });
}

// ---- D5 (docs/08 §2, §3.6, §3.7) -------------------------------------------------------------------------------------

export interface RunwayJson {
  baseline: ScenarioJson['runway'];
  worstCase: { id: string; runwayDays: number; classification: RiskClass } | null;
  lastStressTestId: string | null;
}

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

export interface StressTestJson {
  id: string;
  ranAt: number;
  baseline: ScenarioJson;
  scenarios: ScenarioJson[];
  worstCase: string;
  overallClassification: RiskClass;
  createdAt: number;
}

export interface InflowJson {
  id: string;
  label: string;
  amount: string;
  expectedDate: number;
}

export function useRunway() {
  return useQuery({ queryKey: ['runway'], queryFn: () => api.get<RunwayJson>('/runway'), refetchInterval: DASHBOARD_REFRESH_MS });
}

export function usePools() {
  return useQuery({ queryKey: ['pools'], queryFn: () => api.get<PoolJson[]>('/pools'), refetchInterval: 10_000 });
}

export function usePool(adapter: string) {
  return useQuery({ queryKey: ['pools', adapter], queryFn: () => api.get<PoolDetailJson>(`/pools/${adapter}`), refetchInterval: 10_000 });
}

export function useLatestStressTest() {
  return useQuery({
    queryKey: ['stress-tests', 'latest'],
    queryFn: async () => (await api.get<StressTestJson[]>('/stress-tests?limit=1')).data[0] ?? null,
  });
}

export function useInflows() {
  return useQuery({ queryKey: ['inflows'], queryFn: () => api.get<InflowJson[]>('/inflows') });
}
