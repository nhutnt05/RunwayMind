'use client';

/** API 5xx / chain unavailable (docs/08 §8): message + Retry, with the last successful update time when known. */
export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
  lastUpdated,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
  lastUpdated?: string;
}) {
  return (
    <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-6 text-sm text-red-900">
      <p className="font-semibold">
        <span aria-hidden>⚠️ </span>
        {title}
      </p>
      {message ? <p className="mt-1 break-words">{message}</p> : null}
      {lastUpdated ? <p className="mt-1 text-xs text-red-800">Last updated {lastUpdated}</p> : null}
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-md bg-red-700 px-3 py-1.5 font-medium text-white hover:bg-red-800"
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}

/**
 * Refresh failed but earlier data is still on screen (docs/08 §8 "stale data shown with last updated timestamp"):
 * a compact banner instead of replacing the content with an ErrorState.
 */
export function StaleDataNotice({ lastUpdated, onRetry }: { lastUpdated?: string; onRetry?: () => void }) {
  return (
    <div role="status" className="flex flex-wrap items-center gap-2 rounded-md border border-amber-500 bg-amber-50 px-3 py-2 text-sm text-amber-950">
      <span aria-hidden>⚠</span>
      <span>
        Live refresh failed — showing data{lastUpdated ? ` last updated ${lastUpdated}` : ' from the last successful refresh'}.
      </span>
      {onRetry ? (
        <button type="button" onClick={onRetry} className="ml-auto rounded-md border border-amber-700 bg-white px-2 py-0.5 text-xs font-semibold text-amber-950 hover:bg-amber-100">
          Retry
        </button>
      ) : null}
    </div>
  );
}
