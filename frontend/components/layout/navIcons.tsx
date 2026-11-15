// Sidebar icons, one per route (lib/routes.ts) plus the collapse/expand toggle. Decorative (aria-hidden via Icon):
// every link keeps its text label, visually or as sr-only text when the sidebar is collapsed.
import type { ReactNode } from 'react';
import { Icon } from '@/components/ui/icons';

type P = { className?: string };

const ROUTE_ICON_PATHS: Record<string, ReactNode> = {
  // Dashboard: 2 × 2 grid
  '/': (
    <>
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
    </>
  ),
  // Treasury: institution / bank
  '/treasury': (
    <>
      <path d="M3 10 12 4l9 6" />
      <path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 21h18" />
    </>
  ),
  // Obligations: checklist
  '/obligations': (
    <>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <path d="m3.5 6 1 1 2-2M3.5 12l1 1 2-2M3.5 18l1 1 2-2" />
    </>
  ),
  // Cash Ladder: ascending steps
  '/cash-ladder': <path d="M3 20h5v-5h5v-5h5V5h3" />,
  // Yield Vault: safe with dial
  '/vault': (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 8.5V7M12 17v-1.5M7 20v1.5M17 20v1.5" />
    </>
  ),
  // Pool Risk: shield
  '/pools': (
    <>
      <path d="M12 3 4.5 6v5.5c0 4.5 3.2 8 7.5 9.5 4.3-1.5 7.5-5 7.5-9.5V6Z" />
      <path d="M12 8v5M12 16h.01" />
    </>
  ),
  // Stress Test: pulse line
  '/stress-test': <path d="M3 12h4l2.5-6 4 12 2.5-6H21" />,
  // AI Agent: chip
  '/agent': (
    <>
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="1" />
      <path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3" />
    </>
  ),
  // Transactions: two-way arrows
  '/transactions': <path d="M4 8h14l-3-3M20 16H6l3 3" />,
  // Settings: sliders
  '/settings': (
    <>
      <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12" />
      <circle cx="16" cy="6" r="2" />
      <circle cx="10" cy="12" r="2" />
      <circle cx="18" cy="18" r="2" />
    </>
  ),
};

export function RouteIcon({ href, className = 'h-5 w-5' }: { href: string } & P) {
  const paths = ROUTE_ICON_PATHS[href];
  return paths ? <Icon className={className}>{paths}</Icon> : <Icon className={className}><circle cx="12" cy="12" r="3" /></Icon>;
}

/** Sidebar panel with an arrow: points left to collapse, right to expand. */
export const SidebarToggleIcon = ({ collapsed, className = 'h-5 w-5' }: { collapsed: boolean } & P) => (
  <Icon className={className}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M9 4v16" />
    {collapsed ? <path d="m13 10 2 2-2 2" /> : <path d="m16 10-2 2 2 2" />}
  </Icon>
);

export const ROUTES_WITH_ICONS = Object.keys(ROUTE_ICON_PATHS);
