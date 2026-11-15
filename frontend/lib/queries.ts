// Shared query definitions (key + fetcher) used by the hooks in hooks/useApiQueries.ts and by the sidebar's
// hover/focus prefetch (lib/routePrefetch.ts), so a prefetched entry is exactly the one the page reads.
// Cache entries are still scoped per selected treasury by the QueryClient's queryKeyHashFn (app/providers.tsx).
import {
  api,
  type AgentDecisionJson,
  type AgentSettingsJson,
  type CashLadderJson,
  type KeeperStatusJson,
  type ObligationItem,
  type TransactionItemJson,
  type TreasuryOverview,
  type WithdrawalScheduleJson,
} from '@/lib/api';
import type { ActivityItemJson } from '@/lib/views';

export const overviewQuery = () => ({
  queryKey: ['overview'] as const,
  queryFn: () => api.get<TreasuryOverview>('/treasury/overview'),
});

export const obligationsQuery = (status: string) => ({
  queryKey: ['obligations', status] as const,
  queryFn: () => api.get<ObligationItem[]>(`/obligations?status=${status}`),
});

export const withdrawalScheduleQuery = () => ({
  queryKey: ['cash-ladder', 'withdrawal-schedule'] as const,
  queryFn: () => api.get<WithdrawalScheduleJson>('/cash-ladder/withdrawal-schedule'),
});

/** Defaults of the Cash Ladder page controls (app/cash-ladder/page.tsx). */
export const CASH_LADDER_DEFAULTS = { projectionDays: 60, includeYield: true } as const;

export const cashLadderQuery = (projectionDays: number, includeYield: boolean) => ({
  queryKey: ['cash-ladder', projectionDays, includeYield] as const,
  queryFn: () => api.get<CashLadderJson>(`/cash-ladder?projectionDays=${projectionDays}&includeYield=${includeYield}`),
});

export interface TransactionFilters {
  kind?: string;
  status?: string;
  cursor?: string | null;
  limit?: number;
}

export const transactionsQuery = (filters: TransactionFilters) => {
  const qs = new URLSearchParams({ limit: String(filters.limit ?? 20) });
  if (filters.kind) qs.set('kind', filters.kind);
  if (filters.status) qs.set('status', filters.status);
  if (filters.cursor) qs.set('cursor', filters.cursor);
  return {
    queryKey: ['transactions', filters] as const,
    queryFn: () => api.get<TransactionItemJson[]>(`/transactions?${qs.toString()}`),
  };
};

/** GET /agent/activity returns at most 100 items (API cap); the Activity list pages through them client-side. */
export const AGENT_ACTIVITY_LIMIT = 100;

export const agentActivityQuery = (limit: number = AGENT_ACTIVITY_LIMIT) => ({
  queryKey: ['agent', 'activity', limit] as const,
  queryFn: () => api.get<ActivityItemJson[]>(`/agent/activity?limit=${limit}`),
});

export const keeperStatusQuery = () => ({
  queryKey: ['keeper', 'status'] as const,
  queryFn: () => api.get<KeeperStatusJson>('/keeper/status'),
});

export const agentSettingsQuery = () => ({
  queryKey: ['agent', 'settings'] as const,
  queryFn: () => api.get<AgentSettingsJson>('/agent/settings'),
});

export const pendingRecommendationsQuery = () => ({
  queryKey: ['recommendations', 'PENDING_APPROVAL'] as const,
  queryFn: () => api.get<AgentDecisionJson[]>('/recommendations?status=PENDING_APPROVAL'),
});
