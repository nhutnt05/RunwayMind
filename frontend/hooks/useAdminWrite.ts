'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { encodeFunctionData, type Address } from 'viem';
import { RegisterTransactionRequestSchema } from '@runwaymind/shared';
import { getAccount, simulateContract, waitForTransactionReceipt, writeContract } from 'wagmi/actions';
import { api, type DecodedContractError, type PreparedTx } from '@/lib/api';
import { ADMIN_ABIS, verifyAdminTx, type AdminContract } from '@/lib/adminTx';
import { appChain } from '@/lib/chains';
import { contracts } from '@/lib/contracts';
import { describeStageError, formatDecodedError, type WriteStage } from '@/lib/preparedTx';
import { newToastId, txTracker } from '@/lib/txTracker';
import { wagmiConfig } from '@/lib/wagmi';

export type AdminWriteSource =
  /** Backend-prepared tx (POST /vault/*, /policy/prepare, /demo/prepare). */
  | { prepare: () => Promise<{ preparedTx: PreparedTx | null; simulation: { ok: boolean; error: DecodedContractError | null } | null }> }
  /** Direct call encoded in the browser (e.g. Treasury.tripCircuitBreaker, which has no prepare endpoint). */
  | { call: { functionName: string; args: readonly unknown[] } };

export type AdminWriteInput = AdminWriteSource & {
  title: string;
  contract: AdminContract;
  /** When set, the prepared calldata must call exactly this function. */
  functionName?: string;
};

export interface AdminWriteResult {
  hash: `0x${string}`;
  status: 'CONFIRMED' | 'REVERTED';
}

/** Everything that can change after an ADMIN write (docs/08 §5: invalidate on confirmation). */
export const ADMIN_WRITE_INVALIDATES = [
  ['overview'],
  ['cash-ladder'],
  ['obligations'],
  ['transactions'],
  ['agent'],
  ['recommendations'],
  ['readContract'],
  ['readContracts'],
] as const;

export function contractAddress(contract: AdminContract): Address | null {
  if (!contracts) return null;
  if (contract === 'Treasury') return contracts.treasury.address;
  if (contract === 'PolicyEngine') return contracts.policy.address;
  return contracts.pool.address ?? null;
}

/**
 * ADMIN write flow (docs/08 §6): prepare (API) or encode → verify calldata → simulate (wagmi) → wallet →
 * POST /transactions → receipt → invalidate → toast with Snowtrace link.
 */
export function useAdminWrite() {
  const qc = useQueryClient();
  const invalidate = () => Promise.all(ADMIN_WRITE_INVALIDATES.map((queryKey) => qc.invalidateQueries({ queryKey: [...queryKey] })));

  return useMutation<AdminWriteResult, Error, AdminWriteInput>({
    mutationFn: async (input) => {
      const id = newToastId(input.contract.toLowerCase());
      const toast = (patch: Parameters<typeof txTracker.upsert>[0]) => txTracker.upsert(patch);
      toast({ id, title: input.title, status: 'PENDING', message: 'Preparing transaction…' });
      let sent: `0x${string}` | null = null;
      let stage: WriteStage = 'prepare';
      try {
        const address = contractAddress(input.contract);
        if (!address) throw new Error(`${input.contract} address is not configured for this chain`);
        const account = getAccount(wagmiConfig).address;
        if (!account) throw new Error('Connect a wallet first');

        let tx: PreparedTx;
        if ('prepare' in input) {
          const res = await input.prepare();
          if (res.simulation && !res.simulation.ok) throw new Error(formatDecodedError(res.simulation.error));
          if (!res.preparedTx) throw new Error('Nothing to sign');
          tx = res.preparedTx;
        } else {
          const data = encodeFunctionData({ abi: ADMIN_ABIS[input.contract], functionName: input.call.functionName, args: input.call.args } as never);
          tx = { to: address, data, value: '0', chainId: appChain.id, functionName: input.call.functionName };
        }
        const call = verifyAdminTx(tx, {
          contract: input.contract,
          address,
          chainId: appChain.id,
          ...(input.functionName ? { functionName: input.functionName } : {}),
        });

        stage = 'simulate';
        toast({ id, message: 'Simulating…' });
        const { request } = await simulateContract(wagmiConfig, {
          address: call.address,
          abi: call.abi,
          functionName: call.functionName,
          args: call.args,
          account,
          chainId: appChain.id,
        } as never);

        stage = 'wallet';
        toast({ id, message: 'Confirm in your wallet…' });
        const hash = await writeContract(wagmiConfig, request as never);
        sent = hash;
        toast({ id, hash, message: 'Waiting for confirmation…' });

        try {
          await api.postValidated('/transactions', RegisterTransactionRequestSchema, { txHash: hash, kind: call.kind });
        } catch {
          /* best effort: the event indexer tracks it anyway */
        }

        stage = 'receipt';
        const receipt = await waitForTransactionReceipt(wagmiConfig, { hash, chainId: appChain.id });
        const status = receipt.status === 'success' ? 'CONFIRMED' : 'REVERTED';
        toast({ id, status, message: status === 'CONFIRMED' ? 'Confirmed' : 'Transaction reverted' });
        await invalidate();
        if (status === 'REVERTED') throw new Error('Transaction reverted');
        return { hash, status };
      } catch (e) {
        const message = describeStageError(stage, e);
        toast({ id, status: sent ? 'REVERTED' : 'FAILED', message });
        throw new Error(message);
      }
    },
  });
}

/** Manual vault action executed by the AGENT key (executeVia AGENT): no wallet signature, the API enqueues it. */
export function useVaultAgentAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { kind: 'withdrawals' | 'investments'; adapter: Address; amount: string }) => {
      const res = await api.post<{ decision: { id: string; status: string } | null }>(`/vault/${input.kind}`, {
        adapter: input.adapter,
        amount: input.amount,
        executeVia: 'AGENT',
      });
      await Promise.all([qc.invalidateQueries({ queryKey: ['agent'] }), qc.invalidateQueries({ queryKey: ['recommendations'] })]);
      return res.data;
    },
  });
}
