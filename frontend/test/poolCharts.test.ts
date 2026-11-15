import { describe, expect, it } from 'vitest';
import { metricSeries, scoreSeries, timeFull, timeTick } from '../lib/poolCharts';

const T = Date.UTC(2026, 10, 15, 9, 5) / 1000; // 15/11/26 09:05 UTC
const DAY = 86_400;

describe('Pool Risk Dashboard chart helpers', () => {
  it('scoreSeries sorts by time, keeps the agent band, last value wins on duplicate times', () => {
    const s = scoreSeries([
      { computedAt: T + 60, score: 50, band: 'WATCH' },
      { computedAt: T, score: 80, band: 'HEALTHY' },
      { computedAt: T + 60, score: 35, band: 'CRITICAL' },
    ]);
    expect(s).toEqual([
      { t: T, score: 80, band: 'HEALTHY' },
      { t: T + 60, score: 35, band: 'CRITICAL' },
    ]);
  });

  it('metricSeries converts bps to percent for geometry, sorted by time', () => {
    expect(metricSeries([{ sampledAt: T + 60, apyBps: 900, utilizationBps: 6000 }, { sampledAt: T, apyBps: 825, utilizationBps: 5000 }])).toEqual([
      { t: T, apy: 8.25, util: 50 },
      { t: T + 60, apy: 9, util: 60 },
    ]);
  });

  it('time labels: DD/MM for long spans, DD/MM HH:mm for short ones, full UTC in the tooltip', () => {
    expect(timeTick(T, 10 * DAY)).toBe('15/11');
    expect(timeTick(T, 3600)).toBe('15/11 09:05');
    expect(timeTick(T, 3 * DAY)).toBe('15/11 09:05'); // a few days: same-day ticks must stay distinct
    expect(timeFull(T)).toBe('15/11/26 09:05 UTC');
  });
});
