// Sidebar hover/focus prefetch: every route has an entry, entries use the same keys as the pages' hooks, and fresh
// cache entries are not refetched.
import { QueryClient, hashKey } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { ROUTE_QUERIES, prefetchRouteData } from '../lib/routePrefetch';
import { CASH_LADDER_DEFAULTS, obligationsQuery, overviewQuery, transactionsQuery } from '../lib/queries';
import { APP_ROUTES } from '../lib/routes';

describe('route data prefetch', () => {
  it('has an entry for every sidebar route and nothing else', () => {
    expect(Object.keys(ROUTE_QUERIES).sort()).toEqual(APP_ROUTES.map((r) => r.href).sort());
  });

  it('uses the pages’ query keys (incl. default filters)', () => {
    const keys = (href: string) => ROUTE_QUERIES[href]!().map((q) => hashKey(q.queryKey as unknown[]));
    expect(keys('/obligations')).toContain(hashKey([...obligationsQuery('ACTIVE').queryKey]));
    expect(keys('/treasury')).toEqual([hashKey([...overviewQuery().queryKey])]);
    // app/transactions/page.tsx: useTransactions({ kind: undefined, status: undefined, cursor: null })
    expect(keys('/transactions')).toContain(hashKey(['transactions', { kind: undefined, status: undefined, cursor: null }]));
    expect(keys('/transactions')).toContain(hashKey([...transactionsQuery({ cursor: null }).queryKey]));
    expect(keys('/cash-ladder')).toContain(hashKey(['cash-ladder', CASH_LADDER_DEFAULTS.projectionDays, CASH_LADDER_DEFAULTS.includeYield]));
  });

  it('fetches each query once and skips entries that are still fresh', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 5_000, retry: false } } });
    const fetchFn = vi.fn(async () => ({ data: {}, meta: {} }));
    const original = ROUTE_QUERIES['/treasury']!;
    ROUTE_QUERIES['/treasury'] = () => [{ queryKey: ['overview'], queryFn: fetchFn }];
    try {
      prefetchRouteData(qc, '/treasury');
      prefetchRouteData(qc, '/treasury'); // in-flight → deduped
      await vi.waitFor(() => expect(qc.getQueryData(['overview'])).toBeDefined());
      prefetchRouteData(qc, '/treasury'); // fresh → skipped
      await new Promise((r) => setTimeout(r, 10));
      expect(fetchFn).toHaveBeenCalledTimes(1);
    } finally {
      ROUTE_QUERIES['/treasury'] = original;
    }
  });

  it('ignores unknown routes', () => {
    const qc = new QueryClient();
    expect(() => prefetchRouteData(qc, '/nope')).not.toThrow();
  });
});
