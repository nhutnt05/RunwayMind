// Recommendations, agent settings/activity and keeper status (docs/07 §4.7, §7). Decision state transitions are done
// by the agent's ApprovalService (docs/05 §2.1); this layer maps them to API errors and JSON.
import type { AgentAction, AgentDecision, KeeperRun } from '@prisma/client';
import { ApprovalError, type ApprovalService, type AuditLogger, type DecisionRecord, type ActionRecord } from '@runwaymind/agent';
import { AgentSettingsSchema, type AgentSettings, type AgentSettingsUpdate } from '@runwaymind/shared';
import { ApiError, notFound } from '../errors';
import type { Repositories } from '../repositories';
import { toActionRecord, toDecisionRecord } from '../repositories/agentStore';
import type { Scheduler } from '../scheduler';

const sec = (d: Date) => Math.floor(d.getTime() / 1000);

export function actionJson(a: ActionRecord) {
  return {
    id: a.id,
    functionName: a.functionName,
    args: a.args,
    status: a.status,
    txHash: a.txHash,
    decodedError: a.decodedError,
    gasUsed: a.gasUsed,
    blockNumber: a.blockNumber,
    attempt: a.attempt,
    createdAt: sec(a.createdAt),
  };
}

export function decisionJson(d: DecisionRecord, actions: ActionRecord[] = []) {
  return {
    id: d.id,
    action: d.action,
    adapter: d.adapter,
    amount: d.amount,
    reasonCode: d.reasonCode,
    status: d.status,
    mode: d.mode,
    explanation: d.explanation,
    facts: d.facts,
    snapshotId: d.snapshotId,
    approvedBy: d.approvedBy,
    rejectedBy: d.rejectedBy,
    rejectReason: d.rejectReason,
    createdAt: sec(d.createdAt),
    updatedAt: sec(d.updatedAt),
    expiresAt: sec(d.expiresAt),
    actions: actions.map(actionJson),
  };
}

const rowJson = (row: AgentDecision & { actions: AgentAction[] }) => decisionJson(toDecisionRecord(row), row.actions.map(toActionRecord));

function keeperRunJson(r: KeeperRun) {
  return {
    id: r.id,
    startedAt: sec(r.startedAt),
    finishedAt: r.finishedAt ? sec(r.finishedAt) : null,
    chainTime: r.chainTime,
    shortfallBefore: r.shortfallBefore,
    enforced: r.enforced,
    paidIds: JSON.parse(r.paidIds) as string[],
    txHashes: JSON.parse(r.txHashes) as string[],
    errors: JSON.parse(r.errors) as unknown[],
  };
}

function settingsJson(s: AgentSettings) {
  return { ...s, minActionAmount: s.minActionAmount.toString() };
}

export function mapApprovalError(e: unknown): never {
  if (e instanceof ApprovalError) {
    if (e.code === 'NOT_FOUND') throw notFound('Recommendation');
    throw new ApiError('INVALID_STATE', e.message, e.status ? { status: e.status } : undefined);
  }
  throw e;
}

export interface AgentServiceDeps {
  repos: Repositories;
  approval: ApprovalService;
  audit: AuditLogger;
  scheduler: Scheduler | null;
}

