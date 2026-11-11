'use client';

import { useState } from 'react';
import { shortAddress } from '@/lib/format';

export function AddressChip({ address, label }: { address: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable: ignore */
    }
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-800">
      {label ? <span className="font-sans font-medium">{label}</span> : null}
      <span title={address}>{shortAddress(address)}</span>
      <button
        type="button"
        onClick={copy}
        className="text-slate-600 hover:text-slate-900"
        aria-label={`Copy address ${address}`}
      >
        {copied ? '✓' : '⧉'}
      </button>
    </span>
  );
}
