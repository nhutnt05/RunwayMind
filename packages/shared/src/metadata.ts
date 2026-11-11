// Obligation metadata integrity (docs/07 §5.1, docs/09 §8):
// metadataHash = keccak256(canonicalJson({ label, notes, category, source })).
// Canonical JSON = keys sorted lexicographically at every level, no whitespace, standard JSON escaping.
// Must stay identical to scripts/SeedDemo.s.sol `metadataHash()` for the seeded obligations.
import { keccak256, stringToBytes } from 'viem';
import type { Category } from './types/ladder';
import type { ObligationSource } from './types/entities';

/** Deterministic JSON: object keys sorted, no whitespace. bigint → decimal string; undefined members dropped. */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'bigint') return JSON.stringify(value.toString());
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? 'null' : canonicalJson(v))).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  const out = JSON.stringify(value);
  if (out === undefined) throw new TypeError(`canonicalJson: unsupported value of type ${typeof value}`);
  return out;
}

export interface ObligationMetadataInput {
  label: string;
  notes: string | null;
  category: Category;
  source: ObligationSource;
}

/** `keccak256(canonicalJson({ label, notes, category, source }))` as the bytes32 stored on-chain. */
export function obligationMetadataHash(m: ObligationMetadataInput): `0x${string}` {
  return keccak256(
    stringToBytes(canonicalJson({ label: m.label, notes: m.notes ?? null, category: m.category, source: m.source })),
  );
}

/** Snowtrace transaction link (docs/07 §4.8 `snowtraceUrl`). */
export const SNOWTRACE_TESTNET_BASE = 'https://testnet.snowtrace.io';
export function snowtraceTxUrl(hash: string, base: string = SNOWTRACE_TESTNET_BASE): string {
  return `${base.replace(/\/+$/, '')}/tx/${hash}`;
}
