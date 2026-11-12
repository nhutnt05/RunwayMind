// Agent loop (docs/05 §2): snapshot → ladder → consistency check (§4) → decide → dedupe/supersede → persist →
// enqueue APPROVED (Auto Mode). Pure financial logic stays in engines/; this module only orchestrates I/O.
import type { Address, PublicClient } from 'viem';
import { treasuryAbi } from '@runwaymind/shared/abi';
import type { AgentDecisionDraft, AgentSettings, CashLadderResult, ChainSnapshot, Explanation } from '@runwaymind/shared';
import { readSnapshot as readChainSnapshot, type CoreAddresses } from '../chain/reader';
import { computeCashLadder } from '../engines/cashLadder';
import { decide } from '../engines/decide';
import { AuditLogger, silentLogger, type Logger } from '../audit/audit';
import { prepareAction, withinOnePercent } from '../executor/executor';
import { simulateCall } from '../executor/send';
import { templateExplanation, type ExplanationLanguage } from '../llm/templates';
import { createExplainer } from '../llm/explain';
import type { LlmProvider } from '../llm/provider';
import type { AgentStore, DecisionRecord } from './store';
import { executeAutoApproved, initialStatus } from './auto';
import { computeSnapshotRisks } from './risk';

export interface AgentLoopDeps {
  client: PublicClient;
  addresses: CoreAddresses;
  store: AgentStore;
  audit: AuditLogger;
  /** AGENT address used to pre-simulate a decision before it is shown for approval (docs/01 §11.3). */
  agentAccount?: Address | null;
  /** Execution sink for APPROVED decisions (Auto Mode). */
  executor?: { enqueue(decisionId: string): Promise<unknown> } | null;
  /** Explainer override. Default: LLM explainer (docs/05 §7) built from `llm`, template-only when `llm` is absent. */
  explain?: (d: AgentDecisionDraft, settings: AgentSettings) => Promise<Explanation>;
  /** LLM for the default explainer; provider null / omitted → templates only, no network (LLM_ENABLED=false). */
  llm?: { provider: LlmProvider | null; timeoutMs: number; language?: ExplanationLanguage } | null;
  readSnapshot?: (client: PublicClient, addrs: CoreAddresses) => Promise<ChainSnapshot>;
  /** Wall clock for approval TTLs (operational, not financial). */
  now?: () => Date;
  log?: Logger;
}

export interface TickResult {
  snapshotId: string;
  blockNumber: bigint;
  chainTime: number;
  mismatch: boolean;
  drafts: number;
  created: DecisionRecord[];
  superseded: string[];
  expired: string[];
  skipped: { action: string; adapter: string | null; reason: 'SAME_INTENT_OPEN' | 'IN_FLIGHT' | 'SIMULATION_REVERTED' }[];
}

const sameAddr = (a: string | null, b: string | null) => (a ?? '').toLowerCase() === (b ?? '').toLowerCase();

/** Same action, adapter and reason, amount within 1% (docs/05 §2 `sameIntent`). */
export function sameIntent(existing: Pick<DecisionRecord, 'action' | 'adapter' | 'amount' | 'reasonCode'>, d: AgentDecisionDraft): boolean {
  if (existing.action !== d.action || !sameAddr(existing.adapter, d.adapter) || existing.reasonCode !== d.reasonCode) return false;
  if (existing.amount === null || d.amount === null) return existing.amount === d.amount;
  return withinOnePercent(d.amount, existing.amount);
}

