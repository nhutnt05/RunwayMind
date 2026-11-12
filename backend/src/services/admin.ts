// Policy & demo helpers (docs/07 §5.7): validate, encode and simulate an ADMIN call; the ADMIN wallet signs it.
// The backend never holds the ADMIN key. Time travel requires demoMode (409 INVALID_STATE otherwise).
import { encodeFunctionData, getAddress, type Abi, type Address, type Hex } from 'viem';
import { z } from 'zod';
import { mockLendingPoolAbi, policyEngineAbi, treasuryAbi } from '@runwaymind/shared/abi';
import type { DemoPrepareRequest, PolicyPrepareRequest } from '@runwaymind/shared';
import type { DecodedError } from '@runwaymind/agent';
import { ApiError } from '../errors';
import type { ChainService } from './chain';

export interface AdminPreparedTx {
  to: Address;
  data: Hex;
  value: '0';
  chainId: number;
  contract: 'PolicyEngine' | 'Treasury' | 'MockLendingPool';
  functionName: string;
}

export interface AdminPrepareResponse {
  preparedTx: AdminPreparedTx;
  simulation: { ok: boolean; error: DecodedError | null };
}

const ADAPTER_STATUS_INDEX = { NONE: 0, ACTIVE: 1, WITHDRAW_ONLY: 2 } as const;
const MAX_ADVANCE_SEC = 365 * 86_400; // Treasury.MAX_TIME_OFFSET
const bps = z.number().int().min(0).max(10_000);

/** Per-function argument schemas for /demo/prepare (the shared request schema only fixes `fn`). */
const DEMO_ARGS = {
  advanceTime: z.tuple([z.number().int().min(1).max(MAX_ADVANCE_SEC)]),
  setAPY: z.tuple([bps]),
  setUtilization: z.tuple([bps]),
  setPaused: z.tuple([z.boolean()]),
  setLiquidityShortage: z.tuple([z.boolean()]),
  resetCircuitBreaker: z.tuple([]),
} as const;

/** Demo functions that move chain time: only allowed when the Treasury was deployed with demoMode. */
const TIME_FUNCTIONS: ReadonlySet<DemoPrepareRequest['fn']> = new Set(['advanceTime']);
const POOL_FUNCTIONS: ReadonlySet<DemoPrepareRequest['fn']> = new Set(['setAPY', 'setUtilization', 'setPaused', 'setLiquidityShortage']);

export function createAdminService(chain: ChainService, chainId: number, poolAddress: Address | null) {
  async function prepareAndSimulate(
    from: Address,
    contract: AdminPreparedTx['contract'],
    to: Address,
    abi: Abi,
    functionName: string,
    args: readonly unknown[],
  ): Promise<AdminPrepareResponse> {
    const data = encodeFunctionData({ abi, functionName, args } as never);
    const sim = await chain.simulate(from, { address: to, abi, functionName, args });
    return {
      preparedTx: { to, data, value: '0', chainId, contract, functionName },
      simulation: { ok: sim.ok, error: sim.ok ? null : sim.error },
    };
  }

  return {
    /** PolicyEngine setters (ADMIN). Bounds are enforced on-chain; the simulation surfaces InvalidParameter. */
    async preparePolicy(body: PolicyPrepareRequest, from: Address): Promise<AdminPrepareResponse> {
      const policy = chain.addresses.policy;
      const abi = policyEngineAbi as Abi;
      switch (body.fn) {
        case 'setSafetyHorizon':
          return prepareAndSimulate(from, 'PolicyEngine', policy, abi, body.fn, [BigInt(body.args[0])]);
        case 'setEmergencyBuffer':
          return prepareAndSimulate(from, 'PolicyEngine', policy, abi, body.fn, [BigInt(body.args[0])]);
        case 'setMaxExposureBps':
          return prepareAndSimulate(from, 'PolicyEngine', policy, abi, body.fn, [body.args[0]]);
        case 'setAdapterStatus':
          return prepareAndSimulate(from, 'PolicyEngine', policy, abi, body.fn, [
            getAddress(body.args[0]),
            ADAPTER_STATUS_INDEX[body.args[1]],
          ]);
      }
    },

    /** Demo controls (docs/08 §3.10): Treasury time travel / breaker reset and MockLendingPool knobs. */
    async prepareDemo(body: DemoPrepareRequest, from: Address): Promise<AdminPrepareResponse> {
      const parsed = DEMO_ARGS[body.fn].safeParse(body.args);
      if (!parsed.success) {
        throw new ApiError(
          'VALIDATION_ERROR',
          `invalid args for ${body.fn}: ${parsed.error.issues[0]?.message ?? 'bad args'}`,
          parsed.error.issues.map((i) => ({ path: ['args', ...i.path].join('.'), issue: i.code, message: i.message })),
        );
      }
      const args = parsed.data as readonly (number | boolean)[];

      if (TIME_FUNCTIONS.has(body.fn) && !(await chain.getSnapshot()).demoMode) {
        throw new ApiError('INVALID_STATE', `${body.fn} requires a demoMode Treasury (DEMO MODE is off in this deployment)`);
      }
      if (POOL_FUNCTIONS.has(body.fn)) {
        if (!poolAddress) throw new ApiError('INVALID_STATE', 'This deployment has no MockLendingPool');
        const callArgs = args.map((a) => (typeof a === 'number' ? BigInt(a) : a));
        return prepareAndSimulate(from, 'MockLendingPool', poolAddress, mockLendingPoolAbi as Abi, body.fn, callArgs);
      }
      const treasury = chain.addresses.treasury;
      const callArgs = body.fn === 'advanceTime' ? [BigInt(args[0] as number)] : [];
      return prepareAndSimulate(from, 'Treasury', treasury, treasuryAbi as Abi, body.fn, callArgs);
    },
  };
}

export type AdminService = ReturnType<typeof createAdminService>;
