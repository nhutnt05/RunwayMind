'use client';

import { useQuery } from '@tanstack/react-query';
import { api, type ObligationItem, type TreasuryOverview, type WithdrawalScheduleJson } from '@/lib/api';

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
