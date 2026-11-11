import Link from 'next/link';

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: { label: string; href: string };
}) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
      <p className="text-base font-semibold text-slate-900">{title}</p>
      {description ? <p className="mx-auto mt-1 max-w-prose text-sm text-slate-600">{description}</p> : null}
      {action ? (
        <Link
          href={action.href}
          className="mt-4 inline-block rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
        >
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}
