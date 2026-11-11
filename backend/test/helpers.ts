// Test harness: real Fastify app + real SQLite (migrated) + fake ChainService with the SRC snapshot (docs/04 §5).
import { PrismaClient } from '@prisma/client';
import { getAddress, recoverMessageAddress, type Address, type Hex } from 'viem';
import type { ChainSnapshot, ObligationOnChain } from '@runwaymind/shared';
import { buildApp } from '../src/app';
import { ApiError } from '../src/errors';
import type { ChainService, OnchainRole } from '../src/services/chain';

export const DAY = 86_400;
export const T0 = 1_793_318_400;
export const USDC = (n: number) => BigInt(n) * 1_000_000n;
export const TREASURY: Address = '0x00000000000000000000000000000000000000F1';
export const ADAPTER: Address = '0x00000000000000000000000000000000000000A1';
export const APP_ORIGIN = 'http://localhost:3000';
export const TREASURY_ID = 'local-musdc';

const ob = (id: number, amount: bigint, due: number, extra: Partial<ObligationOnChain> = {}): ObligationOnChain => ({
  id: BigInt(id),
  recipient: getAddress(`0x${id.toString(16).padStart(40, '0')}`),
  amount,
  nextDueDate: due,
  interval: 0,
  maxOccurrences: 1,
  paidOccurrences: 0,
  category: id === 3 ? 'GRANT' : 'PAYROLL',
  status: 'ACTIVE',
  metadataHash: `0x${'0'.repeat(64)}`,
  createdAt: T0,
  ...extra,
});

export function srcSnapshot(): ChainSnapshot {
  return {
    snapshotId: 'snap-test',
    chainId: 43113,
    blockNumber: 123n,
    chainTime: T0,
    treasury: TREASURY,
    asset: '0x00000000000000000000000000000000000000F2',
    assetDecimals: 6,
    idle: USDC(100_000),
    adapters: [
      {
        address: ADAPTER,
        name: 'Mock Lending Pool (mUSDC)',
        status: 'ACTIVE',
        balance: 0n,
        apyBps: 800,
        paused: false,
        availableLiquidity: USDC(10_000),
        utilizationBps: 5000,
        tvl: USDC(10_000),
      },
    ],
    obligations: [ob(1, USDC(20_000), T0 + 7 * DAY), ob(2, USDC(20_000), T0 + 30 * DAY), ob(3, USDC(10_000), T0 + 45 * DAY)],
    policy: { safetyHorizonSec: 14 * DAY, emergencyBuffer: USDC(10_000), maxExposureBps: 7000 },
    circuitBreakerActive: false,
    demoMode: true,
    timeOffset: 0,
    onchainRequiredReserve: USDC(30_000),
  };
}

export class FakeChain implements ChainService {
  readonly addresses = { treasury: TREASURY, registry: TREASURY, policy: TREASURY };
  snapshot: ChainSnapshot = srcSnapshot();
  extraObligations: ObligationOnChain[] = [ob(4, USDC(5_000), T0 + 2 * DAY, { status: 'CANCELLED' })];
  admins = new Set<string>();
  agents = new Set<string>();
  down = false;
  roleCalls = 0;

  private check() {
    if (this.down) throw new ApiError('CHAIN_UNAVAILABLE', 'RPC down');
  }
  async getSnapshot() {
    this.check();
    return this.snapshot;
  }
  async getAllObligations() {
    this.check();
    return { blockNumber: this.snapshot.blockNumber, obligations: [...this.snapshot.obligations, ...this.extraObligations] };
  }
  async hasRole(role: OnchainRole, account: Address) {
    this.check();
    this.roleCalls += 1;
    return (role === 'ADMIN' ? this.admins : this.agents).has(getAddress(account));
  }
  async verifySiweMessage(message: string, signature: Hex) {
    const addr = /\n(0x[0-9a-fA-F]{40})\n/.exec(message)?.[1];
    if (!addr) return false;
    return (await recoverMessageAddress({ message, signature })) === getAddress(addr);
  }
  async getBlockNumber() {
    this.check();
    return this.snapshot.blockNumber;
  }
}

export const prisma = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });

export async function resetDb() {
  await prisma.auditLog.deleteMany();
  await prisma.agentAction.deleteMany();
  await prisma.agentDecision.deleteMany();
  await prisma.obligationMetadata.deleteMany();
  await prisma.indexedEvent.deleteMany();
  await prisma.chainEventCursor.deleteMany();
  await prisma.agentSettings.deleteMany();
  await prisma.pool.deleteMany();
  await prisma.authNonce.deleteMany();
  await prisma.wallet.deleteMany();
  await prisma.expectedInflow.deleteMany();
  await prisma.treasuryConfig.deleteMany();
  await prisma.treasuryConfig.create({
    data: {
      id: TREASURY_ID,
      chainId: 31337,
      treasuryAddress: TREASURY,
      registryAddress: TREASURY,
      policyAddress: TREASURY,
      assetAddress: '0x00000000000000000000000000000000000000F2',
      assetSymbol: 'mUSDC',
      assetDecimals: 6,
      deployBlock: '0',
      demoStartTime: T0,
      isPrimary: true,
    },
  });
  await prisma.obligationMetadata.create({
    data: { treasuryId: TREASURY_ID, obligationId: '1', label: 'November payroll', source: 'SEED', metadataHash: '0x', createTxHash: '' },
  });
}

export async function makeApp(chain = new FakeChain(), now?: () => Date) {
  const { app, auth } = await buildApp({
    prisma,
    chain,
    treasuryId: TREASURY_ID,
    chainId: 43113,
    appOrigin: APP_ORIGIN,
    sessionSecret: 'test-secret-test-secret-test-secret-0123',
    production: false,
    ...(now ? { now } : {}),
  });
  return { app, auth, chain };
}
