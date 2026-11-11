'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { APP_ROUTES, isActiveRoute } from '@/lib/routes';

function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <ul className="space-y-1">
      {APP_ROUTES.map((route) => {
        const active = isActiveRoute(pathname, route.href);
        return (
          <li key={route.href}>
            <Link
              href={route.href}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              className={`block rounded-md px-3 py-2 text-sm font-medium ${
                active ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              {route.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function SideNav() {
  const pathname = usePathname() ?? '/';
  const [open, setOpen] = useState(false);

  useEffect(() => setOpen(false), [pathname]);

  return (
    <>
      {/* Desktop: left nav (≥ lg) */}
      <nav aria-label="Main" className="hidden w-64 shrink-0 border-r border-slate-200 bg-white px-3 py-6 lg:block">
        <NavLinks pathname={pathname} />
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
            <NavLinks pathname={pathname} onNavigate={() => setOpen(false)} />
          </nav>
        ) : null}
      </div>
    </>
  );
}