export function createAgentService({ repos, approval, audit, scheduler }: AgentServiceDeps) {
  async function getRecommendation(id: string) {
    const row = await repos.getDecisionWithActions(id);
    if (!row) throw notFound(`Recommendation ${id}`);
    return rowJson(row);
  }

  return {
    async listRecommendations(q: { status?: string | undefined; limit: number }) {
      return (await repos.listDecisions(q)).map(rowJson);
    },

    getRecommendation,

    async approve(id: string, by: string) {
      await approval.approve(id, by).catch(mapApprovalError);
      return getRecommendation(id);
    },

    async reject(id: string, by: string, reason?: string) {
      await approval.reject(id, by, reason).catch(mapApprovalError);
      return getRecommendation(id);
    },

    async evaluate() {
      if (!scheduler?.agentEnabled) throw new ApiError('INVALID_STATE', 'Agent is disabled (AGENT_ENABLED=false)');
      const r = await scheduler.evaluate();
      return {
        snapshotId: r.snapshotId,
        blockNumber: r.blockNumber,
        chainTime: r.chainTime,
        mismatch: r.mismatch,
        decisions: r.created.map((d) => decisionJson(d)),
        superseded: r.superseded,
        expired: r.expired,
        skipped: r.skipped,
      };
    },

    async getSettings() {
      return settingsJson(await repos.agentSettings());
    },

    /** Partial update; bounds re-checked on the merged object (docs/09 §6). Audits SETTINGS_CHANGED / MODE_CHANGED. */
    async updateSettings(patch: AgentSettingsUpdate, by: string) {
      const current = await repos.agentSettings();
      const merged = { ...settingsJson(current), ...patch };
      const parsed = AgentSettingsSchema.safeParse(merged);
      if (!parsed.success) {
        throw new ApiError(
          'VALIDATION_ERROR',
          parsed.error.issues[0]?.message ?? 'invalid settings',
          parsed.error.issues.map((i) => ({ path: i.path.join('.'), issue: i.code, message: i.message })),
        );
      }
      const next: AgentSettings = { ...parsed.data, minActionAmount: BigInt(parsed.data.minActionAmount) };
      await repos.saveAgentSettings(next, by);
      if (next.mode !== current.mode) {
        await audit.record('MODE_CHANGED', { from: current.mode, to: next.mode }, { actor: by, entityType: 'SETTINGS', entityId: repos.treasuryId });
      }
      const changed = Object.keys(patch).filter((k) => k !== 'mode' && String(merged[k as keyof typeof merged]) !== String(settingsJson(current)[k as keyof AgentSettings]));
      if (changed.length) {
        await audit.record('SETTINGS_CHANGED', { changed: Object.fromEntries(changed.map((k) => [k, merged[k as keyof typeof merged]])) }, { actor: by, entityType: 'SETTINGS', entityId: repos.treasuryId });
      }
      return settingsJson(next);
    },

    /** Merged timeline of decisions, actions and keeper runs, newest first (docs/07 §4.7). */
    async activity(limit: number) {
      const [decisions, actions, runs] = await Promise.all([
        repos.listDecisions({ limit }),
        repos.recentActions(limit),
        repos.recentKeeperRuns(limit),
      ]);
      const items = [
        ...decisions.map((d) => ({ type: 'DECISION' as const, at: sec(d.updatedAt), id: d.id, data: rowJson(d) })),
        ...actions.map((a) => ({ type: 'ACTION' as const, at: sec(a.updatedAt), id: a.id, data: { decisionId: a.decisionId, ...actionJson(toActionRecord(a)) } })),
        ...runs.map((r) => ({ type: 'KEEPER_RUN' as const, at: sec(r.finishedAt ?? r.startedAt), id: r.id, data: keeperRunJson(r) })),
      ];
      return items.sort((a, b) => b.at - a.at).slice(0, limit);
    },

    async keeperStatus() {
      const [status, [last]] = await Promise.all([scheduler?.keeperStatus() ?? null, repos.recentKeeperRuns(1)]);
      const lastRun = last ? keeperRunJson(last) : null;
      const lastRunAt = status?.lastRunAt ? sec(status.lastRunAt) : (lastRun?.finishedAt ?? lastRun?.startedAt ?? null);
      return {
        enabled: status?.enabled ?? false,
        keeperAddress: status?.keeperAddress ?? null,
        avaxBalance: status?.avaxBalance ?? null,
        lastRunAt,
        nextRunAt: status?.nextRunAt ? sec(status.nextRunAt) : null,
        lastResult: lastRun,
        lastError: status?.lastError ?? (lastRun && lastRun.errors.length ? JSON.stringify(lastRun.errors[0]) : null),
      };
    },

    async runKeeper() {
      if (!scheduler?.keeperEnabled) throw new ApiError('INVALID_STATE', 'Keeper is disabled (KEEPER_ENABLED=false or KEEPER_PRIVATE_KEY unset)');
      const r = await scheduler.runKeeper();
      return { ...r, startedAt: sec(r.startedAt), finishedAt: sec(r.finishedAt) };
    },
  };
}

export type AgentService = ReturnType<typeof createAgentService>;
