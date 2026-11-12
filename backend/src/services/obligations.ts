// Obligation write endpoints (docs/07 §5.1–§5.3). The backend never holds the ADMIN key: it validates input, computes
// metadataHash, simulates from the caller's address and returns calldata (`preparedTx`) for the wallet to sign.
import { encodeFunctionData, getAddress, type Abi, type Address, type Hex } from 'viem';
import { obligationRegistryAbi } from '@runwaymind/shared/abi';
import {
  obligationMetadataHash,
  type Category,
  type CreateObligationRequest,
  type ObligationSource,
  type UpdateObligationRequest,
} from '@runwaymind/shared';
import { CATEGORY, type DecodedError } from '@runwaymind/agent';
import { ApiError, notFound } from '../errors';
import type { Repositories } from '../repositories';
import { newId } from '../repositories/agentStore';
import type { ChainService } from './chain';

export interface PreparedTx {
  to: Address;
  data: Hex;
  value: '0';
  chainId: number;
  functionName: 'createObligation' | 'updateObligation' | 'cancelObligation';
}

export interface PrepareTxResponse {
  draftId: string | null;
  metadataHash: Hex | null;
  preparedTx: PreparedTx | null;
  simulation: { ok: boolean; error: DecodedError | null } | null;
}

const validation = (path: string, message: string) =>
  new ApiError('VALIDATION_ERROR', message, [{ path, issue: 'custom', message }]);

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function createObligationService(chain: ChainService, repos: Repositories, chainId: number) {
  const registry = chain.addresses.registry;

  function prepared(functionName: PreparedTx['functionName'], args: readonly unknown[]): PreparedTx {
    const data = encodeFunctionData({ abi: obligationRegistryAbi as Abi, functionName, args } as never);
    return { to: registry, data, value: '0', chainId, functionName };
  }

  async function simulate(from: Address, functionName: PreparedTx['functionName'], args: readonly unknown[]) {
    const res = await chain.simulate(from, { address: registry, abi: obligationRegistryAbi as Abi, functionName, args });
    return { ok: res.ok, error: res.ok ? null : res.error };
  }

  /** V2 (recipient ≠ 0, ≠ Treasury/clock) and V4 (due date strictly after chain time) need chain context. */
  function checkRecipientAndDue(recipient: Address | undefined, due: number | undefined, chainTime: number, duePath: string) {
    if (recipient !== undefined && (same(recipient, chain.addresses.treasury) || /^0x0{40}$/i.test(recipient))) {
      throw validation('recipient', 'recipient must not be the zero address or the Treasury');
    }
    if (due !== undefined && due <= chainTime) {
      throw validation(duePath, `${duePath} must be after the current chain time (${chainTime})`);
    }
  }

  async function activeObligation(id: bigint) {
    const { obligations } = await chain.getAllObligations();
    const ob = obligations.find((o) => o.id === id);
    if (!ob) throw notFound(`Obligation ${id}`);
    if (ob.status !== 'ACTIVE') throw new ApiError('INVALID_STATE', `Obligation ${id} is ${ob.status}`);
    return ob;
  }

  return {
    /** §5.1 — validates, stores a SUBMITTED draft, returns prepared `createObligation(input)` + simulation. */
    async prepareCreate(body: CreateObligationRequest, from: Address): Promise<PrepareTxResponse> {
      const { chainTime } = await chain.getSnapshot();
      const recipient = getAddress(body.recipient);
      checkRecipientAndDue(recipient, body.firstDueDate, chainTime, 'firstDueDate');

      let draftId = newId('drf');
      if (body.nlDraftId) {
        const draft = await repos.getDraft(body.nlDraftId);
        if (!draft) throw notFound(`Draft ${body.nlDraftId}`);
        if (draft.status !== 'DRAFT' && draft.status !== 'SUBMITTED') {
          throw new ApiError('INVALID_STATE', `Draft ${draft.id} is ${draft.status}`);
        }
        draftId = draft.id;
      }
      const source: ObligationSource = body.nlDraftId ? 'NL' : body.source;
      const metadataHash = obligationMetadataHash({ label: body.label, notes: body.notes, category: body.category, source });
      const input = {
        recipient,
        amount: BigInt(body.amount),
        firstDueDate: BigInt(body.firstDueDate),
        interval: BigInt(body.interval),
        maxOccurrences: body.maxOccurrences,
        category: CATEGORY.indexOf(body.category as Category),
        metadataHash,
      };

      await repos.saveDraft({
        id: draftId,
        status: 'SUBMITTED',
        source,
        label: body.label,
        notes: body.notes,
        category: body.category,
        recipient,
        amount: body.amount,
        firstDueDate: body.firstDueDate,
        interval: body.interval,
        maxOccurrences: body.maxOccurrences,
        warnings: [],
        sourceText: null,
        createdBy: from,
      });

      return {
        draftId,
        metadataHash,
        preparedTx: prepared('createObligation', [input]),
        simulation: await simulate(from, 'createObligation', [input]),
      };
    },

    /** §5.2 — on-chain fields → prepared `updateObligation`; label/notes-only changes go straight to the DB. */
    async prepareUpdate(id: bigint, body: UpdateObligationRequest, from: Address): Promise<PrepareTxResponse> {
      const ob = await activeObligation(id);
      const textPatch: { label?: string; notes?: string | null } = {};
      if (body.label !== undefined) textPatch.label = body.label;
      if (body.notes !== undefined) textPatch.notes = body.notes;
      if (Object.keys(textPatch).length) {
        const meta = await repos.getMetadata(id.toString());
        if (!meta) throw new ApiError('INVALID_STATE', `Obligation ${id} has no off-chain metadata to update`);
        await repos.updateMetadataText(id.toString(), textPatch);
      }

      const onchain = body.recipient !== undefined || body.amount !== undefined || body.nextDueDate !== undefined;
      if (!onchain) return { draftId: null, metadataHash: null, preparedTx: null, simulation: null };

      const { chainTime } = await chain.getSnapshot();
      const recipient = body.recipient !== undefined ? getAddress(body.recipient) : ob.recipient;
      checkRecipientAndDue(body.recipient !== undefined ? recipient : undefined, body.nextDueDate, chainTime, 'nextDueDate');
      const args = [
        id,
        recipient,
        body.amount !== undefined ? BigInt(body.amount) : ob.amount,
        BigInt(body.nextDueDate ?? ob.nextDueDate),
      ] as const;
      return {
        draftId: null,
        metadataHash: null,
        preparedTx: prepared('updateObligation', args),
        simulation: await simulate(from, 'updateObligation', args),
      };
    },

    /** §5.3 — prepared `cancelObligation(id)`. */
    async prepareCancel(id: bigint, from: Address): Promise<PrepareTxResponse> {
      await activeObligation(id);
      return {
        draftId: null,
        metadataHash: null,
        preparedTx: prepared('cancelObligation', [id]),
        simulation: await simulate(from, 'cancelObligation', [id]),
      };
    },
  };
}

export type ObligationService = ReturnType<typeof createObligationService>;
