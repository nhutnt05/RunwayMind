// Persistence port for the orchestrator, executor and keeper. The backend implements it with Prisma (docs/09 §3);
// `MemoryAgentStore` is used by tests. All amounts are bigint; times of operational records are wall-clock Dates.
import { randomUUID } from 'node:crypto';
import type {
  AgentActionStatus,
  AgentActionType,
  AgentMode,
  AgentSettings,
  Address,
  Amount,
  CashLadderResult,
  ChainSnapshot,
  DecisionFacts,
  DecisionStatus,
  Explanation,
  ReasonCode,
  TransactionKind,
  TransactionStatus,
} from '@runwaymind/shared';
import { DEFAULT_AGENT_SETTINGS } from '@runwaymind/shared';
import type { DecodedError } from '../chain/errors';
import type { DecodedEvent } from '../chain/events';

export type AgentFunctionName = 'invest' | 'withdraw' | 'tripCircuitBreaker';

/** Decisions that may still change state (dedupe / supersede scope, docs/05 §2). */
export const OPEN_DECISION_STATUSES: readonly DecisionStatus[] = ['PENDING_APPROVAL', 'APPROVED', 'EXECUTING'];

export interface DecisionRecord {
  id: string;
  snapshotId: string;
  action: AgentActionType;
  adapter: Address | null;
  amount: Amount | null;
  reasonCode: ReasonCode;
  status: DecisionStatus;
  mode: AgentMode;
  facts: DecisionFacts;
  explanation: Explanation | null;
  approvedBy: string | null;
  approvedAt: Date | null;
  rejectedBy: string | null;
  rejectReason: string | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type NewDecision = Pick<
  DecisionRecord,
  'snapshotId' | 'action' | 'adapter' | 'amount' | 'reasonCode' | 'status' | 'mode' | 'facts' | 'explanation' | 'expiresAt'
> &
  Partial<Pick<DecisionRecord, 'approvedBy' | 'approvedAt'>>;

export type DecisionPatch = Partial<
  Pick<DecisionRecord, 'status' | 'amount' | 'approvedBy' | 'approvedAt' | 'rejectedBy' | 'rejectReason' | 'explanation'>
> & { status: DecisionStatus };

export interface ActionRecord {
  id: string;
  decisionId: string;
  functionName: AgentFunctionName;
  args: readonly unknown[];
  status: AgentActionStatus;
  txHash: string | null;
  decodedError: DecodedError | null;
  gasUsed: bigint | null;
  blockNumber: bigint | null;
  attempt: number;
  createdAt: Date;
  updatedAt: Date;
}

export type NewAction = Pick<ActionRecord, 'decisionId' | 'functionName' | 'args' | 'status'> & { attempt?: number };
export type ActionPatch = Partial<Pick<ActionRecord, 'status' | 'txHash' | 'decodedError' | 'gasUsed' | 'blockNumber' | 'attempt'>>;

export type TxInitiator = 'AGENT' | 'KEEPER' | 'ADMIN_UI' | 'INDEXER';

export interface TransactionInput {
  hash: string;
  kind: TransactionKind;
  from: string;
  initiator: TxInitiator;
  status: TransactionStatus;
  blockNumber: bigint | null;
  decodedEvents: DecodedEvent[] | null;
  error: unknown;
  relatedId: string | null;
  confirmedAt?: Date | null;
}

export interface KeeperRunStart {
  chainTime: number;
  shortfallBefore: Amount;
  startedAt: Date;
}

export interface KeeperRunError {
  step: 'enforceDeadlines' | 'pay' | 'read';
  obligationId?: string;
  error: DecodedError | string;
}

export interface KeeperRunFinish {
  finishedAt: Date;
  enforced: boolean;
  paidIds: bigint[];
  txHashes: string[];
  errors: KeeperRunError[];
}

export interface AgentStore {
  getSettings(): Promise<AgentSettings>;
  /** Off-chain obligation labels keyed by on-chain id (decision facts, docs/05 §5.3). */
  obligationLabels(): Promise<Record<string, string>>;
  saveSnapshot(s: ChainSnapshot, l: CashLadderResult): Promise<void>;

