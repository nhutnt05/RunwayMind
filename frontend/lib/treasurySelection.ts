// Multi-treasury selection (D6, docs/11 §7.2 "UI shows a treasury switcher"). The backend lists treasuries at
// GET /treasuries (primary first); every API request carries `?treasury=<id>`; the choice persists per browser.
import type { Address } from '@runwaymind/shared';

/** GET /api/v1/treasuries item. */
export interface TreasuryInfo {
  id: string;
  chainId: number;
  isPrimary: boolean;
  treasuryAddress: Address;
  registryAddress: Address;
  policyAddress: Address;
  assetAddress: Address;
  assetSymbol: string;
  assetDecimals: number;
  demoStartTime: number | null;
  deployBlock: string;
  poolAddress: Address | null;
  adapterAddress: Address | null;
}

export const TREASURY_STORAGE_KEY = 'runwaymind.treasury';

/** Stored choice if it still exists, else the primary treasury, else the first one; null for an empty list. */
export function resolveSelectedTreasury(list: readonly TreasuryInfo[], storedId: string | null): TreasuryInfo | null {
  if (!list.length) return null;
  return list.find((t) => t.id === storedId) ?? list.find((t) => t.isPrimary) ?? list[0]!;
}

/** Adds / replaces `treasury=<id>` on an API path ("/a?b=1" → "/a?b=1&treasury=x"); unchanged when id is null. */
export function withTreasuryParam(path: string, id: string | null): string {
  if (!id) return path;
  const [base, query = ''] = path.split('?', 2) as [string, string?];
  const params = new URLSearchParams(query);
  params.set('treasury', id);
  return `${base}?${params.toString()}`;
}

/** Reads the persisted choice; storage may be unavailable (SSR, private mode, blocked site data). */
export function readStoredTreasuryId(storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): string | null {
  try {
    return storage?.getItem(TREASURY_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

// ---- tiny external store (useSyncExternalStore) ------------------------------------------------------------------

let selectedId: string | null | undefined; // undefined = not read from storage yet
const listeners = new Set<() => void>();

export function getSelectedTreasuryId(): string | null {
  if (selectedId === undefined) selectedId = readStoredTreasuryId();
  return selectedId;
}

export function setSelectedTreasuryId(id: string | null): void {
  if (id === getSelectedTreasuryId()) return;
  selectedId = id;
  try {
    const s = safeStorage();
    if (id) s?.setItem(TREASURY_STORAGE_KEY, id);
    else s?.removeItem(TREASURY_STORAGE_KEY);
  } catch {
    /* persistence is a convenience only */
  }
  for (const l of listeners) l();
}

export function subscribeTreasury(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
