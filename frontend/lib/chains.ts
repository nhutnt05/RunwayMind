import { anvil, avalancheFuji } from 'wagmi/chains';
import { publicEnv } from './env';

/**
 * The app runs on Avalanche Fuji (43113). For local development against Anvil set NEXT_PUBLIC_CHAIN_ID=31337 and
 * NEXT_PUBLIC_FUJI_RPC_URL=http://127.0.0.1:8545 (docs/11 §5); every other value falls back to Fuji.
 */
export const appChain =
  publicEnv.chainId === anvil.id
    ? // Anvil's default RPC is :8545; use the configured URL (wagmi's mock connector sends wallet calls there).
      { ...anvil, rpcUrls: { default: { http: [publicEnv.fujiRpcUrl] } } }
    : avalancheFuji;
