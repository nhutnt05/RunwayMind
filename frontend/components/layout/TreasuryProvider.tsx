'use client';

import { useQuery } from '@tanstack/react-query';
import { Fragment, useSyncExternalStore, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { applyTreasury } from '@/lib/contracts';
import {
  getSelectedTreasuryId,
  resolveSelectedTreasury,
  setSelectedTreasuryId,
  subscribeTreasury,
  type TreasuryInfo,
} from '@/lib/treasurySelection';

/** GET /treasuries; null when the API is unavailable or older (→ shared deployment file fallback). */
export function useTreasuries() {
  return useQuery({
    queryKey: ['treasuries'],
    queryFn: async () => {
      try {
        return (await api.get<TreasuryInfo[]>('/treasuries')).data;
      } catch {
        return null;
      }
    },
    staleTime: 60_000,
  });
}

export function useSelectedTreasuryId(): string | null {
  return useSyncExternalStore(subscribeTreasury, getSelectedTreasuryId, () => null);
}

/**
 * Applies the selected treasury to the live contract bindings before children render, and remounts the subtree when
 * the selection changes (query cache keys are already per treasury, see providers.tsx).
 */
export function TreasuryProvider({ children }: { children: ReactNode }) {
  const list = useTreasuries().data ?? null;
  const selectedId = useSelectedTreasuryId();
  const active = list ? resolveSelectedTreasury(list, selectedId) : null;
  if (active && active.id !== selectedId) queueMicrotask(() => setSelectedTreasuryId(active.id));
  applyTreasury(active);
  const key = list && list.length > 1 && active ? active.id : 'single';
  return <Fragment key={key}>{children}</Fragment>;
}
