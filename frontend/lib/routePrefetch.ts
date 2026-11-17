// Sidebar hover/focus prefetch: warms the TanStack Query cache with the API data a route renders first, so the page
// shows real data (not skeletons) the moment it mounts. `prefetchQuery` skips entries that are still fresh (default
// staleTime) and dedupes in-flight fetches, so repeated hovers cost nothing. Entries stay scoped per selected
// treasury by the QueryClient's queryKeyHashFn; only public treasury data is prefetched (no wallet-specific data).
import type { QueryClient } from '@tanstack/react-query';
import { poolsQuery } from '@/hooks/useApiQueries';
import {
  CASH_LADDER_DEFAULTS,
  agentActivityQuery,
  agentSettingsQuery,
  cashLadderQuery,
  keeperStatusQuery,
  obligationsQuery,
  overviewQuery,
  pendingRecommendationsQuery,
  transactionsQuery,
  withdrawalScheduleQuery,
} from '@/lib/queries';

interface QueryDef {
  queryKey: readonly unknown[];
  queryFn: () => Promise<unknown>;
}

/** Queries each route issues on mount, with the same keys and default arguments as the page. */
export const ROUTE_QUERIES: Record<string, () => QueryDef[]> = {
  '/': () => [overviewQuery(), obligationsQuery('ACTIVE'), withdrawalScheduleQuery(), pendingRecommendationsQuery()],
  '/treasury': () => [overviewQuery()],
  '/obligations': () => [overviewQuery(), obligationsQuery('ACTIVE')],
  '/cash-ladder': () => [overviewQuery(), cashLadderQuery(CASH_LADDER_DEFAULTS.projectionDays, CASH_LADDER_DEFAULTS.includeYield)],
  '/vault': () => [overviewQuery()],
  '/pools': () => [overviewQuery(), poolsQuery()],
  '/agent': () => [agentActivityQuery(), keeperStatusQuery(), agentSettingsQuery()],
  '/transactions': () => [transactionsQuery({ kind: undefined, status: undefined, cursor: null }), keeperStatusQuery()],
  '/settings': () => [overviewQuery(), agentSettingsQuery()],
};

export function prefetchRouteData(queryClient: QueryClient, href: string): void {
  for (const q of ROUTE_QUERIES[href]?.() ?? []) {
    // Errors are ignored here: the page's own query retries and shows its error state.
    void queryClient.prefetchQuery(q).catch(() => undefined);
  }
}
