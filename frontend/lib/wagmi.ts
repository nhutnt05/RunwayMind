import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { coreWallet, injectedWallet, metaMaskWallet } from '@rainbow-me/rainbowkit/wallets';
import { http } from 'wagmi';
import { appChain } from './chains';
import { publicEnv } from './env';

// RainbowKit requires a WalletConnect (Reown) project id. Injected Core / MetaMask extensions work without a
// valid one; only the WalletConnect QR fallback needs NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID to be set.
const projectId = publicEnv.walletConnectProjectId || 'runwaymind-local-dev';

export const wagmiConfig = getDefaultConfig({
  appName: 'RunwayMind',
  projectId,
  chains: [appChain],
  transports: { [appChain.id]: http(publicEnv.fujiRpcUrl) },
  wallets: [{ groupName: 'Recommended', wallets: [coreWallet, metaMaskWallet, injectedWallet] }],
  ssr: true,
});
