// Chain access for services (docs/07 §1, §6). Routes never call viem directly; tests inject a fake ChainService.
import type { Abi, Address, Hex, Log, PublicClient } from 'viem';
import { obligationRegistryAbi, treasuryAbi } from '@runwaymind/shared/abi';
import type { ChainSnapshot, ObligationOnChain } from '@runwaymind/shared';
import { readSnapshot, simulateCall, toObligation, type CoreAddresses, type DecodedError } from '@runwaymind/agent';
import { chainUnavailable } from '../errors';

export type OnchainRole = 'ADMIN' | 'AGENT';

export interface SimulationCall {
  address: Address;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
}

/** docs/07 §5.1 `simulation`: `{ ok, error }` where `error` is the decoded custom error (null when unknown). */
export type SimulationResult = { ok: true; error: null } | { ok: false; error: DecodedError | null; message: string };

export interface ReceiptView {
  status: 'success' | 'reverted';
  blockNumber: bigint;
  from: Address;
  logs: readonly Log[];
}

export interface ChainService {
  readonly addresses: CoreAddresses;
  getSnapshot(): Promise<ChainSnapshot>;
  /** Every obligation ever created (ACTIVE, COMPLETED, CANCELLED), pinned to one block. */
  getAllObligations(): Promise<{ blockNumber: bigint; obligations: ObligationOnChain[] }>;
  hasRole(role: OnchainRole, account: Address): Promise<boolean>;
  verifySiweMessage(message: string, signature: Hex): Promise<boolean>;
  getBlockNumber(): Promise<bigint>;
  /** `simulateContract` from `account` (docs/07 §5: "simulate from the caller's address"). Reverts are decoded. */
  simulate(account: Address, call: SimulationCall): Promise<SimulationResult>;
  /** Waits for 1 confirmation; null on timeout (the indexer still picks the tx up later). */
  waitForReceipt(hash: Hex, timeoutMs?: number): Promise<ReceiptView | null>;
}

const DEFAULT_ADMIN_ROLE: Hex = `0x${'0'.repeat(64)}`;

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw chainUnavailable(e);
  }
}

export class ViemChainService implements ChainService {
  private agentRole: Hex | null = null;

  constructor(
    private readonly client: PublicClient,
    readonly addresses: CoreAddresses,
  ) {}

  getBlockNumber(): Promise<bigint> {
    return guard(() => this.client.getBlockNumber({ cacheTime: 0 }));
  }

  getSnapshot(): Promise<ChainSnapshot> {
    return guard(() => readSnapshot(this.client, this.addresses));
  }

  getAllObligations() {
    return guard(async () => {
      const blockNumber = await this.client.getBlockNumber({ cacheTime: 0 });
      const count = (await this.client.readContract({
        address: this.addresses.registry,
        abi: obligationRegistryAbi,
        functionName: 'obligationCount',
        blockNumber,
      })) as bigint;
      if (count === 0n) return { blockNumber, obligations: [] };
      const ids = Array.from({ length: Number(count) }, (_, i) => BigInt(i + 1));
      const raw = await this.client.readContract({
        address: this.addresses.registry,
        abi: obligationRegistryAbi,
        functionName: 'getObligations',
        args: [ids],
        blockNumber,
      });
      return { blockNumber, obligations: (raw as readonly Parameters<typeof toObligation>[0][]).map(toObligation) };
    });
  }

  hasRole(role: OnchainRole, account: Address): Promise<boolean> {
    return guard(async () => {
      let roleId = DEFAULT_ADMIN_ROLE;
      if (role === 'AGENT') {
        this.agentRole ??= (await this.client.readContract({
          address: this.addresses.treasury,
          abi: treasuryAbi,
          functionName: 'AGENT_ROLE',
        })) as Hex;
        roleId = this.agentRole;
      }
      return (await this.client.readContract({
        address: this.addresses.treasury,
        abi: treasuryAbi,
        functionName: 'hasRole',
        args: [roleId, account],
      })) as boolean;
    });
  }

  verifySiweMessage(message: string, signature: Hex): Promise<boolean> {
    return guard(() => this.client.verifySiweMessage({ message, signature }));
  }

  async simulate(account: Address, call: SimulationCall): Promise<SimulationResult> {
    const res = await simulateCall(this.client, account, call as never, [500, 1_000]);
    if (res.ok) return { ok: true, error: null };
    if (!res.reverted) throw chainUnavailable(new Error(res.message));
    return { ok: false, error: res.error, message: res.message };
  }

  async waitForReceipt(hash: Hex, timeoutMs = 60_000): Promise<ReceiptView | null> {
    try {
      const r = await this.client.waitForTransactionReceipt({ hash, confirmations: 1, timeout: timeoutMs });
      return { status: r.status, blockNumber: r.blockNumber, from: r.from, logs: r.logs };
    } catch {
      return null;
    }
  }
}
