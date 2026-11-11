'use client';

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
    <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-900">
      <p className="font-semibold">
        <span aria-hidden>⚠️ </span>
        {title}
      </p>
      {message ? <p className="mt-1">{message}</p> : null}
      {lastUpdated ? <p className="mt-1 text-xs text-red-700">Last updated {lastUpdated}</p> : null}
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-md bg-red-600 px-3 py-1.5 font-medium text-white hover:bg-red-700"
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}
