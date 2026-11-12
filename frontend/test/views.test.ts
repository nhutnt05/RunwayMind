import { describe, expect, it } from 'vitest';
import {
  activityError,
  blockedLabel,
  bpsToPercentText,
  daysToSeconds,
  filterActivity,
  isBlocked,
  ladderChartRows,
  percentToBps,
  policyHeadroom,
  txRole,
  type ActivityItemJson,
} from '../lib/views';

const USDC = (n: number) => BigInt(n) * 1_000_000n;

describe('policyHeadroom (docs/08 §3.5)', () => {
  const base = {
    idle: USDC(100_000),
    requiredReserve: USDC(30_000),
    totalAssets: USDC(100_000),
    maxExposureBps: 7000,
    adapterBalance: 0n,
    adapterActive: true,
    circuitBreakerActive: false,
  };
  it('SRC day 0: R1 70,000, R3 70,000 → max investable 70,000', () => {
    expect(policyHeadroom(base)).toEqual({ r1: USDC(70_000), r3: USDC(70_000), maxInvestable: USDC(70_000) });
  });
  it('extended demo: min(R1 70,030.68, R3 56,021.47) = 56,021.47 (docs/12 §4)', () => {
    const h = policyHeadroom({ ...base, idle: 80_030_680_000n, requiredReserve: USDC(10_000), totalAssets: 80_030_680_000n, adapterBalance: 0n });
    expect(h.r1).toBe(70_030_680_000n);
    expect(h.r3).toBe(56_021_476_000n);
    expect(h.maxInvestable).toBe(56_021_476_000n);
  });
  it('0 when breaker active, adapter not ACTIVE, or reserve already short', () => {
    expect(policyHeadroom({ ...base, circuitBreakerActive: true }).maxInvestable).toBe(0n);
    expect(policyHeadroom({ ...base, adapterActive: false }).maxInvestable).toBe(0n);
    expect(policyHeadroom({ ...base, idle: USDC(20_000) }).r1).toBe(0n);
  });
});

describe('txRole', () => {
  const roles = { admin: '0xAAaa000000000000000000000000000000000001', agent: '0x00000000000000000000000000000000000000a2', keeper: null };
  it('matches case-insensitively and falls back to OTHER', () => {
    expect(txRole('0xaaaa000000000000000000000000000000000001', roles)).toBe('ADMIN');
    expect(txRole('0x00000000000000000000000000000000000000A2', roles)).toBe('AGENT');
    expect(txRole('0x00000000000000000000000000000000000000a3', roles)).toBe('OTHER');
  });
});

describe('blockedLabel (docs/08 §3.8)', () => {
  it('R1 with idle-after / required amounts', () => {
    expect(blockedLabel({ name: 'ReserveViolation', args: { idleAfter: '10000000000', requiredReserve: '30000000000' } })).toBe(
      'Blocked by R1 Reserve Ratio: idle after 10,000.00 < required 30,000.00',
    );
  });
  it('R3, R6 and non-policy errors', () => {
    expect(blockedLabel({ name: 'ExposureLimitExceeded', args: { adapterBalanceAfter: '60000000000', cap: '50000000000' } })).toBe(
      'Blocked by R3 Exposure Limit: adapter balance after 60,000.00 > cap 50,000.00',
    );
    expect(blockedLabel({ name: 'CircuitBreakerActive', args: {} })).toBe('Blocked by R6 Circuit Breaker: CircuitBreakerActive');
    expect(blockedLabel({ name: 'PoolPaused', args: {} })).toBe('Blocked by policy: PoolPaused');
    expect(blockedLabel(null)).toBe('Blocked by policy');
  });
});

describe('ladderChartRows (docs/08 §3.4)', () => {
  it('whole-token geometry with exact strings preserved for the tooltip', () => {
    const rows = ladderChartRows([
      { dayIndex: 0, date: 0, requiredReserve: '30000000000', projectedIdle: '30000000000', projectedVault: '70030680000', paymentsToday: '0', withdrawalsToday: '0' },
    ]);
    expect(rows[0]).toMatchObject({ day: 0, idleTokens: 30_000, vaultTokens: 70_030, requiredTokens: 30_000, paymentsTokens: 0 });
    expect(rows[0]!.exact.vault).toBe('70030680000');
  });
});

describe('form conversions', () => {
  it('percentToBps / bpsToPercentText without floats', () => {
    expect(percentToBps('70')).toBe(7000);
    expect(percentToBps('70.5')).toBe(7050);
    expect(percentToBps('1.25')).toBe(125);
    expect(percentToBps('1.255')).toBeNull();
    expect(percentToBps('abc')).toBeNull();
    expect(bpsToPercentText(7000)).toBe('70.00');
    expect(bpsToPercentText(5)).toBe('0.05');
  });
  it('daysToSeconds', () => {
    expect(daysToSeconds('14')).toBe(1_209_600);
    expect(daysToSeconds('0')).toBeNull();
    expect(daysToSeconds('1.5')).toBeNull();
  });
});

describe('activity helpers', () => {
  const items: ActivityItemJson[] = [
    { type: 'ACTION', at: 3, id: 'a', data: { status: 'BLOCKED_BY_POLICY', decodedError: { name: 'ReserveViolation', args: {} } } },
    { type: 'DECISION', at: 2, id: 'd', data: { status: 'BLOCKED_BY_POLICY', actions: [{ decodedError: null }, { decodedError: { name: 'CircuitBreakerActive', args: {} } }] } },
    { type: 'KEEPER_RUN', at: 1, id: 'k', data: { paidIds: ['1'] } },
  ];
  it('isBlocked / activityError / filterActivity', () => {
    expect(items.map(isBlocked)).toEqual([true, true, false]);
    expect(activityError(items[0]!)?.name).toBe('ReserveViolation');
    expect(activityError(items[1]!)?.name).toBe('CircuitBreakerActive');
    expect(activityError(items[2]!)).toBeNull();
    expect(filterActivity(items, 'KEEPER_RUN').map((i) => i.id)).toEqual(['k']);
    expect(filterActivity(items, 'ALL')).toHaveLength(3);
  });
});
