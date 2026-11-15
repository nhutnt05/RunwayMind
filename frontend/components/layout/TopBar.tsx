'use client';

import { ConnectButton } from '@rainbow-me/rainbowkit';
import Link from 'next/link';
import { appChain } from '@/lib/chains';
import { CircuitBreakerBadge } from './CircuitBreakerBadge';
import { DemoModeBadge } from './DemoModeBadge';
import { SignInButton } from './SignInButton';
import { TreasurySwitcher } from './TreasurySwitcher';

export function TopBar() {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
      <div className="flex h-16 items-center gap-3 px-4">
        <Link href="/" className="flex items-center gap-2 rounded-md font-semibold text-slate-900">
          <span aria-hidden className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-dark text-white">
            R
          </span>
          <span className="hidden sm:inline">RunwayMind</span>
          <span className="sr-only sm:hidden">RunwayMind home</span>
        </Link>
        <span className="hidden rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 md:inline">
          {appChain.name}
        </span>
        <DemoModeBadge />
        <div className="ml-auto flex items-center gap-2">
          <TreasurySwitcher />
          <CircuitBreakerBadge />
          <SignInButton />
          {/* No chain button below sm: with a wallet connected it can render the network name and push the header past
              375 px. A wrong network is still flagged by NetworkGuard's blocking banner. */}
          <ConnectButton chainStatus={{ smallScreen: 'none', largeScreen: 'icon' }} accountStatus={{ smallScreen: 'avatar', largeScreen: 'full' }} showBalance={false} />
        </div>
      </div>
    </header>
  );
}
