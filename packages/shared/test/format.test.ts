import { describe, expect, it } from 'vitest';
import {
  applyBps,
  bps,
  bpsToPercent,
  formatUsdc,
  formatUsdcPlain,
  parseUsdc,
  toIsoDateUtc,
  toUtcMidnight,
} from '../src/format';

describe('formatUsdc', () => {
  it('formats the documented example 70,030.68 (docs/08 §2)', () => {
    expect(formatUsdc(70_030_684_931n)).toBe('70,030.68');
  });

  it('formats zero, sub-unit and whole values', () => {
    expect(formatUsdc(0n)).toBe('0.00');
    expect(formatUsdc(1n)).toBe('0.00');
    expect(formatUsdc(10_000n)).toBe('0.01');
    expect(formatUsdc(30_000_000_000n)).toBe('30,000.00');
    expect(formatUsdc(1_000_000_000_000_000n)).toBe('1,000,000,000.00');
  });

  it('truncates (never rounds a balance up)', () => {
    expect(formatUsdc(999_999n)).toBe('0.99');
    expect(formatUsdc(19_999_999n)).toBe('19.99');
  });

  it('supports negative amounts, other decimals and display precision', () => {
    expect(formatUsdc(-4_000_000_000n)).toBe('-4,000.00');
    expect(formatUsdc(1_500_000_000_000_000_000n, 18)).toBe('1.50');
    expect(formatUsdc(123_456_789n, 6, 6)).toBe('123.456789');
    expect(formatUsdc(123_456_789n, 6, 0)).toBe('123');
  });

  it('rejects invalid display precision', () => {
    expect(() => formatUsdc(1n, 6, 7)).toThrow(RangeError);
  });

  it('formatUsdcPlain drops grouping for DecisionFacts strings', () => {
    expect(formatUsdcPlain(70_000_000_000n)).toBe('70000.00');
  });
});

describe('parseUsdc', () => {
  it('parses decimal strings into base units', () => {
    expect(parseUsdc('20000')).toBe(20_000_000_000n);
    expect(parseUsdc('70,030.68')).toBe(70_030_680_000n);
    expect(parseUsdc('0.000001')).toBe(1n);
    expect(parseUsdc(' 1_000.5 ')).toBe(1_000_500_000n);
    expect(parseUsdc('5.')).toBe(5_000_000n);
  });

  it('round-trips with formatUsdc at full precision', () => {
    const v = 123_456_789_012n;
    expect(parseUsdc(formatUsdc(v, 6, 6))).toBe(v);
  });

  it('rejects invalid input', () => {
    for (const bad of ['', 'abc', '-1', '1e6', '1.0000001', '.5', '1.2.3', 'NaN']) {
      expect(() => parseUsdc(bad), bad).toThrow();
    }
  });
});

describe('bps helpers', () => {
  it('bps() floors and guards division by zero', () => {
    expect(bps(70_000_000_000n, 100_000_000_000n)).toBe(7000);
    expect(bps(2n, 3n)).toBe(6666);
    expect(bps(1n, 0n)).toBe(0);
    expect(bps(0n, 10n)).toBe(0);
  });

  it('applyBps() floors', () => {
    expect(applyBps(100_000_000_000n, 7000)).toBe(70_000_000_000n);
    expect(applyBps(20_000_000_000n, 12_000)).toBe(24_000_000_000n);
    expect(applyBps(1n, 5000)).toBe(0n);
    expect(applyBps(10n, 5000n)).toBe(5n);
  });

  it('bpsToPercent() renders two decimals', () => {
    expect(bpsToPercent(800)).toBe('8.00');
    expect(bpsToPercent(100)).toBe('1.00');
    expect(bpsToPercent(9800)).toBe('98.00');
    expect(bpsToPercent(5)).toBe('0.05');
    expect(bpsToPercent(-250)).toBe('-2.50');
  });
});

describe('toUtcMidnight (A-06)', () => {
  it('returns 00:00:00 UTC of the calendar date', () => {
    expect(toUtcMidnight('1970-01-01')).toBe(0);
    expect(toUtcMidnight('2026-11-09')).toBe(1_794_182_400);
    expect(toUtcMidnight('2024-02-29') % 86_400).toBe(0);
  });

  it('rejects malformed or impossible dates', () => {
    for (const bad of ['2026-13-01', '2026-02-30', '2025-02-29', '26-01-01', '2026/01/01', '']) {
      expect(() => toUtcMidnight(bad), bad).toThrow();
    }
  });

  it('round-trips with toIsoDateUtc', () => {
    expect(toIsoDateUtc(toUtcMidnight('2026-12-15'))).toBe('2026-12-15');
  });
});
