'use client';

import { useAccount } from 'wagmi';
import { adminGate } from '@/lib/recommendations';
import { useIsAdmin } from './useIsAdmin';
import { useSiweSession } from './useSiweSession';

/** Wallet connected + on-chain ADMIN + SIWE session → admin controls enabled (docs/08 §7, §8). */
export function useAdminGate() {
  const { isConnected } = useAccount();
  const { isAdmin } = useIsAdmin();
  const { isSignedIn } = useSiweSession();
  return adminGate({ isConnected, isAdmin, isSignedIn });
}
