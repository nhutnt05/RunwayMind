// Test builders for engine tests (docs/04 §5 SRC vector).
import type { AdapterState, Address, ChainSnapshot, ObligationOnChain } from '@runwaymind/shared';

export const DAY = 86_400;
export const T0 = 1_793_318_400;
export const USDC = (n: number | bigint): bigint => BigInt(n) * 1_000_000n;
export const ADAPTER: Address = '0x00000000000000000000000000000000000000a1';
export const ADAPTER2: Address = '0x00000000000000000000000000000000000000a2';

export function obligation(id: number, amount: bigint, due: number, extra: Partial<ObligationOnChain> = {}): ObligationOnChain {
  return {
    id: BigInt(id),
    recipient: `0x${id.toString(16).padStart(40, '0')}` as Address,
    amount,
    nextDueDate: due,
    interval: 0,
    maxOccurrences: 1,
    paidOccurrences: 0,
    category: 'PAYROLL',
    status: 'ACTIVE',
    metadataHash: `0x${'0'.repeat(64)}`,
    createdAt: T0,
    ...extra,
  };
}

export function adapter(balance: bigint, extra: Partial<AdapterState> = {}): AdapterState {
  return {
    address: ADAPTER,
    name: 'Mock Lending Pool (mUSDC)',
    status: 'ACTIVE',
    balance,
    apyBps: 800,
    paused: false,
    availableLiquidity: balance + USDC(10_000),
    utilizationBps: 5000,
    tvl: balance + USDC(10_000),
    ...extra,
  };
}

/** SRC obligations: O1 20,000 @ D7, O2 20,000 @ D30, O3 10,000 @ D45. */
export const SRC_OBLIGATIONS = (): ObligationOnChain[] => [
  obligation(1, USDC(20_000), T0 + 7 * DAY),
  obligation(2, USDC(20_000), T0 + 30 * DAY, { recipient: '0x0000000000000000000000000000000000000002' }),
  obligation(3, USDC(10_000), T0 + 45 * DAY, { category: 'GRANT' }),
];

export function snapshot(overrides: Partial<ChainSnapshot> = {}): ChainSnapshot {
  return {
    snapshotId: 'snap-test',
    chainId: 43113,
    blockNumber: 1n,
    chainTime: T0,
    treasury: '0x00000000000000000000000000000000000000f1',
    asset: '0x00000000000000000000000000000000000000f2',
    assetDecimals: 6,
    idle: USDC(100_000),
    adapters: [adapter(0n)],
    obligations: SRC_OBLIGATIONS(),
    policy: { safetyHorizonSec: 14 * DAY, emergencyBuffer: USDC(10_000), maxExposureBps: 7000 },
    circuitBreakerActive: false,
    demoMode: true,
    timeOffset: 0,
    onchainRequiredReserve: USDC(30_000),
    ...overrides,
  };
}

/** SRC state right after investing 70,000 at Day 0. */
export function investedSnapshot(overrides: Partial<ChainSnapshot> = {}): ChainSnapshot {
  return snapshot({ idle: USDC(30_000), adapters: [adapter(USDC(70_000))], ...overrides });
}
