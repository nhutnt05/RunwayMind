'use client';

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type MouseEvent } from 'react';
import { prefetchRouteData } from '@/lib/routePrefetch';
import { APP_ROUTES, isActiveRoute } from '@/lib/routes';
import { RouteIcon, SidebarToggleIcon } from './navIcons';

/** Per-browser preference (a convenience only: the page works without storage, e.g. in private windows). */
export const SIDEBAR_STORAGE_KEY = 'rm.sidebar.collapsed';

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, collapsed ? '1' : '0');
  } catch {
    /* storage unavailable: the choice just isn't remembered */
  }
}

/** A plain left click that Next will handle client-side (not a new tab / window / download). */
function isPlainClick(e: MouseEvent): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.defaultPrevented;
}

function NavLinks({
  pathname,
  pendingHref,
  onNavigate,
  onIntent,
  collapsed = false,
}: {
  pathname: string;
  pendingHref: string | null;
  onNavigate: (href: string, e: MouseEvent) => void;
  onIntent: (href: string) => void;
  /** Icon-only strip: labels stay as screen-reader text and as a hover tooltip. */
  collapsed?: boolean;
}) {
  return (
    <ul className="space-y-1">
      {APP_ROUTES.map((route) => {
        const active = isActiveRoute(pathname, route.href);
        // Optimistic highlight: the clicked item turns active immediately, before the route has rendered.
        const highlighted = pendingHref !== null ? pendingHref === route.href : active;
        const pending = pendingHref === route.href && !active;
        return (
          <li key={route.href}>
            <Link
              href={route.href}
              onClick={(e) => onNavigate(route.href, e)}
              onMouseEnter={() => onIntent(route.href)}
              onFocus={() => onIntent(route.href)}
              onTouchStart={() => onIntent(route.href)}
              aria-current={active ? 'page' : undefined}
              aria-busy={pending || undefined}
              className={`group relative flex items-center rounded-lg text-sm font-medium transition-colors ${
                collapsed ? 'mx-auto h-10 w-10 justify-center' : 'gap-3 px-3 py-2'
              } ${highlighted ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`}
            >
              <RouteIcon
                href={route.href}
                className={`h-5 w-5 shrink-0 ${highlighted ? 'text-white' : 'text-slate-400 group-hover:text-slate-700'}`}
              />
              <span className={collapsed ? 'sr-only' : 'min-w-0 flex-1 truncate'}>{route.label}</span>
              {pending ? (
                <span
                  aria-hidden
                  className={`h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white ${collapsed ? 'absolute -right-0.5 -top-0.5' : 'ml-2'}`}
                />
              ) : null}
              {collapsed ? (
                // Visual tooltip for the icon strip (the accessible name is the sr-only label above).
                <span
                  aria-hidden
                  className="pointer-events-none absolute left-full top-1/2 z-40 ml-3 -translate-y-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                >
                  {route.label}
                </span>
              ) : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function SideNav() {
  const pathname = usePathname() ?? '/';
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  // Desktop sidebar width. Read after mount (not during render) so server and client markup match.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => setCollapsed(readCollapsed()), []);
  const toggleCollapsed = () =>
    setCollapsed((c) => {
      writeCollapsed(!c);
      return !c;
    });

  // The route has rendered: drop the optimistic state and close the mobile sheet.
  useEffect(() => {
    setOpen(false);
    setPendingHref(null);
  }, [pathname]);

  const onIntent = (href: string) => prefetchRouteData(queryClient, href);
  const onNavigate = (href: string, e: MouseEvent) => {
    if (!isPlainClick(e) || isActiveRoute(pathname, href)) return;
    prefetchRouteData(queryClient, href);
    setPendingHref(href);
  };

  return (
    <>
      {/* Desktop: left nav (≥ lg), collapsible to an icon strip to give pages (e.g. wide tables) more width. */}
      <nav
        id="desktop-nav"
        aria-label="Main"
        data-collapsed={collapsed || undefined}
        className={`sticky top-16 hidden h-[calc(100vh-4rem)] shrink-0 self-start border-r border-slate-200 bg-white py-3 transition-[width] duration-200 ease-out motion-reduce:transition-none lg:block ${
          collapsed ? 'w-16 px-3' : 'w-72 px-3'
        }`}
      >
        <div className={`mb-2 flex h-10 items-center ${collapsed ? 'justify-center' : 'justify-between pl-3'}`}>
          {collapsed ? null : <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Menu</span>}
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-expanded={!collapsed}
            aria-controls="desktop-nav"
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          >
            <SidebarToggleIcon collapsed={collapsed} />
            <span className="sr-only">{collapsed ? 'Expand sidebar' : 'Collapse sidebar'}</span>
          </button>
        </div>
        <NavLinks pathname={pathname} pendingHref={pendingHref} onNavigate={onNavigate} onIntent={onIntent} collapsed={collapsed} />
      </nav>

      {/* Mobile: nav collapses into a bottom sheet (docs/08 §1) */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white lg:hidden">
        <button
          type="button"
          aria-expanded={open}
          aria-controls="mobile-nav"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium"
        >
          <span>{APP_ROUTES.find((r) => isActiveRoute(pathname, r.href))?.label ?? 'Menu'}</span>
          <span aria-hidden>{open ? '▾' : '▴'}</span>
          <span className="sr-only">{open ? 'Close navigation' : 'Open navigation'}</span>
        </button>
        {open ? (
          <nav id="mobile-nav" aria-label="Main" className="max-h-[70vh] overflow-y-auto border-t border-slate-200 px-3 py-3">
            <NavLinks
              pathname={pathname}
              pendingHref={pendingHref}
              onNavigate={(href, e) => {
                onNavigate(href, e);
                setOpen(false);
              }}
              onIntent={onIntent}
            />
          </nav>
        ) : null}
      </div>
    </>
  );
}
