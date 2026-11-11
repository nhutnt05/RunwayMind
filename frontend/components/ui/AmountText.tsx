import { formatUsdc } from '@runwaymind/shared';

// Renders a token amount given in base units. Amounts arrive as bigint or decimal string (docs/07 §2.2);
// no floating point is involved.
export function AmountText({
  value,
  decimals = 6,
  symbol = 'USDC',
  className = '',
}: {
  value: bigint | string;
  decimals?: number;
  symbol?: string | null;
  className?: string;
}) {
  const amount = typeof value === 'bigint' ? value : BigInt(value);
  return (
    <span className={`tabular-nums ${className}`}>
      {formatUsdc(amount, decimals)}
      {symbol ? <span className="ml-1 text-[0.8em] font-normal text-slate-600">{symbol}</span> : null}
    </span>
  );
}
