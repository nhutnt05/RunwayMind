'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createSiweMessage } from 'viem/siwe';
import { useAccount, useSignMessage } from 'wagmi';
import { AuthVerifyRequestSchema, type Address } from '@runwaymind/shared';
import { ApiError, api } from '@/lib/api';
import { appChain } from '@/lib/chains';

export interface SessionInfo {
  address: Address;
  isAdmin: boolean;
  isAgent: boolean;
  expiresAt: number;
}

/** SIWE flow (docs/08 §7): /auth/nonce → signMessage → /auth/verify → cookie session; /auth/me for state. */
export function useSiweSession() {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const qc = useQueryClient();

  const me = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: async () => {
      try {
        return (await api.get<SessionInfo>('/auth/me')).data;
      } catch (e) {
        if (e instanceof ApiError && e.code === 'UNAUTHENTICATED') return null;
        throw e;
      }
    },
    staleTime: 60_000,
  });

  const signIn = useMutation({
    mutationFn: async () => {
      if (!address) throw new Error('Connect a wallet first');
      const { nonce } = (await api.post<{ nonce: string }>('/auth/nonce')).data;
      const message = createSiweMessage({
        address,
        chainId: appChain.id,
        domain: window.location.host,
        nonce,
        uri: window.location.origin,
        version: '1',
        statement: 'Sign in to RunwayMind',
      });
      const signature = await signMessageAsync({ message });
      return (await api.postValidated('/auth/verify', AuthVerifyRequestSchema, { message, signature })).data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['auth', 'me'] }),
  });

  const signOut = useMutation({
    mutationFn: () => api.post('/auth/logout'),
    onSuccess: () => qc.setQueryData(['auth', 'me'], null),
  });

  const session = me.data ?? null;
  const matchesWallet = Boolean(session && address && session.address.toLowerCase() === address.toLowerCase());
  return {
    session: matchesWallet ? session : null,
    isSignedIn: matchesWallet,
    canSignIn: isConnected && !matchesWallet,
    signIn,
    signOut,
    isLoading: me.isLoading,
  };
}
