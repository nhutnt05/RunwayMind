import { describe, expect, it } from 'vitest';
import type { Address } from 'viem';
import { ADAPTER_PROBE_FUNCTIONS, MAX_ADAPTERS, evaluateProbe, precheckAdapter } from '../lib/adapterCheck';

const TREASURY = '0x00000000000000000000000000000000000000F1' as Address;
const ASSET = '0x00000000000000000000000000000000000000F2' as Address;
const LISTED = ['0x00000000000000000000000000000000000000A1' as Address];
const NEW = '0x00000000000000000000000000000000000000a2';
const ctx = { treasury: TREASURY, asset: ASSET, assetSymbol: 'USDC' };

const ok = (over: Partial<Record<(typeof ADAPTER_PROBE_FUNCTIONS)[number], unknown>> = {}) =>
  ADAPTER_PROBE_FUNCTIONS.map((fn) => {
    const v = fn in over ? over[fn] : ({ asset: ASSET, treasury: TREASURY, name: 'Second Pool', isPaused: false } as Record<string, unknown>)[fn] ?? 0n;
    return v === undefined ? { status: 'failure' as const } : { status: 'success' as const, result: v };
  });

describe('precheckAdapter (Add adapter form)', () => {
  const pre = (s: string, listed = LISTED) => precheckAdapter(s, { listed, treasury: TREASURY });
  it('empty, malformed, zero, treasury, duplicate (any case) and full list are rejected before any chain read', () => {
    expect(pre('')).toEqual({ state: 'empty' });
    expect(pre('0x123')?.state).toBe('invalid');
    expect(pre('0x' + '0'.repeat(40))).toMatchObject({ message: /zero address/ });
    expect(pre(TREASURY.toLowerCase())).toMatchObject({ message: /Treasury itself/ });
    expect(pre('0x00000000000000000000000000000000000000a1')).toMatchObject({ message: /already in the whitelist/ });
    const five = Array.from({ length: MAX_ADAPTERS }, (_, i) => `0x00000000000000000000000000000000000000B${i}` as Address);
    expect(pre(NEW, five)).toMatchObject({ message: /full \(max 5/ });
  });
  it('a valid new address needs the on-chain check (null)', () => {
    expect(pre(`  ${NEW}  `)).toBeNull();
  });
});

describe('evaluateProbe', () => {
  it('compatible adapter → ok with its name', () => {
    expect(evaluateProbe(ok(), ctx)).toEqual({ state: 'ok', name: 'Second Pool' });
  });
  it('nothing answers → not a vault adapter', () => {
    const r = evaluateProbe(ADAPTER_PROBE_FUNCTIONS.map(() => ({ status: 'failure' as const })), ctx);
    expect(r).toMatchObject({ state: 'failed', name: null, problems: [expect.stringMatching(/No vault adapter found/)] });
  });
  it('partial interface → lists the missing views', () => {
    expect(evaluateProbe(ok({ tvl: undefined, getAPY: undefined }), ctx)).toMatchObject({ problems: [expect.stringMatching(/getAPY, tvl are missing/)] });
  });
  it('different token or a different treasury are blocked', () => {
    expect(evaluateProbe(ok({ asset: '0x00000000000000000000000000000000000000F9' }), ctx)).toMatchObject({ problems: [expect.stringMatching(/different token, not USDC/)] });
    expect(evaluateProbe(ok({ treasury: '0x00000000000000000000000000000000000000E1' }), ctx)).toMatchObject({ problems: [expect.stringMatching(/different treasury/)] });
  });
});
