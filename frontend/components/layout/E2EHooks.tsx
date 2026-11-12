'use client';

import { useEffect } from 'react';
import { useAccount, useConnect, useDisconnect, useSwitchChain } from 'wagmi';
import { publicEnv } from '@/lib/env';

declare global {
  interface Window {
    __runwaymindE2E?: { connect(chainId?: number): Promise<void>; disconnect(): Promise<void>; ready: true };
  }
}

/**
 * Playwright hook (NEXT_PUBLIC_E2E=true only): connects wagmi's mock connector, optionally on a specific chain, so
 * tests can drive the real app without a browser wallet extension. Renders nothing; inert in normal builds.
 */
export function E2EHooks() {
  const { connectAsync, connectors } = useConnect();
  const { disconnectAsync } = useDisconnect();
  const { isConnected, chainId: currentChainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  useEffect(() => {
    if (!publicEnv.e2e) return;
    window.__runwaymindE2E = {
      ready: true,
      connect: async (chainId?: number) => {
        if (isConnected) {
          if (chainId && chainId !== currentChainId) await switchChainAsync({ chainId });
          return;
        }
        const connector = connectors[0];
        if (!connector) throw new Error('no mock connector');
        await connectAsync({ connector, ...(chainId ? { chainId } : {}) });
      },
      disconnect: async () => {
        await disconnectAsync();
      },
    };
    return () => {
      delete window.__runwaymindE2E;
    };
  }, [connectAsync, disconnectAsync, connectors, isConnected, currentChainId, switchChainAsync]);
  return null;
}
