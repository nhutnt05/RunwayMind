// The 10 routes of docs/08 §1, in navigation order.
export interface AppRoute {
  href: string;
  label: string;
  priority: 'MUST' | 'COULD';
}

export const APP_ROUTES: readonly AppRoute[] = [
  { href: '/', label: 'Dashboard', priority: 'MUST' },
  { href: '/treasury', label: 'Treasury Overview', priority: 'MUST' },
  { href: '/obligations', label: 'Obligation Management', priority: 'MUST' },
  { href: '/cash-ladder', label: 'Cash Ladder', priority: 'MUST' },
  { href: '/vault', label: 'Yield Vault', priority: 'MUST' },
  { href: '/pools', label: 'Pool Risk Dashboard', priority: 'COULD' },
  { href: '/stress-test', label: 'Stress Test', priority: 'COULD' },
  { href: '/agent', label: 'AI Agent Activity', priority: 'MUST' },
  { href: '/transactions', label: 'Transaction History', priority: 'MUST' },
  { href: '/settings', label: 'Settings & Policy Configuration', priority: 'MUST' },
] as const;

export function isActiveRoute(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}
