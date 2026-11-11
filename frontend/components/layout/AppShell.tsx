import type { ReactNode } from 'react';
import { NetworkGuard } from './NetworkGuard';
import { SideNav } from './SideNav';
import { TopBar } from './TopBar';

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <TopBar />
      <NetworkGuard />
      <div className="mx-auto flex w-full max-w-screen-2xl flex-1">
        <SideNav />
        {/* pb-20 leaves room for the mobile bottom navigation bar */}
        <main className="min-w-0 flex-1 px-4 py-6 pb-20 md:px-6 lg:pb-6">{children}</main>
      </div>
    </div>
  );
}
