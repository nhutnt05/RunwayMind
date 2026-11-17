// Summary of a POST /keeper/run result for the toast shown after "Advance time" (demo): which obligations were paid
// on the spot, or why not. The keeper's own interval run still pays anything this immediate run missed.

export interface KeeperRunJson {
  paidIds: string[];
  txHashes: string[];
  enforced: boolean;
  errors: { step: string; obligationId?: string; error: { name?: string } | string }[];
}

export interface KeeperRunSummary {
  status: 'CONFIRMED' | 'FAILED';
  message: string;
  hash?: `0x${string}`;
}

const errorText = (e: KeeperRunJson['errors'][number]) => {
  const what = typeof e.error === 'string' ? e.error : (e.error.name ?? 'error');
  return e.obligationId ? `#${e.obligationId}: ${what}` : `${e.step}: ${what}`;
};

export function keeperRunSummary(r: KeeperRunJson): KeeperRunSummary {
  const paid = r.paidIds.length ? `Paid ${r.paidIds.map((id) => `#${id}`).join(', ')}` : null;
  const pulled = r.enforced ? 'pulled funds back from the vault' : null;
  const done = [paid, pulled].filter(Boolean).join(' · ');
  const hash = r.txHashes[r.txHashes.length - 1] as `0x${string}` | undefined;
  if (r.errors.length) {
    return { status: 'FAILED', message: `${done ? `${done}. ` : ''}Could not finish: ${r.errors.map(errorText).join('; ')}`, ...(hash ? { hash } : {}) };
  }
  return { status: 'CONFIRMED', message: done || 'Nothing is due yet at the new date.', ...(hash ? { hash } : {}) };
}
