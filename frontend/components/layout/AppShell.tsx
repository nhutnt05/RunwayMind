import type { ReactNode } from 'react';
import { NetworkGuard } from './NetworkGuard';
import { SideNav } from './SideNav';
import { TopBar } from './TopBar';

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      {/* Keyboard users can bypass the header and navigation (docs/08 §9). */}
      <a
        href="#main-content"
        className="sr-only z-50 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to main content
      </a>
      <TopBar />
      <NetworkGuard />
      <div className="mx-auto flex w-full max-w-screen-2xl flex-1">
        <SideNav />
        {/* pb-20 leaves room for the mobile bottom navigation bar */}
        <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 px-4 py-6 pb-20 focus:outline-none focus-visible:ring-0 md:px-6 lg:pb-6">
          {children}
        </main>
      </div>
    </div>
  );
}
