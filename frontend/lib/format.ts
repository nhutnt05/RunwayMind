import type { Address } from '@runwaymind/shared';
import { publicEnv } from './env';

export function shortAddress(address: Address | string, chars = 4): string {
  if (address.length <= 2 + chars * 2) return address;
  return `${address.slice(0, 2 + chars)}…${address.slice(-chars)}`;
}

export function snowtraceUrl(kind: 'tx' | 'address', value: string, base: string = publicEnv.snowtraceBase): string {
  return `${base.replace(/\/$/, '')}/${kind}/${value}`;
}
