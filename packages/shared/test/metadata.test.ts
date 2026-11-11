import { keccak256, stringToBytes } from 'viem';
import { describe, expect, it } from 'vitest';
import { canonicalJson, obligationMetadataHash, snowtraceTxUrl } from '../src';

describe('canonicalJson', () => {
  it('sorts keys at every level, no whitespace', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, 'x'], c: null } })).toBe('{"a":{"c":null,"d":[1,"x"]},"b":1}');
  });
  it('serializes bigint as decimal string and drops undefined members', () => {
    expect(canonicalJson({ amount: 20_000_000_000n, skip: undefined })).toBe('{"amount":"20000000000"}');
  });
  it('escapes strings like JSON.stringify', () => {
    expect(canonicalJson({ label: 'Lương "tháng" 12' })).toBe('{"label":"Lương \\"tháng\\" 12"}');
  });
});

describe('obligationMetadataHash (docs/07 §5.1)', () => {
  it('equals the literal JSON hashed by scripts/SeedDemo.s.sol', () => {
    const literal = '{"category":"PAYROLL","label":"November payroll","notes":null,"source":"SEED"}';
    expect(obligationMetadataHash({ label: 'November payroll', notes: null, category: 'PAYROLL', source: 'SEED' })).toBe(
      keccak256(stringToBytes(literal)),
    );
  });
  it('is key-order independent and changes with notes', () => {
    const a = obligationMetadataHash({ label: 'X', notes: null, category: 'GRANT', source: 'FORM' });
    const b = obligationMetadataHash({ source: 'FORM', category: 'GRANT', notes: null, label: 'X' });
    expect(a).toBe(b);
    expect(obligationMetadataHash({ label: 'X', notes: 'n', category: 'GRANT', source: 'FORM' })).not.toBe(a);
  });
});

describe('snowtraceTxUrl', () => {
  it('builds the testnet link', () => {
    expect(snowtraceTxUrl('0xabc')).toBe('https://testnet.snowtrace.io/tx/0xabc');
    expect(snowtraceTxUrl('0xabc', 'https://x.io/')).toBe('https://x.io/tx/0xabc');
  });
});
