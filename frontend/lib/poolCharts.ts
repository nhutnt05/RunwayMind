// Display helpers for the Pool Risk Dashboard charts (formatting only, docs/14 §2). Times are chain timestamps (UTC).
import { dayLabel, SECONDS_PER_DAY } from '@/lib/dashboard';

export type Band = 'HEALTHY' | 'WATCH' | 'CRITICAL';

export interface ScorePoint {
  t: number;
  score: number;
  /** Band as computed by the agent (not re-derived here). */
  band: Band;
}

export interface MetricPoint {
  t: number;
  /** Percent values for chart geometry (bps / 100); the tooltip formats them to 2 decimals. */
  apy: number;
  util: number;
}

/** Oldest → newest; duplicate timestamps keep the last value. */
export function scoreSeries(history: readonly { computedAt: number; score: number; band: Band }[]): ScorePoint[] {
  const byT = new Map<number, ScorePoint>();
  for (const h of history) byT.set(h.computedAt, { t: h.computedAt, score: h.score, band: h.band });
  return [...byT.values()].sort((a, b) => a.t - b.t);
}

export function metricSeries(samples: readonly { sampledAt: number; apyBps: number; utilizationBps: number }[]): MetricPoint[] {
  const byT = new Map<number, MetricPoint>();
  for (const s of samples) byT.set(s.sampledAt, { t: s.sampledAt, apy: s.apyBps / 100, util: s.utilizationBps / 100 });
  return [...byT.values()].sort((a, b) => a.t - b.t);
}

const hhmm = (t: number) => {
  const d = new Date(t * 1000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};

/** Axis tick: DD/MM when the chart spans more than a week, otherwise DD/MM HH:mm (so ticks on the same day stay distinct). */
export function timeTick(t: number, spanSec: number): string {
  const day = dayLabel(t).slice(0, 5);
  return spanSec > 7 * SECONDS_PER_DAY ? day : `${day} ${hhmm(t)}`;
}

/** Tooltip heading: DD/MM/YY HH:mm UTC. */
export function timeFull(t: number): string {
  return `${dayLabel(t)} ${hhmm(t)} UTC`;
}
