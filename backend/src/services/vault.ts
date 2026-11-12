// Manual vault actions (docs/07 §5.5–§5.6). ADMIN chooses how the action is executed:
// - AGENT (default): an AgentDecision with reasonCode MANUAL is created APPROVED and run by the agent executor
//   (AGENT key, same on-chain policy R1–R6 as rule decisions).
// - ADMIN_WALLET: a prepared Treasury call is returned for the ADMIN wallet to sign (the backend never holds that key).
// Both paths simulate first; a revert → 409 POLICY_VIOLATION with the decoded custom error.
import { encodeFunctionData, getAddress, maxUint256, type Abi, type Address, type Hex } from 'viem';
import { treasuryAbi } from '@runwaymind/shared/abi';
import type { AgentActionType, VaultInvestmentRequest, VaultWithdrawalRequest } from '@runwaymind/shared';
import {
  POLICY_RULE_BY_ERROR,
  computeCashLadder,
  manualFacts,
  templateExplanation,
  type AgentStore,
  type AuditLogger,
} from '@runwaymind/agent';
import { ApiError } from '../errors';
import type { Repositories } from '../repositories';
import type { Scheduler } from '../scheduler';
import { decisionJson } from './agent';
import type { ChainService, SimulationResult } from './chain';

export interface TreasuryPreparedTx {
  to: Address;
  data: Hex;
  value: '0';
  chainId: number;
  functionName: 'invest' | 'withdraw';
}

export interface VaultServiceDeps {
  chain: ChainService;
  repos: Repositories;
  store: AgentStore;
  audit: AuditLogger;
  scheduler: Pick<Scheduler, 'executorEnabled' | 'agentAddress' | 'enqueue'> | null;
  chainId: number;
  now?: () => Date;
}

/** Simulation revert → 409 POLICY_VIOLATION carrying the decoded error and the policy rule it maps to. */
export function simulationFailure(sim: Exclude<SimulationResult, { ok: true }>): ApiError {
  if (sim.error) {
    const rule = POLICY_RULE_BY_ERROR[sim.error.name] ?? null;
    const msg = rule ? `Blocked by ${rule}: ${sim.error.name}` : `Rejected on-chain: ${sim.error.name}`;
    return new ApiError('POLICY_VIOLATION', msg, { error: sim.error, rule });
  }
  return new ApiError('POLICY_VIOLATION', `Simulation reverted: ${sim.message}`, { error: null, rule: null });
}

export function createVaultService(deps: VaultServiceDeps) {
  const { chain, repos, store, audit, scheduler, chainId } = deps;
  const now = deps.now ?? (() => new Date());
  const treasury = chain.addresses.treasury;

  const prepared = (functionName: 'invest' | 'withdraw', args: readonly [Address, bigint]): TreasuryPreparedTx => ({
    to: treasury,
    data: encodeFunctionData({ abi: treasuryAbi as Abi, functionName, args } as never),
    value: '0',
    chainId,
    functionName,
  });

  async function simulateOrThrow(from: Address, functionName: 'invest' | 'withdraw', args: readonly [Address, bigint]) {
    const sim = await chain.simulate(from, { address: treasury, abi: treasuryAbi as Abi, functionName, args });
    if (!sim.ok) throw simulationFailure(sim);
    return { ok: true as const, error: null };
  }

  function agentAccount(): Address {
    if (!scheduler?.executorEnabled || !scheduler.agentAddress) {
      throw new ApiError('INVALID_STATE', 'Agent executor is not configured (AGENT_ENABLED=false or AGENT_PRIVATE_KEY unset); use executeVia ADMIN_WALLET');
    }
    return scheduler.agentAddress;
  }

  /** AGENT path: MANUAL decision created APPROVED by the ADMIN, then enqueued on the AGENT executor. */
  async function viaAgent(
    action: AgentActionType,
    adapter: Address,
    callAmount: bigint,
    decisionAmount: bigint,
    by: Address,
  ) {
    const agent = agentAccount();
    const functionName = action === 'INVEST' ? 'invest' : 'withdraw';
    const simulation = await simulateOrThrow(agent, functionName, [adapter, callAmount]);

    const [snapshot, settings] = await Promise.all([chain.getSnapshot(), repos.agentSettings()]);
    const ladder = computeCashLadder(snapshot);
    await store.saveSnapshot(snapshot, ladder);
    const facts = manualFacts(snapshot, ladder, settings, adapter, decisionAmount);
    const t = now();
    const rec = await store.createDecision({
      snapshotId: snapshot.snapshotId,
      action,
      adapter,
      amount: decisionAmount,
      reasonCode: 'MANUAL',
      status: 'APPROVED',
      mode: settings.mode,
      facts,
      explanation: templateExplanation({ action, reasonCode: 'MANUAL', facts, minApyBps: settings.minApyBps }),
      expiresAt: new Date(t.getTime() + settings.decisionTtlSec * 1000),
      approvedBy: by,
      approvedAt: t,
    });
    const entity = { actor: by, entityType: 'DECISION' as const, entityId: rec.id };
    await audit.record(
      'DECISION_CREATED',
      { action, adapter, amount: decisionAmount, reasonCode: 'MANUAL', status: 'APPROVED', executeVia: 'AGENT', snapshotId: rec.snapshotId },
      entity,
    );
    await audit.record('DECISION_APPROVED', { action, amount: decisionAmount, adapter, executeVia: 'AGENT' }, entity);
    void scheduler!.enqueue(rec.id); // async: client polls GET /recommendations/:id
    return { executeVia: 'AGENT' as const, decision: decisionJson(rec), preparedTx: null, simulation };
  }

  async function viaAdminWallet(functionName: 'invest' | 'withdraw', adapter: Address, amount: bigint, by: Address) {
    const simulation = await simulateOrThrow(by, functionName, [adapter, amount]);
    return { executeVia: 'ADMIN_WALLET' as const, decision: null, preparedTx: prepared(functionName, [adapter, amount]), simulation };
  }

  return {
    /** §5.5 — "MAX" withdraws the full adapter balance (Treasury.withdraw treats type(uint256).max as balance). */
    async withdraw(body: VaultWithdrawalRequest, by: Address) {
      const adapter = getAddress(body.adapter);
      const all = body.amount === 'MAX';
      const callAmount = all ? maxUint256 : BigInt(body.amount);
      if (body.executeVia === 'ADMIN_WALLET') return viaAdminWallet('withdraw', adapter, callAmount, by);

      let decisionAmount = callAmount;
      if (all) {
        const state = (await chain.getSnapshot()).adapters.find((a) => a.address.toLowerCase() === adapter.toLowerCase());
        decisionAmount = state?.balance ?? 0n;
        if (state && decisionAmount === 0n) throw new ApiError('INVALID_STATE', 'Adapter balance is 0: nothing to withdraw');
      }
      return viaAgent(all ? 'WITHDRAW_ALL' : 'WITHDRAW', adapter, callAmount, decisionAmount, by);
    },

    /** §5.6 — manual invest; R1/R3/R4/R6 rejections surface as 409 POLICY_VIOLATION before anything is sent. */
    async invest(body: VaultInvestmentRequest, by: Address) {
      const adapter = getAddress(body.adapter);
      const amount = BigInt(body.amount);
      if (body.executeVia === 'ADMIN_WALLET') return viaAdminWallet('invest', adapter, amount, by);
      return viaAgent('INVEST', adapter, amount, amount, by);
    },
  };
}

export type VaultService = ReturnType<typeof createVaultService>;
