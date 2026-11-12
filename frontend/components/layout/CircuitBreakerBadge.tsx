'use client';

import { useTreasuryReads } from '@/hooks/useTreasuryReads';

/** Treasury.circuitBreakerActive() (R6). White on red-700 (≈ 6.5:1) with an icon, not color alone. */
export function CircuitBreakerBadge() {
  const { data } = useTreasuryReads();
  if (!data?.circuitBreakerActive) return null;
  return (
    <span role="status" className="whitespace-nowrap rounded-full bg-red-700 px-3 py-1 text-sm font-bold text-white ring-2 ring-red-900">
      <span aria-hidden>⛔ </span>Circuit breaker active
    </span>
  );
}
