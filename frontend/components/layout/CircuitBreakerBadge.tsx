'use client';

import { useTreasuryReads } from '@/hooks/useTreasuryReads';

/** Treasury.circuitBreakerActive() (R6). */
export function CircuitBreakerBadge() {
  const { data } = useTreasuryReads();
  if (!data?.circuitBreakerActive) return null;
  return (
    <span role="status" className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-800">
      <span aria-hidden>⛔ </span>Circuit breaker active
    </span>
  );
}
