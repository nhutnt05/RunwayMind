// Transactions and audit (docs/07 §4.8). User-signed transactions are registered by the frontend; the backend waits
// for the receipt in the background, decodes tracked events and links ObligationMetadata from `ObligationCreated`.
import type { Transaction } from '@prisma/client';
import type { Hex } from 'viem';
import { decodeTrackedLogs, kindFromEvents, type DecodedEvent } from '@runwaymind/agent';
import { obligationMetadataHash, snowtraceTxUrl, type Category, type ObligationSource, type TransactionKind } from '@runwaymind/shared';
import { notFound } from '../errors';
import type { Repositories } from '../repositories';
import type { ChainService, ReceiptView } from './chain';

export function transactionJson(row: Transaction, snowtraceBase?: string) {
  const events = row.decodedEvents ? (JSON.parse(row.decodedEvents) as DecodedEvent[]) : [];
  return {
    hash: row.hash,
    kind: row.kind as TransactionKind,
    from: row.fromAddress,
    status: row.status,
    blockNumber: row.blockNumber,
    decodedEvents: events.map((e) => ({ name: e.name, args: e.args })),
    error: row.error ? JSON.parse(row.error) : null,
    snowtraceUrl: snowtraceTxUrl(row.hash, snowtraceBase),
    initiator: row.initiator,
    relatedId: row.relatedId,
    createdAt: Math.floor(row.createdAt.getTime() / 1000),
    confirmedAt: row.confirmedAt ? Math.floor(row.confirmedAt.getTime() / 1000) : null,
  };
}

export function auditLogJson(row: { id: number; eventType: string; actor: string; entityType: string | null; entityId: string | null; payload: string; createdAt: Date }) {
  return {
    id: row.id,
    eventType: row.eventType,
    actor: row.actor,
    entityType: row.entityType,
    entityId: row.entityId,
    payload: JSON.parse(row.payload) as unknown,
    createdAt: Math.floor(row.createdAt.getTime() / 1000),
  };
}

export interface TransactionServiceOptions {
  snowtraceBase?: string;
  receiptTimeoutMs?: number;
  log?: { error(msg: string, meta?: Record<string, unknown>): void };
}

export function createTransactionService(chain: ChainService, repos: Repositories, opts: TransactionServiceOptions = {}) {
  /** Links the off-chain draft to the on-chain id once `ObligationCreated` is seen (docs/07 §5.1). */
  async function linkDraft(draftId: string, events: DecodedEvent[], txHash: string) {
    const created = events.find((e) => e.name === 'ObligationCreated');
    const draft = await repos.getDraft(draftId);
    if (!created || !draft) return;
    // Any session may register any tx hash: only link a draft whose content is what the tx committed on-chain, so a
    // caller cannot relabel an existing obligation by pairing its creation tx with an unrelated draft id.
    const expected = obligationMetadataHash({
      label: draft.label,
      notes: draft.notes ?? null,
      category: draft.category as Category,
      source: draft.source as ObligationSource,
    });
    if (String(created.args.metadataHash).toLowerCase() !== expected.toLowerCase()) {
      opts.log?.error('draft does not match the on-chain metadataHash; not linked', { draftId, txHash });
      return;
    }
    await repos.upsertMetadata({
      obligationId: String(created.args.id),
      label: draft.label,
      notes: draft.notes ?? null,
      source: draft.source,
      nlDraftId: draft.source === 'NL' ? draft.id : null,
      metadataHash: String(created.args.metadataHash),
      createTxHash: txHash,
    });
    await repos.setDraftStatus(draftId, 'CONFIRMED');
  }

  async function settle(hash: Hex, kind: TransactionKind, relatedDraftId: string | undefined, from: string) {
    let receipt: ReceiptView | null = null;
    try {
      receipt = await chain.waitForReceipt(hash, opts.receiptTimeoutMs);
    } catch (e) {
      opts.log?.error('receipt wait failed', { hash, error: (e as Error).message });
    }
    if (!receipt) return; // still PENDING; the event indexer picks it up later
    const events = decodeTrackedLogs(receipt.logs, chain.addresses);
    const ok = receipt.status === 'success';
    await repos.upsertTransaction({
      hash,
      kind: kind === 'OTHER' ? (kindFromEvents(events.map((e) => e.name)) as TransactionKind) : kind,
      from: receipt.from ?? from,
      initiator: 'ADMIN_UI',
      status: ok ? 'CONFIRMED' : 'REVERTED',
      blockNumber: receipt.blockNumber,
      decodedEvents: events,
      error: ok ? null : { name: 'TransactionReverted' },
      relatedId: relatedDraftId ?? null,
      confirmedAt: new Date(),
    });
    if (ok && relatedDraftId) await linkDraft(relatedDraftId, events, hash);
  }

  return {
    /**
     * Registers a user-signed tx as PENDING and resolves the receipt asynchronously (the frontend waits for the
     * receipt itself). `settled` is exposed for tests and graceful shutdown.
     */
    async register(input: { txHash: Hex; kind: TransactionKind; relatedDraftId?: string | undefined }, from: string) {
      await repos.upsertTransaction({
        hash: input.txHash,
        kind: input.kind,
        from,
        initiator: 'ADMIN_UI',
        status: 'PENDING',
        blockNumber: null,
        decodedEvents: null,
        error: null,
        relatedId: input.relatedDraftId ?? null,
      });
      const settled = settle(input.txHash, input.kind, input.relatedDraftId, from).catch((e: Error) =>
        opts.log?.error('transaction settle failed', { hash: input.txHash, error: e.message }),
      );
      const row = await repos.getTransaction(input.txHash);
      return { tx: transactionJson(row!, opts.snowtraceBase), settled };
    },

    async list(q: { kind?: string | undefined; status?: string | undefined; limit: number; cursor?: string | undefined }) {
      const page = await repos.listTransactions(q);
      return { items: page.items.map((r) => transactionJson(r, opts.snowtraceBase)), nextCursor: page.nextCursor };
    },

    async get(hash: string) {
      const row = await repos.getTransaction(hash);
      if (!row) throw notFound(`Transaction ${hash}`);
      return transactionJson(row, opts.snowtraceBase);
    },

    async auditLogs(q: { entityType?: string | undefined; entityId?: string | undefined; limit: number }) {
      return (await repos.listAuditLogs(q)).map(auditLogJson);
    },
  };
}

export type TransactionService = ReturnType<typeof createTransactionService>;
