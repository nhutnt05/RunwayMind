'use client';

import '@rainbow-me/rainbowkit/styles.css';
import { RainbowKitProvider } from '@rainbow-me/rainbowkit';
import { QueryClient, QueryClientProvider, hashKey } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { WagmiProvider } from 'wagmi';
import { E2EHooks } from '@/components/layout/E2EHooks';
import { TreasuryProvider } from '@/components/layout/TreasuryProvider';
import { TxToastViewport } from '@/components/tx/TxToast';
import { appChain } from '@/lib/chains';
import { publicEnv } from '@/lib/env';
import { getSelectedTreasuryId } from '@/lib/treasurySelection';
import { wagmiConfig } from '@/lib/wagmi';

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5_000,
            refetchOnWindowFocus: false,
            // D6 multi-treasury: cache entries are per selected treasury, so switching never shows another
            // treasury's data and refetches on first use.
            queryKeyHashFn: (key) => hashKey([getSelectedTreasuryId() ?? 'primary', ...key]),
          },
        },
      }),
  );

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider initialChain={appChain}>
          <TreasuryProvider>{children}</TreasuryProvider>
          <TxToastViewport />
          {publicEnv.e2e ? <E2EHooks /> : null}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
