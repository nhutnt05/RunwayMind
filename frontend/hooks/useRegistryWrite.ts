'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RegisterTransactionRequestSchema, type TransactionKind } from '@runwaymind/shared';
import { getAccount, simulateContract, waitForTransactionReceipt, writeContract } from 'wagmi/actions';
import { api, type ApiResult, type PrepareTxResponse } from '@/lib/api';
import { appChain } from '@/lib/chains';
import { contracts } from '@/lib/contracts';
import { describeStageError, formatDecodedError, verifyRegistryTx, type RegistryWriteFunction, type WriteStage } from '@/lib/preparedTx';
import { newToastId, txTracker } from '@/lib/txTracker';
import { wagmiConfig } from '@/lib/wagmi';

export interface RegistryWriteInput {
  /** Toast title, e.g. "Create obligation". */
  title: string;
  kind: Extract<TransactionKind, 'CREATE_OBLIGATION' | 'UPDATE_OBLIGATION' | 'CANCEL_OBLIGATION'>;
  functionName: RegistryWriteFunction;
  /** Calls the backend prepare endpoint (docs/07 §5.1–§5.3). */
  prepare: () => Promise<ApiResult<PrepareTxResponse>>;
}

export interface RegistryWriteResult {
  hash: `0x${string}` | null;
  status: 'CONFIRMED' | 'REVERTED' | 'NO_TX';
}

/** Query keys refreshed after a registry write is mined (docs/08 §5: invalidate on tx confirmation). */
export const REGISTRY_WRITE_INVALIDATES = [['obligations'], ['overview'], ['cash-ladder'], ['transactions'], ['readContracts']] as const;

/**
 * ADMIN write flow (docs/08 §6): prepare (API) → simulate (wagmi) → writeContract → POST /transactions →
 * waitForTransactionReceipt → invalidate queries → toast with Snowtrace link.
 */
export function useRegistryWrite() {
  const qc = useQueryClient();
  const invalidate = () =>
    Promise.all(REGISTRY_WRITE_INVALIDATES.map((queryKey) => qc.invalidateQueries({ queryKey: [...queryKey] })));

  return useMutation<RegistryWriteResult, Error, RegistryWriteInput>({
    mutationFn: async ({ title, kind, functionName, prepare }) => {
      const id = newToastId(kind.toLowerCase());
      const toast = (patch: Parameters<typeof txTracker.upsert>[0]) => txTracker.upsert(patch);
      toast({ id, title, status: 'PENDING', message: 'Preparing transaction…' });
      let sent: `0x${string}` | null = null;
      let stage: WriteStage = 'prepare';
      try {
        const registry = contracts?.registry;
        if (!registry) throw new Error('ObligationRegistry address is not configured for this chain');
        const account = getAccount(wagmiConfig).address;
        if (!account) throw new Error('Connect a wallet first');

        const { data: prepared } = await prepare();
        if (!prepared.preparedTx) {
          // label/notes-only PATCH: applied directly to the DB, nothing to sign (docs/07 §5.2).
          toast({ id, status: 'CONFIRMED', message: 'Saved (off-chain metadata only)' });
          await invalidate();
          return { hash: null, status: 'NO_TX' };
        }
        if (prepared.simulation && !prepared.simulation.ok) throw new Error(formatDecodedError(prepared.simulation.error));

        const call = verifyRegistryTx(prepared.preparedTx, { registry: registry.address, chainId: appChain.id, functionName });

        stage = 'simulate';
        toast({ id, message: 'Simulating…' });
        const { request } = await simulateContract(wagmiConfig, {
          address: call.address,
          abi: registry.abi,
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

        // Register for backend tracking (links ObligationMetadata via relatedDraftId). Best effort: the event indexer
        // picks the tx up anyway, so a failure here must not hide the on-chain result.
        try {
          await api.postValidated('/transactions', RegisterTransactionRequestSchema, {
            txHash: hash,
            kind,
            ...(prepared.draftId ? { relatedDraftId: prepared.draftId } : {}),
          });
        } catch {
          /* tracked later by the indexer */
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
        // Before a hash exists nothing reached the chain (prepare/simulation/wallet rejection) → FAILED.
        toast({ id, status: sent ? 'REVERTED' : 'FAILED', message });
        throw new Error(message);
      }
    },
  });
}
