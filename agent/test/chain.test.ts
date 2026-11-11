import { describe, expect, it } from 'vitest';
import { encodeErrorResult, getAddress } from 'viem';
import { ALL_ERRORS_ABI, POLICY_RULE_BY_ERROR, decodeRevertData } from '../src/chain/errors';
import { toObligation } from '../src/chain/reader';
import { loadAgentConfig } from '../src/config';

describe('decodeRevertData (docs/07 §6)', () => {
  it('decodes ReserveViolation with named, JSON-safe args', () => {
    const data = encodeErrorResult({
      abi: ALL_ERRORS_ABI,
      errorName: 'ReserveViolation',
      args: [10_000_000_000n, 30_000_000_000n],
    });
    expect(decodeRevertData(data)).toEqual({
      name: 'ReserveViolation',
      args: { idleAfter: '10000000000', requiredReserve: '30000000000' },
    });
    expect(POLICY_RULE_BY_ERROR.ReserveViolation).toBe('R1 Reserve Ratio');
  });

  it('decodes OpenZeppelin AccessControl errors and returns null for unknown selectors', () => {
    const agent = getAddress('0x70997970c51812dc3a010c7d01b50e0d17dc79c8');
    const data = encodeErrorResult({
      abi: ALL_ERRORS_ABI,
      errorName: 'AccessControlUnauthorizedAccount',
      args: [agent, `0x${'0'.repeat(64)}`],
    });
    expect(decodeRevertData(data)?.name).toBe('AccessControlUnauthorizedAccount');
    expect(decodeRevertData('0xdeadbeef')).toBeNull();
  });

  it('includes the whole docs/02 §0.3 catalog', () => {
    const names = new Set((ALL_ERRORS_ABI as readonly { name: string }[]).map((e) => e.name));
    for (const n of ['ZeroAmount', 'CircuitBreakerActive', 'AdapterNotWhitelisted', 'ExposureLimitExceeded', 'ObligationNotDue', 'UnknownObligation', 'NotTreasury', 'PoolPaused', 'InvalidTimeOffset']) {
      expect(names.has(n), n).toBe(true);
    }
  });
});

describe('toObligation', () => {
  it('maps enum indexes to canonical string values', () => {
    const o = toObligation({
      id: 1n,
      recipient: '0x0000000000000000000000000000000000000001',
      amount: 5n,
      nextDueDate: 100n,
      interval: 0n,
      maxOccurrences: 1,
      paidOccurrences: 0,
      category: 2,
      status: 1,
      metadataHash: `0x${'0'.repeat(64)}`,
      createdAt: 1n,
    });
    expect(o.category).toBe('VENDOR_INVOICE');
    expect(o.status).toBe('COMPLETED');
    expect(o.nextDueDate).toBe(100);
  });
});

describe('loadAgentConfig (docs/14 §4)', () => {
  it('parses env, stripping trailing comments as written in docs/11 §4', () => {
    const cfg = loadAgentConfig({ CHAIN_ID: '43113', FUJI_RPC_URL: 'https://api.avax-test.network/ext/bc/C/rpc', FUJI_RPC_URL_FALLBACK: '' });
    expect(cfg.CHAIN_ID).toBe(43113);
    expect(cfg.FUJI_RPC_URL_FALLBACK).toBeUndefined();
    expect(cfg.AGENT_PRIVATE_KEY).toBeUndefined();
  });

  it('fails with a clear message for missing / malformed values', () => {
    expect(() => loadAgentConfig({ AGENT_PRIVATE_KEY: '0x<agent_testnet_key>' })).toThrow(/FUJI_RPC_URL[\s\S]*AGENT_PRIVATE_KEY/);
  });
});