  listOpenDecisions(): Promise<DecisionRecord[]>;
  getDecision(id: string): Promise<DecisionRecord | null>;
  createDecision(d: NewDecision): Promise<DecisionRecord>;
  /** Compare-and-set: applies `patch` only when the current status is one of `from`; returns null otherwise. */
  transitionDecision(id: string, from: readonly DecisionStatus[], patch: DecisionPatch): Promise<DecisionRecord | null>;
  /** PENDING_APPROVAL decisions with `expiresAt <= now` → EXPIRED; returns the expired records. */
  expireDecisions(now: Date): Promise<DecisionRecord[]>;

  createAction(a: NewAction): Promise<ActionRecord>;
  updateAction(id: string, patch: ActionPatch): Promise<ActionRecord>;
  listActions(decisionId: string): Promise<ActionRecord[]>;

  upsertTransaction(t: TransactionInput): Promise<void>;

  startKeeperRun(r: KeeperRunStart): Promise<string>;
  finishKeeperRun(id: string, r: KeeperRunFinish): Promise<void>;
}

/** In-memory store (tests / tooling). */
export class MemoryAgentStore implements AgentStore {
  settings: AgentSettings = { ...DEFAULT_AGENT_SETTINGS };
  labels: Record<string, string> = {};
  snapshots: { snapshot: ChainSnapshot; ladder: CashLadderResult }[] = [];
  decisions = new Map<string, DecisionRecord>();
  actions = new Map<string, ActionRecord>();
  transactions = new Map<string, TransactionInput>();
  keeperRuns = new Map<string, KeeperRunStart & Partial<KeeperRunFinish>>();
  private seq = 0;

  constructor(private readonly now: () => Date = () => new Date()) {}

  async getSettings() {
    return this.settings;
  }
  async obligationLabels() {
    return this.labels;
  }
  async saveSnapshot(snapshot: ChainSnapshot, ladder: CashLadderResult) {
    this.snapshots.push({ snapshot, ladder });
  }
  async listOpenDecisions() {
    return [...this.decisions.values()].filter((d) => OPEN_DECISION_STATUSES.includes(d.status));
  }
  async getDecision(id: string) {
    return this.decisions.get(id) ?? null;
  }
  async createDecision(d: NewDecision) {
    const t = this.now();
    this.seq += 1;
    const rec: DecisionRecord = {
      approvedBy: null,
      approvedAt: null,
      rejectedBy: null,
      rejectReason: null,
      ...d,
      id: `dec_${String(this.seq).padStart(4, '0')}_${randomUUID().slice(0, 8)}`,
      createdAt: t,
      updatedAt: t,
    };
    this.decisions.set(rec.id, rec);
    return rec;
  }
  async transitionDecision(id: string, from: readonly DecisionStatus[], patch: DecisionPatch) {
    const cur = this.decisions.get(id);
    if (!cur || !from.includes(cur.status)) return null;
    const next = { ...cur, ...patch, updatedAt: this.now() };
    this.decisions.set(id, next);
    return next;
  }
  async expireDecisions(now: Date) {
    const out: DecisionRecord[] = [];
    for (const d of this.decisions.values()) {
      if (d.status === 'PENDING_APPROVAL' && d.expiresAt.getTime() <= now.getTime()) {
        const next = { ...d, status: 'EXPIRED' as const, updatedAt: now };
        this.decisions.set(d.id, next);
        out.push(next);
      }
    }
    return out;
  }
  async createAction(a: NewAction) {
    const t = this.now();
    const rec: ActionRecord = {
      id: `act_${randomUUID()}`,
      txHash: null,
      decodedError: null,
      gasUsed: null,
      blockNumber: null,
      createdAt: t,
      updatedAt: t,
      ...a,
      attempt: a.attempt ?? 1,
    };
    this.actions.set(rec.id, rec);
    return rec;
  }
  async updateAction(id: string, patch: ActionPatch) {
    const cur = this.actions.get(id);
    if (!cur) throw new Error(`action ${id} not found`);
    const next = { ...cur, ...patch, updatedAt: this.now() };
    this.actions.set(id, next);
    return next;
  }
  async listActions(decisionId: string) {
    return [...this.actions.values()].filter((a) => a.decisionId === decisionId);
  }
  async upsertTransaction(t: TransactionInput) {
    this.transactions.set(t.hash, { ...this.transactions.get(t.hash), ...t });
  }
  async startKeeperRun(r: KeeperRunStart) {
    const id = `kr_${randomUUID()}`;
    this.keeperRuns.set(id, r);
    return id;
  }
  async finishKeeperRun(id: string, r: KeeperRunFinish) {
    this.keeperRuns.set(id, { ...this.keeperRuns.get(id)!, ...r });
  }
}
