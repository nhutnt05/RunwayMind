// bigint-safe JSON (docs/07 §2.2: amounts, bigint ids and block numbers are decimal strings in JSON).

export type JsonSafe<T> = T extends bigint
  ? string
  : T extends (infer U)[]
    ? JsonSafe<U>[]
    : T extends Date
      ? string
      : T extends object
        ? { [K in keyof T]: JsonSafe<T[K]> }
        : T;

/** `JSON.stringify` replacer that converts every bigint to its decimal string. */
export function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

/** `JSON.stringify` that never throws on bigint. */
export function stringifyJson(value: unknown, space?: number): string {
  return JSON.stringify(value, bigintReplacer, space);
}

/** Deep-converts bigint values to decimal strings, returning a structure safe for any JSON serializer. */
export function toJsonSafe<T>(value: T): JsonSafe<T> {
  return JSON.parse(stringifyJson(value)) as JsonSafe<T>;
}

const INTEGER_STRING = /^-?\d+$/;

/**
 * Builds a `JSON.parse` reviver that turns integer strings back into bigint for the given property names, e.g.
 * `parseJson(text, bigintReviver(['amount', 'idle']))`. Only listed keys are converted, so labels such as
 * `"123"` elsewhere stay strings.
 */
export function bigintReviver(keys: Iterable<string>): (key: string, value: unknown) => unknown {
  const set = new Set(keys);
  return (key, value) => {
    if (set.has(key) && typeof value === 'string' && INTEGER_STRING.test(value)) return BigInt(value);
    return value;
  };
}

export function parseJson<T = unknown>(text: string, reviver?: (key: string, value: unknown) => unknown): T {
  return JSON.parse(text, reviver as Parameters<typeof JSON.parse>[1]) as T;
}

/** Amount-like keys used across the shared types (docs/04 §2.1, docs/06, docs/09). */
export const AMOUNT_KEYS: readonly string[] = [
  'amount',
  'idle',
  'balance',
  'availableLiquidity',
  'tvl',
  'emergencyBuffer',
  'onchainRequiredReserve',
  'blockNumber',
  'obligationId',
  'totalAssets',
  'vaultTotal',
  'requiredReserve',
  'investableCapital',
  'shortfall',
  'requiredReserveAfter',
  'projectedIdle',
  'projectedVault',
  'projectedTotal',
  'paymentsToday',
  'withdrawalsToday',
  'projectedYieldCumulative',
  'deficit',
  'missing',
  'minLiquidIdle',
  'projectedYield',
  'shortfallNow',
  'minActionAmount',
  'deployBlock',
];
