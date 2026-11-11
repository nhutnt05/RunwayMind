import { describe, expect, it } from 'vitest';
import { AMOUNT_KEYS, bigintReviver, parseJson, stringifyJson, toJsonSafe } from '../src/serialize';

describe('bigint-safe JSON', () => {
  const value = {
    id: 'dec_1',
    amount: 70_000_000_000n,
    nested: { blockNumber: 39_012_345n, list: [1n, 2n] },
    apyBps: 800,
    label: 'Payroll',
  };

  it('stringifies bigint as decimal strings (never JSON numbers)', () => {
    const text = stringifyJson(value);
    expect(text).toBe(
      '{"id":"dec_1","amount":"70000000000","nested":{"blockNumber":"39012345","list":["1","2"]},"apyBps":800,"label":"Payroll"}',
    );
    expect(() => JSON.stringify(value)).toThrow(TypeError);
  });

  it('toJsonSafe deep-converts bigint', () => {
    expect(toJsonSafe(value)).toEqual({
      id: 'dec_1',
      amount: '70000000000',
      nested: { blockNumber: '39012345', list: ['1', '2'] },
      apyBps: 800,
      label: 'Payroll',
    });
  });

  it('revives only the listed keys back to bigint', () => {
    const text = stringifyJson({ amount: 5n, label: '123', idle: 9n, requiredReserve: '-3' });
    const parsed = parseJson<{ amount: bigint; label: string; idle: bigint; requiredReserve: bigint }>(
      text,
      bigintReviver(AMOUNT_KEYS),
    );
    expect(parsed).toEqual({ amount: 5n, label: '123', idle: 9n, requiredReserve: -3n });
  });

  it('leaves non-integer strings under listed keys untouched', () => {
    const parsed = parseJson<{ amount: string }>('{"amount":"MAX"}', bigintReviver(['amount']));
    expect(parsed.amount).toBe('MAX');
  });

  it('round-trips a nested structure', () => {
    const original = { withdrawalSchedule: [{ amount: 20_000_000_000n, covers: [{ obligationId: 2n, amount: 1n }] }] };
    const back = parseJson(stringifyJson(original), bigintReviver(AMOUNT_KEYS));
    expect(back).toEqual(original);
  });
});
