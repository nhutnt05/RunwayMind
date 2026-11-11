// viem clients (docs/05 §3, docs/07 §6): public client with fallback transport; wallet clients for AGENT and KEEPER.
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  fallback,
  http,
  type Account,
  type Chain,
  type PublicClient,
  type WalletClient,
  type Transport,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { anvil, avalancheFuji } from 'viem/chains';
import type { AgentConfig } from '../config';

export function chainFor(chainId: number, rpcUrl: string): Chain {
  if (chainId === avalancheFuji.id) return avalancheFuji;
  if (chainId === anvil.id) return anvil;
  return defineChain({
    id: chainId,
    name: `chain-${chainId}`,
    nativeCurrency: { name: 'AVAX', symbol: 'AVAX', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
}

export function transportFor(rpcUrl: string, fallbackUrl?: string): Transport {
  const opts = { retryCount: 2, timeout: 10_000 } as const;
  return fallbackUrl ? fallback([http(rpcUrl, opts), http(fallbackUrl, opts)], { rank: false }) : http(rpcUrl, opts);
}

export function createChainPublicClient(cfg: Pick<AgentConfig, 'CHAIN_ID' | 'FUJI_RPC_URL' | 'FUJI_RPC_URL_FALLBACK'>): PublicClient {
  return createPublicClient({
    chain: chainFor(cfg.CHAIN_ID, cfg.FUJI_RPC_URL),
    transport: transportFor(cfg.FUJI_RPC_URL, cfg.FUJI_RPC_URL_FALLBACK),
  }) as PublicClient;
}

export type SignerRole = 'AGENT' | 'KEEPER';

/** Wallet client for the AGENT or KEEPER key. Keys come only from env (rule 7); returns null when unset. */
export function createRoleWalletClient(
  cfg: AgentConfig,
  role: SignerRole,
): (WalletClient<Transport, Chain, Account> & { role: SignerRole }) | null {
  const key = role === 'AGENT' ? cfg.AGENT_PRIVATE_KEY : cfg.KEEPER_PRIVATE_KEY;
  if (!key) return null;
  const client = createWalletClient({
    account: privateKeyToAccount(key as `0x${string}`),
    chain: chainFor(cfg.CHAIN_ID, cfg.FUJI_RPC_URL),
    transport: transportFor(cfg.FUJI_RPC_URL, cfg.FUJI_RPC_URL_FALLBACK),
  });
  return Object.assign(client, { role });
}
