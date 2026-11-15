import { SkeletonGrid } from '@/components/ui';

/**
 * Route-level loading state (App Router Suspense boundary): shown instantly inside the persistent shell while the next
 * page's code loads (e.g. the first visit to a route under `next dev`, or a slow network), instead of a frozen page.
 */
export default function Loading() {
  return (
    <div data-route-loading aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading page…</span>
      <div className="mb-6 space-y-2">
        <div className="h-7 w-56 animate-pulse rounded bg-slate-200" />
        <div className="h-4 w-80 max-w-full animate-pulse rounded bg-slate-100" />
      </div>
      <SkeletonGrid label="page" count={4} />
    </div>
  );
}
