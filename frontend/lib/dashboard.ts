// Display helpers only (docs/14 §2: the frontend performs no financial calculations, formatting only).
import { bpsToPercent } from '@runwaymind/shared';

export const SECONDS_PER_DAY = 86_400;

/** "Day N" label (docs/04 §4.1): N = floor((t − T0) / 86400), T0 = demoStartTime. */
export function dayIndex(t: number, t0: number | null | undefined): number | null {
  if (t0 === null || t0 === undefined) return null;
  return Math.floor((t - t0) / SECONDS_PER_DAY);
}

/**
 * Calendar date of a chain timestamp as DD/MM/YY (UTC, like every other chain time in the UI).
 * Replaces the earlier "Day N" label so users see a real date; `_t0` is kept so existing call sites stay unchanged.
 * The DEMO MODE badge still shows "Day N" via dayIndex.
 */
export function dayLabel(t: number, _t0?: number | null): string {
  const d = new Date(t * 1000);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yy = String(d.getUTCFullYear() % 100).padStart(2, '0');
  return `${dd}/${mm}/${yy}`;
}

/** Relative countdown in whole days from chain time: "in 5 days", "today", "2 days ago". */
export function countdown(target: number, now: number): string {
  const d = Math.floor((target - now) / SECONDS_PER_DAY);
  if (target >= now && d === 0) return 'today';
  if (target < now) {
    const ago = Math.ceil((now - target) / SECONDS_PER_DAY);
    return ago <= 1 ? 'due' : `${ago} days ago`;
  }
  return d === 1 ? 'in 1 day' : `in ${d} days`;
}

/** "70% invested (target 70%)" — docs/08 §2 EfficiencyGauge. Inputs are engine-computed bps. */
export function efficiencyLabel(actualBps: number, targetBps: number): string {
  const pct = (bps: number) => bpsToPercent(bps).replace(/\.00$/, '');
  return `${pct(actualBps)}% invested (target ${pct(targetBps)}%)`;
}

/** Position (0–100 %) of `t` on a [start, end] timeline, clamped. */
export function timelinePosition(t: number, start: number, end: number): number {
  if (end <= start) return 0;
  return Math.min(100, Math.max(0, ((t - start) / (end - start)) * 100));
}
