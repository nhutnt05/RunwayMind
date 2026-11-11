// Event decoding for receipts and the backend indexer (docs/07 §6). Only Treasury and ObligationRegistry logs are
// decoded (pool / adapter logs are ignored — MockLendingPool also has a `Withdrawn` event with another signature).
import { parseEventLogs, type Address, type Hex, type Log } from 'viem';
import { obligationRegistryAbi, treasuryAbi } from '@runwaymind/shared/abi';
import { toJsonSafe } from '@runwaymind/shared';
import type { CoreAddresses } from './reader';

/** Events indexed by the backend (docs/07 §6) + `ObligationUpdated` (classifies UPDATE_OBLIGATION transactions). */
export const TREASURY_EVENTS = [
  'Invested',
  'Withdrawn',
  'ObligationPaid',
  'DeadlineEnforced',
  'CircuitBreakerTripped',
  'CircuitBreakerReset',
  'TimeOffsetUpdated',
  'AdapterWithdrawFailed',
] as const;
export const REGISTRY_EVENTS = ['ObligationCreated', 'ObligationCancelled', 'ObligationUpdated'] as const;
export type TrackedEventName = (typeof TREASURY_EVENTS)[number] | (typeof REGISTRY_EVENTS)[number];

export interface DecodedEvent {
  name: TrackedEventName;
  /** JSON-safe args (bigint → decimal string). */
  args: Record<string, unknown>;
  address: Address;
  logIndex: number;
  blockNumber: bigint;
  txHash: Hex;
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function decodeTrackedLogs(logs: readonly Log[], addrs: Pick<CoreAddresses, 'treasury' | 'registry'>): DecodedEvent[] {
  const out: DecodedEvent[] = [];
  const treasuryLogs = logs.filter((l) => same(l.address, addrs.treasury));
  const registryLogs = logs.filter((l) => same(l.address, addrs.registry));
  const parsed = [
    ...parseEventLogs({ abi: treasuryAbi, logs: treasuryLogs as Log[], eventName: [...TREASURY_EVENTS] as never, strict: false }),
    ...parseEventLogs({ abi: obligationRegistryAbi, logs: registryLogs as Log[], eventName: [...REGISTRY_EVENTS] as never, strict: false }),
  ] as unknown as (Log & { eventName: TrackedEventName; args: Record<string, unknown> })[];
  for (const l of parsed) {
    out.push({
      name: l.eventName,
      args: toJsonSafe(l.args ?? {}) as Record<string, unknown>,
      address: l.address,
      logIndex: Number(l.logIndex ?? 0),
      blockNumber: l.blockNumber ?? 0n,
      txHash: l.transactionHash as Hex,
    });
  }
  return out.sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1));
}

/** Transaction kind (docs/07 §4.8) inferred from the events a transaction emitted. */
export function kindFromEvents(names: readonly string[]): string {
  const has = (n: string) => names.includes(n);
  if (has('Invested')) return 'INVEST';
  if (has('DeadlineEnforced')) return 'ENFORCE_DEADLINES';
  if (has('ObligationPaid')) return 'PAY';
  if (has('Withdrawn')) return 'WITHDRAW';
  if (has('ObligationCreated')) return 'CREATE_OBLIGATION';
  if (has('ObligationUpdated')) return 'UPDATE_OBLIGATION';
  if (has('ObligationCancelled')) return 'CANCEL_OBLIGATION';
  if (has('CircuitBreakerTripped')) return 'TRIP_BREAKER';
  if (has('CircuitBreakerReset')) return 'RESET_BREAKER';
  if (has('TimeOffsetUpdated')) return 'ADVANCE_TIME';
  return 'OTHER';
}
