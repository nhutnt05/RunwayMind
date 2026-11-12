'use client';

import { useSiweSession } from '@/hooks/useSiweSession';
import { describeWriteError } from '@/lib/preparedTx';

/** SIWE sign-in after wallet connect (docs/08 §2 ConnectButton row, §7). */
export function SignInButton() {
  const { canSignIn, isSignedIn, session, signIn, signOut } = useSiweSession();
  if (isSignedIn) {
    return (
      <button
        type="button"
        onClick={() => signOut.mutate()}
        className="whitespace-nowrap rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
        title={session?.isAdmin ? 'Signed in as ADMIN' : 'Signed in'}
      >
        {session?.isAdmin ? <span className="hidden sm:inline">ADMIN · </span> : null}Sign out
      </button>
    );
  }
  if (!canSignIn) return null;
  // Wallet / API errors can quote RPC URLs: redact before showing them (same rule as the tx write flow).
  const error = signIn.error ? describeWriteError(signIn.error) : null;
  return (
    <span className="flex items-center gap-2">
      {error ? (
        <span role="alert" className="text-xs font-semibold text-red-800" title={error}>
          <span aria-hidden>⚠ </span>
          <span aria-hidden className="hidden md:inline">
            Sign-in failed
          </span>
          <span className="sr-only">Sign-in failed: {error}</span>
        </span>
      ) : null}
      <button
        type="button"
        onClick={() => signIn.mutate()}
        disabled={signIn.isPending}
        className="whitespace-nowrap rounded-md bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-60"
        title="Sign-In with Ethereum to manage the treasury"
      >
        {signIn.isPending ? 'Signing…' : 'Sign in'}
      </button>
    </span>
  );
}
