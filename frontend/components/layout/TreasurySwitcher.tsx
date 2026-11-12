'use client';

import { resolveSelectedTreasury, setSelectedTreasuryId } from '@/lib/treasurySelection';
import { useSelectedTreasuryId, useTreasuries } from './TreasuryProvider';

/** TopBar treasury selector (D6, docs/11 §7.2). Hidden when the backend lists fewer than two treasuries. */
export function TreasurySwitcher() {
  const list = useTreasuries().data ?? null;
  const selectedId = useSelectedTreasuryId();
  if (!list || list.length < 2) return null;
  const active = resolveSelectedTreasury(list, selectedId);
  return (
    <label className="flex items-center gap-1 text-xs text-slate-600">
      <span className="hidden lg:inline">Treasury</span>
      <select
        aria-label="Select treasury"
        data-testid="treasury-switcher"
        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-900"
        value={active?.id ?? ''}
        onChange={(e) => setSelectedTreasuryId(e.target.value)}
      >
        {list.map((t) => (
          <option key={t.id} value={t.id}>
            {t.assetSymbol} · {t.id}
            {t.isPrimary ? ' (primary)' : ''}
          </option>
        ))}
      </select>
    </label>
  );
}
