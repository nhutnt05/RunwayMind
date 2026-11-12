import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { coreWallet, injectedWallet, metaMaskWallet } from '@rainbow-me/rainbowkit/wallets';
import type { Address } from 'viem';
import { createConfig, http } from 'wagmi';
import { avalancheFuji, mainnet } from 'wagmi/chains';
import { mock } from 'wagmi/connectors';
import { appChain } from './chains';
import { publicEnv } from './env';

const projectId = publicEnv.walletConnectProjectId || 'runwaymind-local-dev';

/** Anvil account #0 = ADMIN in deployment/local.json (public test address, no key involved). */
export const E2E_ACCOUNT: Address = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
/** A chain the E2E wallet can start on to exercise the wrong-network banner (docs/10 §6). */
export const E2E_WRONG_CHAIN = appChain.id === avalancheFuji.id ? mainnet : avalancheFuji;

/**
 * Playwright only (NEXT_PUBLIC_E2E=true, docs/10 §6): wagmi's mock connector. Wallet calls (eth_sendTransaction,
 * personal_sign → eth_sign) go to Anvil, whose default accounts are unlocked, so real txs are mined without keys.
 */
function e2eConfig() {
  return createConfig({
    chains: [appChain, E2E_WRONG_CHAIN],
    // defaultConnected + reconnect: the mock wallet survives page navigations (its state is in-memory).
    connectors: [mock({ accounts: [E2E_ACCOUNT], features: { reconnect: true, defaultConnected: true } })],
    transports: { [appChain.id]: http(publicEnv.fujiRpcUrl), [E2E_WRONG_CHAIN.id]: http() } as never,
    ssr: true,
  });
}

export const wagmiConfig = publicEnv.e2e
  ? e2eConfig()
  : getDefaultConfig({
      appName: 'RunwayMind',
      projectId,
      chains: [appChain],
      transports: { [appChain.id]: http(publicEnv.fujiRpcUrl) },
      wallets: [{ groupName: 'Recommended', wallets: [coreWallet, metaMaskWallet, injectedWallet] }],
      ssr: true,
    });
