'use client';

import { useEffect, useRef, useState } from 'react';
import { formatUsdc } from '@runwaymind/shared';
import { useOverview } from '@/hooks/useApiQueries';
import { tickAccruedYield, weightedApyBps } from '@/lib/insights';
import { bpsToPercentText } from '@/lib/views';

const RESYNC_MS = 10_000;

/**
 * Accrued yield (docs/08 §2): animates locally between refreshes with the pool's simple-accrual formula and re-syncs
 * with the API value every 10 s. The animation is display-only (6 decimals so the movement is visible).
 */
export function AccruedYieldTicker() {
  const overview = useOverview();
  const o = overview.data?.data;
  const sync = useRef<{ base: bigint; vault: bigint; apy: number; at: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!o?.accruedYield) return;
    const s = sync.current;
    // Re-sync at most every 10 s (overview refetches every 5 s) or when the vault balance changes.
    if (!s || Date.now() - s.at >= RESYNC_MS || s.vault !== BigInt(o.vaultTotal)) {
      sync.current = { base: BigInt(o.accruedYield), vault: BigInt(o.vaultTotal), apy: weightedApyBps(o.adapters), at: Date.now() };
    }
  }, [o]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  const s = sync.current;
  const value = s ? tickAccruedYield(s.base, s.vault, s.apy, (now - s.at) / 1000) : null;
  return (
    <section aria-label="Accrued yield" className="h-full rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-medium text-slate-600">Accrued yield</h3>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-emerald-700" aria-live="off">
        {value === null ? '—' : `+${formatUsdc(value, 6, 6)}`}
        {value === null ? null : <span className="ml-1 text-sm font-normal text-slate-600">USDC</span>}
      </p>
      <p className="mt-1 text-xs text-slate-600">
        {o?.accruedYield ? `Vault ${formatUsdc(BigInt(o.vaultTotal))} at ${bpsToPercentText(weightedApyBps(o.adapters))}% APY` : 'Available once the event indexer runs'}
      </p>
    </section>
  );
}
