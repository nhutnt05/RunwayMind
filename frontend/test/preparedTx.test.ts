import { encodeFunctionData, erc20Abi } from 'viem';
import { describe, expect, it } from 'vitest';
import { obligationRegistryAbi } from '@runwaymind/shared/abi';
import type { PreparedTx } from '../lib/api';
import { formatDecodedError, verifyRegistryTx } from '../lib/preparedTx';

const REGISTRY = '0x16Aa744F1f39a6376da466AEB9c53b6EC55DAFAc';
const cancelData = encodeFunctionData({ abi: obligationRegistryAbi, functionName: 'cancelObligation', args: [2n] });

function tx(overrides: Partial<PreparedTx> = {}): PreparedTx {
  return { to: REGISTRY, data: cancelData, value: '0', chainId: 43113, functionName: 'cancelObligation', ...overrides };
}

const expected = { registry: REGISTRY, chainId: 43113, functionName: 'cancelObligation' } as const;

describe('verifyRegistryTx', () => {
  it('decodes an expected registry call', () => {
    expect(verifyRegistryTx(tx({ to: REGISTRY.toLowerCase() as PreparedTx['to'] }), expected)).toEqual({
      address: REGISTRY,
      functionName: 'cancelObligation',
      args: [2n],
    });
  });

  it('refuses wrong chain, wrong target, native value or unexpected function', () => {
    expect(() => verifyRegistryTx(tx({ chainId: 1 }), expected)).toThrow(/chain/);
    expect(() => verifyRegistryTx(tx({ to: '0x0000000000000000000000000000000000000001' }), expected)).toThrow(
      /ObligationRegistry/,
    );
    expect(() => verifyRegistryTx(tx({ value: '1' }), expected)).toThrow(/value/);
    expect(() => verifyRegistryTx(tx(), { ...expected, functionName: 'createObligation' })).toThrow(
      /expected createObligation/,
    );
  });

  it('refuses calldata that is not a registry function (e.g. an ERC-20 transfer)', () => {
    const data = encodeFunctionData({
      abi: erc20Abi,
      functionName: 'transfer',
      args: ['0x0000000000000000000000000000000000000001', 1n],
    });
    expect(() => verifyRegistryTx(tx({ data }), expected)).toThrow();
  });
});

describe('formatDecodedError (docs/08 §8)', () => {
  it('formats ReserveViolation with USDC amounts', () => {
    expect(
      formatDecodedError({ name: 'ReserveViolation', args: { idleAfter: '10000000000', requiredReserve: '30000000000' } }),
    ).toBe('ReserveViolation: idle after 10,000.00 < required 30,000.00');
    expect(
      formatDecodedError({ name: 'ReserveViolation', args: { idleAfter: 10_000_000_000n, requiredReserve: 30_000_000_000n } }),
    ).toBe('ReserveViolation: idle after 10,000.00 < required 30,000.00');
  });

  it('falls back to name + args', () => {
    expect(formatDecodedError({ name: 'CircuitBreakerActive', args: {} })).toBe('CircuitBreakerActive');
    expect(formatDecodedError({ name: 'NotWhitelisted', args: { adapter: '0xA' } })).toBe('NotWhitelisted: adapter=0xA');
    expect(formatDecodedError(null)).toBe('Transaction would revert');
  });
});

describe('write-flow error reporting (CP2 B-9)', () => {
  it('names the failing stage and redacts RPC URLs (API keys) from the message', async () => {
    const { describeStageError, redactUrls } = await import('../lib/preparedTx');
    expect(redactUrls('POST https://avax-fuji.g.example.com/v2/SECRET123 failed')).toBe('POST https://avax-fuji.g.example.com/… failed');
    const msg = describeStageError('wallet', new Error('Request exceeds defined limit. URL: https://rpc.example.org/key/ABC'));
    expect(msg).toBe('Wallet / wallet RPC: Request exceeds defined limit. URL: https://rpc.example.org/…');
    expect(describeStageError('simulate', new Error('x'))).toBe('Simulation (app RPC): x');
  });
});
