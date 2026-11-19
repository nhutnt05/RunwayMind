'use client';

import { useEffect, useRef, useState } from 'react';
import { formatUsdc } from '@runwaymind/shared';
import { StatCard } from '@/components/ui';
import { TrendUpIcon } from '@/components/ui/icons';
import { useOverview } from '@/hooks/useApiQueries';
import { isDust, signedUsdc, tickAccruedYield, weightedApyBps } from '@/lib/insights';
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
    // No current value (indexer syncing / not run): drop the old sync point so a stale number is never animated.
    if (!o?.accruedYield) {
      sync.current = null;
      return;
    }
    const s = sync.current;
    // Re-sync at most every 10 s (overview refetches every 5 s) or when the vault balance changes.
    if (!s || Date.now() - s.at >= RESYNC_MS || s.vault !== BigInt(o.vaultTotal)) {
      sync.current = { base: BigInt(o.accruedYield), vault: BigInt(o.vaultTotal), apy: weightedApyBps(o.adapters), at: Date.now() };
    }
  }, [o]);

  // Animate only once there is something to animate (no 4 Hz re-renders while loading / before the indexer runs).
  const live = Boolean(o?.accruedYield);
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [live]);

  const s = sync.current;
  const value = o?.accruedYield && s ? tickAccruedYield(s.base, s.vault, s.apy, (now - s.at) / 1000) : null;
  const decimals = o?.asset.decimals ?? 6;
  const vault = o ? BigInt(o.vaultTotal) : 0n;
  const syncing = o?.accruedYieldStatus === 'SYNCING';
  const tone = value === null || value === 0n ? 'text-slate-900' : value > 0n ? 'text-emerald-700' : 'text-red-700';
  return (
    <StatCard
      title="Accrued yield"
      icon={<TrendUpIcon className="h-4 w-4" />}
      accent="emerald"
      value={
        // aria-live off: the 4 Hz animation must not be announced; the value is still readable on demand.
        <span aria-live="off" className={tone}>
          {value === null ? '—' : signedUsdc(value, decimals, 6)}
          {value === null ? null : <span className="ml-1 text-sm font-normal text-slate-600">USDC</span>}
        </span>
      }
      subLabel={
        value !== null && o ? (
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
            {isDust(vault, decimals)
              ? 'Live · grows once funds are invested'
              : `Live · vault ${formatUsdc(vault, decimals)} at ${bpsToPercentText(weightedApyBps(o.adapters))}% APY`}
            {o.accruedYieldStatus === 'LIVE' ? (
              <span className="text-slate-500" title="The event history is still syncing; this value already includes the app's recent transactions.">
                · history syncing
              </span>
            ) : null}
          </span>
        ) : syncing ? (
          `Syncing on-chain history… ${o?.indexerLagBlocks ? `${o.indexerLagBlocks.toLocaleString('en-US')} blocks behind` : ''}`.trim()
        ) : overview.isLoading ? null : (
          'Available once the event indexer runs'
        )
      }
    />
  );
}
