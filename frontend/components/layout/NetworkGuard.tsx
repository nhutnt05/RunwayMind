'use client';

import { useAccount, useSwitchChain } from 'wagmi';
import { appChain } from '@/lib/chains';
import { describeWriteError } from '@/lib/preparedTx';

// docs/08 §7: if a wallet is connected to any chain other than 43113, show a blocking banner with switchChain.
export function NetworkGuard() {
  const { isConnected, chainId } = useAccount();
  const { switchChain, isPending, error } = useSwitchChain();

  if (!isConnected || chainId === appChain.id) return null;

  return (
    <div role="alert" className="border-b border-red-300 bg-red-50">
      <div className="mx-auto flex max-w-screen-2xl flex-col gap-2 px-4 py-3 text-sm text-red-900 sm:flex-row sm:items-center md:px-6">
        <p className="flex-1">
          <span aria-hidden>⚠️ </span>
          <strong>Wrong network.</strong> RunwayMind runs on {appChain.name} (chain ID {appChain.id}). Your wallet is on chain{' '}
          {chainId ?? 'unknown'}.
          {/* Wallet errors can quote the RPC URL (API key): redact like every other wallet error. */}
          {error ? <span className="block text-red-800">Switch failed: {describeWriteError(error)}</span> : null}
        </p>
        <button
          type="button"
          onClick={() => switchChain({ chainId: appChain.id })}
          disabled={isPending}
          className="rounded-md bg-red-700 px-3 py-1.5 font-medium text-white hover:bg-red-800 disabled:opacity-60"
        >
          {isPending ? 'Switching…' : `Switch to ${appChain.name}`}
        </button>
      </div>
    </div>
  );
}
