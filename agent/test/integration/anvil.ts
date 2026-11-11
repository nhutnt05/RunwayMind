// Shared Anvil harness for integration tests (docs/11 §5 local deployment). Uses Anvil's PUBLIC default accounts:
// #0 = ADMIN (deployer), #1 = AGENT, #2 = KEEPER (no role). Every test runs inside evm_snapshot / evm_revert.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPublicClient, createTestClient, createWalletClient, http, type Address, type Hex, type PublicClient, type TestClient } from 'viem';
import type { Deployment } from '@runwaymind/shared';
import type { AgentWallet } from '../../src/executor/send';
import { privateKeyToAccount } from 'viem/accounts';
import { anvil } from 'viem/chains';
import { treasuryAbi } from '@runwaymind/shared/abi';
import { loadDeployment } from '@runwaymind/shared';
import { decodeContractError } from '../../src/chain/errors';
import type { CoreAddresses } from '../../src/chain/reader';

export const RPC = process.env.ANVIL_RPC_URL ?? 'http://127.0.0.1:8545';
export const DEPLOYMENT = resolve(__dirname, '../../../deployment/local.json');
export const ANVIL_KEYS = {
  admin: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  agent: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  keeper: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdfa8ac8',
} as const satisfies Record<string, Hex>;
export const DAY = 86_400n;
export const USDC = (n: number | bigint) => BigInt(n) * 1_000_000n;

export const deploymentAvailable = existsSync(DEPLOYMENT);

export async function anvilReachable(): Promise<boolean> {
  try {
    const res = await fetch(RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
    });
    return ((await res.json()) as { result?: string }).result === '0x7a69';
  } catch {
    return false;
  }
}

export interface Harness {
  deployment: Deployment;
  addresses: CoreAddresses;
  client: PublicClient;
  test: TestClient<'anvil'>;
  admin: AgentWallet;
  agent: AgentWallet;
  keeper: AgentWallet;
  adminSend(functionName: 'advanceTime' | 'invest' | 'tripCircuitBreaker' | 'pay', args?: readonly unknown[]): Promise<Hex>;
  read<T>(functionName: string, args?: readonly unknown[]): Promise<T>;
  adapter: Address;
  t0: bigint;
  advanceDays(days: bigint): Promise<void>;
}

export function harness(): Harness {
  const d = loadDeployment(JSON.parse(readFileSync(DEPLOYMENT, 'utf8')));
  const addresses: CoreAddresses = {
    treasury: d.contracts.Treasury,
    registry: d.contracts.ObligationRegistry,
    policy: d.contracts.PolicyEngine,
  };
  const client = createPublicClient({ chain: anvil, transport: http(RPC), pollingInterval: 100 }) as PublicClient;
  const test = createTestClient({ chain: anvil, mode: 'anvil', transport: http(RPC) }) as unknown as TestClient<'anvil'>;
  const wallet = (key: Hex): AgentWallet => createWalletClient({ chain: anvil, transport: http(RPC), account: privateKeyToAccount(key) });
  const admin = wallet(ANVIL_KEYS.admin);
  const agent = wallet(ANVIL_KEYS.agent);
  const keeper = wallet(ANVIL_KEYS.keeper);

  async function adminSend(functionName: 'advanceTime' | 'invest' | 'tripCircuitBreaker' | 'pay', args: readonly unknown[] = []) {
    try {
      const hash = await admin.writeContract({ address: addresses.treasury, abi: treasuryAbi, functionName, args } as never);
      await client.waitForTransactionReceipt({ hash });
      return hash;
    } catch (e) {
      throw new Error(`${functionName} reverted: ${JSON.stringify(decodeContractError(e))}`);
    }
  }

  const read = <T>(functionName: string, args: readonly unknown[] = []) =>
    client.readContract({ address: addresses.treasury, abi: treasuryAbi, functionName, args } as never) as Promise<T>;

  return {
    deployment: d,
    addresses,
    client,
    test,
    admin,
    agent,
    keeper,
    adminSend,
    read,
    adapter: d.contracts.VaultAdapter as Address,
    t0: BigInt(d.demoStartTime ?? 0),
    async advanceDays(days: bigint) {
      await adminSend('advanceTime', [days * DAY]);
    },
  };
}

