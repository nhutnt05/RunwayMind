import type { ReactNode } from 'react';
import { shortAddress, snowtraceUrl } from '@/lib/format';

export function SnowtraceLink({ kind, value, children }: { kind: 'tx' | 'address'; value: string; children?: ReactNode }) {
  return (
    <a
      href={snowtraceUrl(kind, value)}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 font-mono text-xs text-sky-700 underline-offset-2 hover:underline"
    >
      {children ?? shortAddress(value, 6)}
      <span aria-hidden>↗</span>
      <span className="sr-only">(opens Snowtrace in a new tab)</span>
    </a>
  );
}
