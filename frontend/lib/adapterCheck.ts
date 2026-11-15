// "Add adapter" pre-check (Settings → Adapter whitelist). Mirrors the backend guard in services/admin.ts: the agent's
// snapshot reads every IVaultAdapter view of every listed adapter, so an incompatible address would break all pages.
import { isAddress, type Address } from 'viem';

/** PolicyEngine.MAX_ADAPTERS */
export const MAX_ADAPTERS = 5;

/** Views read for every listed adapter (agent/src/chain/reader.ts) plus asset() and treasury(). */
export const ADAPTER_PROBE_FUNCTIONS = ['asset', 'treasury', 'name', 'balance', 'getAPY', 'isPaused', 'availableLiquidity', 'utilizationBps', 'tvl'] as const;
export type ProbeFunction = (typeof ADAPTER_PROBE_FUNCTIONS)[number];

export type ProbeResults = readonly { status: 'success' | 'failure'; result?: unknown }[];

export type AdapterCheck =
  | { state: 'empty' }
  | { state: 'invalid'; message: string }
  | { state: 'checking' }
  | { state: 'failed'; name: string | null; problems: string[] }
  | { state: 'ok'; name: string };

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Synchronous checks on the typed text (before any chain read). Returns null when a chain read is needed. */
export function precheckAdapter(input: string, ctx: { listed: readonly Address[]; treasury: Address }): AdapterCheck | null {
  const v = input.trim();
  if (v === '') return { state: 'empty' };
  if (!isAddress(v, { strict: false })) return { state: 'invalid', message: 'Enter a contract address: 0x followed by 40 hex characters.' };
  if (/^0x0{40}$/i.test(v)) return { state: 'invalid', message: 'The zero address cannot be an adapter.' };
  if (same(v, ctx.treasury)) return { state: 'invalid', message: 'The Treasury itself cannot be an adapter.' };
  if (ctx.listed.some((a) => same(a, v))) return { state: 'invalid', message: 'This adapter is already in the whitelist. Change its status in the table.' };
  if (ctx.listed.length >= MAX_ADAPTERS) return { state: 'invalid', message: `The whitelist is full (max ${MAX_ADAPTERS} adapters). Remove one first.` };
  return null;
}

/** Interprets the on-chain reads (same order as ADAPTER_PROBE_FUNCTIONS). */
export function evaluateProbe(results: ProbeResults, ctx: { treasury: Address; asset: Address; assetSymbol: string }): AdapterCheck {
  const get = (fn: ProbeFunction) => {
    const r = results[ADAPTER_PROBE_FUNCTIONS.indexOf(fn)];
    return r?.status === 'success' ? r.result : undefined;
  };
  const missing = ADAPTER_PROBE_FUNCTIONS.filter((fn) => get(fn) === undefined);
  const nameValue = get('name');
  const name = typeof nameValue === 'string' && nameValue !== '' ? nameValue : null;
  const problems: string[] = [];
  if (missing.length === ADAPTER_PROBE_FUNCTIONS.length) {
    problems.push('No vault adapter found at this address (it may be a wallet, another kind of contract, or on a different network).');
  } else if (missing.length) {
    problems.push(`Not a complete vault adapter: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} missing or failing.`);
  }
  const asset = get('asset');
  if (typeof asset === 'string' && !same(asset, ctx.asset)) problems.push(`Holds a different token, not ${ctx.assetSymbol} (the contract would reject it: AdapterMismatch).`);
  const treasury = get('treasury');
  if (typeof treasury === 'string' && !same(treasury, ctx.treasury)) problems.push('Sends withdrawals to a different treasury, so funds invested in it would not come back here.');
  return problems.length ? { state: 'failed', name, problems } : { state: 'ok', name: name ?? 'Unnamed adapter' };
}