export function createAgentLoop(deps: AgentLoopDeps) {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? silentLogger;
  const read = deps.readSnapshot ?? readChainSnapshot;
  const language = deps.llm?.language ?? 'en';
  const explain =
    deps.explain ??
    createExplainer({
      provider: deps.llm?.provider ?? null,
      timeoutMs: deps.llm?.timeoutMs ?? 8000,
      audit: deps.audit,
      language,
      log,
    }).explain;

  async function expirePending(at: Date = now()): Promise<string[]> {
    const expired = await deps.store.expireDecisions(at);
    for (const d of expired) {
      await deps.audit.record('DECISION_EXPIRED', { expiresAt: d.expiresAt.toISOString() }, { entityType: 'DECISION', entityId: d.id });
    }
    return expired.map((d) => d.id);
  }

  async function tick(): Promise<TickResult> {
    const { store, audit } = deps;
    const settings = await store.getSettings();
    const expired = await expirePending();

    const snapshot = await read(deps.client, deps.addresses);
    const ladder: CashLadderResult = computeCashLadder(snapshot);
    await store.saveSnapshot(snapshot, ladder);

    // §4 consistency check: decide() suppresses INVEST on ONCHAIN_MISMATCH; we audit it.
    const mismatch = ladder.warnings.some((w) => w.code === 'ONCHAIN_MISMATCH');
    if (mismatch) {
      log.warn('engine/on-chain reserve mismatch', { snapshotId: snapshot.snapshotId });
      await audit.record(
        'ENGINE_MISMATCH',
        { engine: ladder.requiredReserve, onchain: snapshot.onchainRequiredReserve, blockNumber: snapshot.blockNumber },
        { entityType: 'SNAPSHOT', entityId: snapshot.snapshotId },
      );
    }

    // Pool Risk (docs/06 §4): sample every adapter each tick, persist samples + risk snapshots, feed decide().
    const { samples, risks } = await computeSnapshotRisks(store, snapshot, settings);
    await store.savePoolMetrics(snapshot.snapshotId, snapshot.adapters, samples, risks);

    const labels = await store.obligationLabels();
    const drafts = decide(snapshot, ladder, risks, settings, { labels });
    const open = await store.listOpenDecisions();
    const created: DecisionRecord[] = [];
    const superseded: string[] = [];
    const skipped: TickResult['skipped'] = [];

    for (const d of drafts) {
      const sameSlot = open.filter((o) => o.action === d.action && sameAddr(o.adapter, d.adapter));
      if (sameSlot.some((o) => o.status === 'APPROVED' || o.status === 'EXECUTING')) {
        skipped.push({ action: d.action, adapter: d.adapter, reason: 'IN_FLIGHT' });
        continue;
      }
      const pending = sameSlot.filter((o) => o.status === 'PENDING_APPROVAL');
      if (pending.some((o) => sameIntent(o, d))) {
        skipped.push({ action: d.action, adapter: d.adapter, reason: 'SAME_INTENT_OPEN' });
        continue;
      }

      // docs/01 §11.3: simulate from AGENT before persisting; a reverting proposal is never shown for approval.
      const prepared = prepareAction({ id: '', action: d.action, adapter: d.adapter, amount: d.amount });
      if (prepared && deps.agentAccount) {
        const sim = await simulateCall(
          deps.client,
          deps.agentAccount,
          { address: deps.addresses.treasury, abi: treasuryAbi, functionName: prepared.functionName, args: prepared.args },
          [500],
        );
        if (!sim.ok) {
          skipped.push({ action: d.action, adapter: d.adapter, reason: 'SIMULATION_REVERTED' });
          await audit.record('ACTION_SIMULATION_REVERTED', { stage: 'PROPOSAL', draft: d, error: sim.error ?? sim.message }, {
            entityType: 'SNAPSHOT',
            entityId: snapshot.snapshotId,
          });
          continue;
        }
      }

      for (const p of pending) {
        const res = await store.transitionDecision(p.id, ['PENDING_APPROVAL'], { status: 'SUPERSEDED' });
        if (res) {
          superseded.push(p.id);
          await audit.record('DECISION_SUPERSEDED', { reason: 'NEWER_DECISION', snapshotId: snapshot.snapshotId }, {
            entityType: 'DECISION',
            entityId: p.id,
          });
        }
      }

      let explanation: Explanation;
      try {
        explanation = await explain(d, settings);
      } catch (e) {
        // The explainer never blocks a decision: unexpected errors fall back to the template (docs/05 §12).
        await audit.record('LLM_FALLBACK', { reason: 'PROVIDER_ERROR', detail: (e as Error).message, reasonCode: d.reasonCode }, {
          entityType: 'SNAPSHOT',
          entityId: snapshot.snapshotId,
        });
        explanation = templateExplanation({ ...d, minApyBps: settings.minApyBps, language });
      }
      const t = now();
      const rec = await store.createDecision({
        snapshotId: snapshot.snapshotId,
        action: d.action,
        adapter: d.adapter,
        amount: d.amount,
        reasonCode: d.reasonCode,
        // Auto Mode rules (docs/05 §8): see orchestrator/auto.ts.
        status: initialStatus(settings.mode, d),
        mode: settings.mode,
        facts: d.facts,
        explanation,
        expiresAt: new Date(t.getTime() + settings.decisionTtlSec * 1000),
      });
      created.push(rec);
      await audit.record(
        'DECISION_CREATED',
        { action: rec.action, adapter: rec.adapter, amount: rec.amount, reasonCode: rec.reasonCode, status: rec.status, snapshotId: rec.snapshotId },
        { entityType: 'DECISION', entityId: rec.id },
      );
    }

    await executeAutoApproved({ audit, executor: deps.executor ?? null }, created);
    await audit.record('AGENT_TICK', {
      snapshotId: snapshot.snapshotId,
      blockNumber: snapshot.blockNumber,
      chainTime: snapshot.chainTime,
      decisions: created.map((d) => d.id),
      superseded,
      expired,
      mismatch,
    });
    return {
      snapshotId: snapshot.snapshotId,
      blockNumber: snapshot.blockNumber,
      chainTime: snapshot.chainTime,
      mismatch,
      drafts: drafts.length,
      created,
      superseded,
      expired,
      skipped,
    };
  }

  return { tick, expirePending };
}

export type AgentLoop = ReturnType<typeof createAgentLoop>;
