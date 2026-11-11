// Chain reader (docs/05 §3): one consistent snapshot pinned to a single block → ChainSnapshot (docs/04 §2.1).
import { randomUUID } from 'node:crypto';
import type { Address, PublicClient } from 'viem';
import {
  mockUSDCAbi,
  obligationRegistryAbi,
  policyEngineAbi,
  treasuryAbi,
  vaultAdapterAbi,
} from '@runwaymind/shared/abi';
import type {
  AdapterState,
  AdapterStatus,
  Category,
  ChainSnapshot,
  ObligationOnChain,
  ObligationStatus,
} from '@runwaymind/shared';

export interface CoreAddresses {
  treasury: Address;
  registry: Address;
  policy: Address;
}

export const ADAPTER_STATUS: readonly AdapterStatus[] = ['NONE', 'ACTIVE', 'WITHDRAW_ONLY'];
export const CATEGORY: readonly Category[] = ['PAYROLL', 'GRANT', 'VENDOR_INVOICE', 'OTHER'];
export const OBLIGATION_STATUS: readonly ObligationStatus[] = ['ACTIVE', 'COMPLETED', 'CANCELLED'];

interface Call {
  address: Address;
  abi: readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
}

/**
 * Executes calls at one block. Uses Multicall3 when the chain defines it (Fuji); otherwise (e.g. plain Anvil) issues
 * parallel `eth_call`s pinned to the same block number, which is equally consistent.
 */
async function readAll(client: PublicClient, calls: Call[], blockNumber: bigint): Promise<unknown[]> {
  if (client.chain?.contracts?.multicall3) {
    return client.multicall({ contracts: calls as never, blockNumber, allowFailure: false }) as Promise<unknown[]>;
  }
  return Promise.all(calls.map((c) => client.readContract({ ...c, blockNumber } as never)));
}

export async function readSnapshot(
  client: PublicClient,
  addrs: CoreAddresses,
  opts: { blockNumber?: bigint; snapshotId?: string } = {},
): Promise<ChainSnapshot> {
  // cacheTime 0: viem caches the block number for pollingInterval otherwise (stale snapshot right after a tx).
  const blockNumber = opts.blockNumber ?? (await client.getBlockNumber({ cacheTime: 0 }));
  const t = { address: addrs.treasury, abi: treasuryAbi };
  const p = { address: addrs.policy, abi: policyEngineAbi };
  const r = { address: addrs.registry, abi: obligationRegistryAbi };

  const [chainTime, idle, breaker, demoMode, timeOffset, onchainRequired, asset, h, buffer, maxExposure, adapters, ids] =
    (await readAll(
      client,
      [
        { ...t, functionName: 'currentTime' },
        { ...t, functionName: 'idleBalance' },
        { ...t, functionName: 'circuitBreakerActive' },
        { ...t, functionName: 'demoMode' },
        { ...t, functionName: 'timeOffset' },
        { ...t, functionName: 'requiredReserve' },
        { ...t, functionName: 'asset' },
        { ...p, functionName: 'safetyHorizon' },
        { ...p, functionName: 'emergencyBuffer' },
        { ...p, functionName: 'maxExposureBps' },
        { ...p, functionName: 'getAdapters' },
        { ...r, functionName: 'getActiveObligationIds' },
      ],
      blockNumber,
    )) as [bigint, bigint, boolean, boolean, bigint, bigint, Address, bigint, bigint, number, Address[], bigint[]];

  // Second round (depends on ids / adapter list), pinned to the same block.
  const adapterCalls: Call[] = adapters.flatMap((a) => [
    { ...p, functionName: 'adapterStatus', args: [a] },
    ...(['balance', 'getAPY', 'isPaused', 'availableLiquidity', 'utilizationBps', 'tvl', 'name'] as const).map((fn) => ({
      address: a,
      abi: vaultAdapterAbi,
      functionName: fn,
    })),
  ]);
  const [decimals, rawObligations, ...adapterValues] = await readAll(
    client,
    [
      { address: asset, abi: mockUSDCAbi, functionName: 'decimals' },
      { ...r, functionName: 'getObligations', args: [ids] },
      ...adapterCalls,
    ],
    blockNumber,
  );

  const adapterStates: AdapterState[] = adapters.map((address, i) => {
    const v = adapterValues.slice(i * 8, i * 8 + 8) as [number, bigint, bigint, boolean, bigint, bigint, bigint, string];
    return {
      address,
      status: ADAPTER_STATUS[v[0]] ?? 'NONE',
      balance: v[1],
      apyBps: Number(v[2]),
      paused: v[3],
      availableLiquidity: v[4],
      utilizationBps: Number(v[5]),
      tvl: v[6],
      name: v[7],
    };
  });

  const obligations: ObligationOnChain[] = (rawObligations as readonly RawObligation[]).map(toObligation);

  return {
    snapshotId: opts.snapshotId ?? randomUUID(),
    chainId: 43113, // ChainSnapshot type is Fuji-only (docs/04 §2.1); local Anvil reads reuse the same shape
    blockNumber,
    chainTime: Number(chainTime),
    treasury: addrs.treasury,
    asset,
    assetDecimals: Number(decimals),
    idle,
    adapters: adapterStates,
    obligations,
    policy: { safetyHorizonSec: Number(h), emergencyBuffer: buffer, maxExposureBps: Number(maxExposure) },
    circuitBreakerActive: breaker,
    demoMode,
    timeOffset: Number(timeOffset),
    onchainRequiredReserve: onchainRequired,
  };
}

interface RawObligation {
  id: bigint;
  recipient: Address;
  amount: bigint;
  nextDueDate: bigint;
  interval: bigint;
  maxOccurrences: number;
  paidOccurrences: number;
  category: number;
  status: number;
  metadataHash: `0x${string}`;
  createdAt: bigint;
}

export function toObligation(o: RawObligation): ObligationOnChain {
  return {
    id: o.id,
    recipient: o.recipient,
    amount: o.amount,
    nextDueDate: Number(o.nextDueDate),
    interval: Number(o.interval),
    maxOccurrences: Number(o.maxOccurrences),
    paidOccurrences: Number(o.paidOccurrences),
    category: CATEGORY[o.category] ?? 'OTHER',
    status: OBLIGATION_STATUS[o.status] ?? 'ACTIVE',
    metadataHash: o.metadataHash,
    createdAt: Number(o.createdAt),
  };
}
