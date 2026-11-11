import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'RunwayMind — AI CFO for DAOs',
  description: 'Cash Ladder treasury management on Avalanche Fuji',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
