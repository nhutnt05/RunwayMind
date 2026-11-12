export function Skeleton({ className = 'h-4 w-full' }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-md bg-slate-200 ${className}`} />;
}

/**
 * Loading placeholder shaped like a card (docs/08 §8 "Skeletons matching card layout"): a title bar plus `lines`
 * content bars inside the standard card frame. Announced once to screen readers as "Loading <label>…".
 */
export function SkeletonCard({
  label,
  lines = 2,
  className = '',
  bodyClassName,
}: {
  label: string;
  lines?: number;
  className?: string;
  /** Optional block (e.g. a chart area) rendered under the title instead of text lines. */
  bodyClassName?: string;
}) {
  return (
    <div
      role="status"
      aria-busy="true"
      data-testid="skeleton-card"
      className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm ${className}`}
    >
      <span className="sr-only">Loading {label}…</span>
      <Skeleton className="h-4 w-1/3" />
      {bodyClassName ? (
        <Skeleton className={`mt-3 w-full ${bodyClassName}`} />
      ) : (
        Array.from({ length: lines }, (_, i) => <Skeleton key={i} className={`mt-3 h-6 ${i % 2 ? 'w-1/2' : 'w-3/4'}`} />)
      )}
    </div>
  );
}

/** A grid of card skeletons for page-level loading states. */
export function SkeletonGrid({ label, count = 3, className = 'grid grid-cols-1 gap-4 lg:grid-cols-2' }: { label: string; count?: number; className?: string }) {
  return (
    <div className={className} data-testid="skeleton-grid">
      <span role="status" className="sr-only">
        Loading {label}…
      </span>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} aria-hidden className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="mt-3 h-6 w-3/4" />
          <Skeleton className="mt-3 h-24 w-full" />
        </div>
      ))}
    </div>
  );
}
