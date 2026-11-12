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

/** docs/01 §9 RPC row: viem `fallback` over 2 RPC URLs; 3 retries on timeout / rate limit. */
export const RPC_RETRY_COUNT = 3;

export function transportFor(rpcUrl: string, fallbackUrl?: string): Transport {
  const timeout = 10_000;
  if (!fallbackUrl) return http(rpcUrl, { retryCount: RPC_RETRY_COUNT, timeout });
  // With a fallback URL a timeout / 429 on the primary fails over immediately (no per-URL retries); the whole
  // primary → fallback round is retried RPC_RETRY_COUNT times (each URL is tried at most 1 + 3 times per request).
  const inner = { retryCount: 0, timeout } as const;
  return fallback([http(rpcUrl, inner), http(fallbackUrl, inner)], { rank: false, retryCount: RPC_RETRY_COUNT });
}

export function createChainPublicClient(cfg: Pick<AgentConfig, 'CHAIN_ID' | 'FUJI_RPC_URL' | 'FUJI_RPC_URL_FALLBACK'>): PublicClient {
  return createPublicClient({
    chain: chainFor(cfg.CHAIN_ID, cfg.FUJI_RPC_URL),
    transport: transportFor(cfg.FUJI_RPC_URL, cfg.FUJI_RPC_URL_FALLBACK),
    pollingInterval: 1_000, // receipts within ~1 block on Fuji (approve -> Snowtrace <= 10 s, docs/05 §13)
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
