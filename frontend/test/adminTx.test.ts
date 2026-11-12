import { encodeFunctionData, erc20Abi, getAddress, type Address } from 'viem';
import { describe, expect, it } from 'vitest';
import { mockLendingPoolAbi, policyEngineAbi, treasuryAbi } from '@runwaymind/shared/abi';
import { adminKind, verifyAdminTx } from '../lib/adminTx';

const TREASURY: Address = '0x00000000000000000000000000000000000000f1';
const POLICY: Address = '0x00000000000000000000000000000000000000f4';
const POOL: Address = '0x00000000000000000000000000000000000000b0';
const ADAPTER: Address = '0x00000000000000000000000000000000000000a1';
const CHAIN = 43113;

const tx = (to: Address, data: `0x${string}`, extra: Partial<{ value: string; chainId: number; functionName: string }> = {}) => ({
  to,
  data,
  value: '0',
  chainId: CHAIN,
  ...extra,
});

describe('verifyAdminTx (docs/08 §6 prepared-tx guard)', () => {
  it('accepts allowed Treasury / PolicyEngine / MockLendingPool calls and returns decoded args + tx kind', () => {
    const withdraw = encodeFunctionData({ abi: treasuryAbi, functionName: 'withdraw', args: [ADAPTER, 20_000_000_000n] });
    expect(verifyAdminTx(tx(TREASURY, withdraw, { functionName: 'withdraw' }), { contract: 'Treasury', address: TREASURY, chainId: CHAIN })).toMatchObject({
      functionName: 'withdraw',
      args: [getAddress(ADAPTER), 20_000_000_000n],
      kind: 'WITHDRAW',
    });
    const status = encodeFunctionData({ abi: policyEngineAbi, functionName: 'setAdapterStatus', args: [ADAPTER, 2] });
    expect(verifyAdminTx(tx(POLICY, status), { contract: 'PolicyEngine', address: POLICY, chainId: CHAIN }).kind).toBe('SET_ADAPTER_STATUS');
    const apy = encodeFunctionData({ abi: mockLendingPoolAbi, functionName: 'setAPY', args: [100n] });
    expect(verifyAdminTx(tx(POOL, apy), { contract: 'MockLendingPool', address: POOL, chainId: CHAIN, functionName: 'setAPY' }).kind).toBe('POOL_CONTROL');
  });

  it('rejects wrong chain, wrong target, native value, non-admin functions and label/calldata mismatch', () => {
    const adv = encodeFunctionData({ abi: treasuryAbi, functionName: 'advanceTime', args: [86_400n] });
    const exp = { contract: 'Treasury' as const, address: TREASURY, chainId: CHAIN };
    expect(() => verifyAdminTx(tx(TREASURY, adv, { chainId: 1 }), exp)).toThrow(/chain 1/);
    expect(() => verifyAdminTx(tx(POLICY, adv), exp)).toThrow(/not addressed to the Treasury/);
    expect(() => verifyAdminTx(tx(TREASURY, adv, { value: '1' }), exp)).toThrow(/native value/);
    expect(() => verifyAdminTx(tx(TREASURY, adv), { ...exp, functionName: 'resetCircuitBreaker' })).toThrow(/expected resetCircuitBreaker/);
    expect(() => verifyAdminTx(tx(TREASURY, adv, { functionName: 'withdraw' }), exp)).toThrow(/does not match/);
    // pay() is a Treasury function but not an ADMIN-UI action; an ERC-20 transfer is not a Treasury call at all.
    const pay = encodeFunctionData({ abi: treasuryAbi, functionName: 'pay', args: [1n] });
    expect(() => verifyAdminTx(tx(TREASURY, pay), exp)).toThrow(/not an allowed admin action/);
    const transfer = encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [ADAPTER, 1n] });
    expect(() => verifyAdminTx(tx(TREASURY, transfer), exp)).toThrow(/not a Treasury call/);
  });

  it('adminKind maps functions to TransactionKind', () => {
    expect(adminKind('Treasury', 'tripCircuitBreaker')).toBe('TRIP_BREAKER');
    expect(adminKind('PolicyEngine', 'setSafetyHorizon')).toBe('SET_POLICY');
    expect(adminKind('Treasury', 'pay')).toBeNull();
  });
});
