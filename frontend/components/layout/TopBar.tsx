'use client';

import { ConnectButton } from '@rainbow-me/rainbowkit';
import Link from 'next/link';
import { appChain } from '@/lib/chains';
import { CircuitBreakerBadge } from './CircuitBreakerBadge';
import { DemoModeBadge } from './DemoModeBadge';
import { SignInButton } from './SignInButton';

export function TopBar() {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-screen-2xl items-center gap-3 px-4 md:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold text-slate-900">
          <span aria-hidden className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-white">
            R
          </span>
          <span className="hidden sm:inline">RunwayMind</span>
        </Link>
        <span className="hidden rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 md:inline">
          {appChain.name}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <DemoModeBadge />
          <CircuitBreakerBadge />
          <SignInButton />
          <ConnectButton chainStatus="icon" accountStatus={{ smallScreen: 'avatar', largeScreen: 'full' }} showBalance={false} />
        </div>
      </div>
    </header>
  );
}
