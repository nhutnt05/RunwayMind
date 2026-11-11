'use client';

import { useSiweSession } from '@/hooks/useSiweSession';

/** SIWE sign-in after wallet connect (docs/08 §2 ConnectButton row, §7). */
export function SignInButton() {
  const { canSignIn, isSignedIn, session, signIn, signOut } = useSiweSession();
  if (isSignedIn) {
    return (
      <button
        type="button"
        onClick={() => signOut.mutate()}
        className="hidden rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 sm:inline"
        title={session?.isAdmin ? 'Signed in as ADMIN' : 'Signed in'}
      >
        {session?.isAdmin ? 'ADMIN · ' : ''}Sign out
      </button>
    );
  }
  if (!canSignIn) return null;
  return (
    <button
      type="button"
      onClick={() => signIn.mutate()}
      disabled={signIn.isPending}
      className="rounded-md bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-60"
      title={signIn.error ? (signIn.error as Error).message : 'Sign-In with Ethereum to manage the treasury'}
    >
      {signIn.isPending ? 'Signing…' : 'Sign in'}
    </button>
  );
}
