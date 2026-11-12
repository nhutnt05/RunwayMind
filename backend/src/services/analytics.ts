// Pools / Pool Risk (docs/07 §4.4), runway + stress tests (§4.5) and expected inflows (§4.6, A-09).
// Financial logic lives in agent engines (computePoolRisk, computeRunway, runStressTest); this layer reads the
// chain snapshot, loads history / inflows from the DB, persists runs and maps errors.
import type { PrismaClient } from '@prisma/client';
import type { Address } from 'viem';
import {
  baselineRunwayInput,
  computeRunway,
  computeSnapshotRisks,
  runStressTest,
  type AgentStore,
  type AuditLogger,
} from '@runwaymind/agent';
import { parseJson, stringifyJson, type StressScenarioId, type StressTestResult } from '@runwaymind/shared';
import { ApiError, notFound } from '../errors';
import type { Repositories } from '../repositories';
import { newId, toPoolSample } from '../repositories/agentStore';
import type { ChainService } from './chain';

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export interface AnalyticsDeps {
  chain: ChainService;
  prisma: PrismaClient;
  repos: Repositories;
  store: Pick<AgentStore, 'poolHistory'>;
  audit: AuditLogger;
}

export function createAnalyticsService({ chain, prisma, repos, store }: AnalyticsDeps) {
  const treasuryId = repos.treasuryId;

  async function snapshotWithRisks() {
    const [s, settings] = await Promise.all([chain.getSnapshot(), repos.agentSettings()]);
    const { risks } = await computeSnapshotRisks(store, s, settings);
    return { s, risks };
  }

  function stressRow(row: { id: string; result: string; requestedBy: string | null; createdAt: Date }) {
    return { id: row.id, ...(parseJson(row.result) as StressTestResult), requestedBy: row.requestedBy, createdAt: Math.floor(row.createdAt.getTime() / 1000) };
  }

  return {
    // ---- §4.4 pools -------------------------------------------------------------------------------------------
    async listPools() {
      const { s, risks } = await snapshotWithRisks();
      const data = s.adapters.map((a) => {
        const r = risks.find((x) => same(x.adapter, a.address))!;
        return { ...a, riskScore: r.score, band: r.band };
      });
      return { data, chainTime: s.chainTime, blockNumber: s.blockNumber };
    },

    /** Adapter detail + last 100 PoolMetricSample (+ last 100 PoolRiskSnapshot for the history chart). */
    async getPool(adapter: Address) {
      const { s, risks } = await snapshotWithRisks();
      const a = s.adapters.find((x) => same(x.address, adapter));
      if (!a) throw notFound(`Adapter ${adapter}`);
      const [samples, riskRows] = await Promise.all([
        prisma.poolMetricSample.findMany({ where: { adapterAddress: a.address }, orderBy: [{ sampledAt: 'desc' }, { id: 'desc' }], take: 100 }),
        prisma.poolRiskSnapshot.findMany({ where: { adapterAddress: a.address }, orderBy: [{ computedAt: 'desc' }, { id: 'desc' }], take: 100 }),
      ]);
      const risk = risks.find((x) => same(x.adapter, a.address))!;
      return {
        data: {
          ...a,
          riskScore: risk.score,
          band: risk.band,
          risk,
          samples: samples.map(toPoolSample),
          riskHistory: riskRows.map((r) => ({ computedAt: r.computedAt, score: r.score, band: r.band, snapshotId: r.snapshotId })),
        },
        chainTime: s.chainTime,
        blockNumber: s.blockNumber,
      };
    },

    async getPoolRisk(adapter: Address) {
      const { s, risks } = await snapshotWithRisks();
      const r = risks.find((x) => same(x.adapter, adapter));
      if (!r) throw notFound(`Adapter ${adapter}`);
      return { data: r, chainTime: s.chainTime, blockNumber: s.blockNumber };
    },

    // ---- §4.5 runway + stress tests ---------------------------------------------------------------------------
    async runway() {
      const [s, inflows, last] = await Promise.all([
        chain.getSnapshot(),
        repos.inflows(),
        prisma.stressTestRun.findFirst({ where: { treasuryId }, orderBy: { createdAt: 'desc' } }),
      ]);
      const baseline = computeRunway(baselineRunwayInput(s, inflows));
      let worstCase: { id: StressScenarioId; runwayDays: number; classification: string } | null = null;
      if (last) {
        const res = parseJson(last.result) as StressTestResult;
        const w = [res.baseline, ...res.scenarios].find((x) => x.id === res.worstCase);
        if (w) worstCase = { id: w.id, runwayDays: w.runway.runwayDays, classification: w.runway.classification };
      }
      return { data: { baseline, worstCase, lastStressTestId: last?.id ?? null }, chainTime: s.chainTime, blockNumber: s.blockNumber };
    },

    async runStressTests(scenarios: StressScenarioId[] | undefined, by: string) {
      const [s, inflows, settings] = await Promise.all([chain.getSnapshot(), repos.inflows(), repos.agentSettings()]);
      const result = runStressTest(s, inflows, {
        minApyBps: settings.minApyBps,
        ...(scenarios ? { scenarios: scenarios.filter((x): x is Exclude<StressScenarioId, 'BASELINE'> => x !== 'BASELINE') } : {}),
      });
      const row = await prisma.stressTestRun.create({
        data: {
          id: newId('st'),
          treasuryId,
          snapshotId: s.snapshotId,
          scenarios: JSON.stringify(result.scenarios.map((x) => x.id)),
          result: stringifyJson(result),
          worstCase: result.worstCase,
          overallClass: result.overallClassification,
          requestedBy: by,
        },
      });
      return { data: stressRow(row), chainTime: s.chainTime, blockNumber: s.blockNumber };
    },

    async getStressTest(id: string) {
      const row = await prisma.stressTestRun.findFirst({ where: { id, treasuryId } });
      if (!row) throw notFound(`Stress test ${id}`);
      return stressRow(row);
    },

    async listStressTests(limit: number) {
      const rows = await prisma.stressTestRun.findMany({ where: { treasuryId }, orderBy: { createdAt: 'desc' }, take: limit });
      return rows.map(stressRow);
    },

    // ---- §4.6 expected inflows --------------------------------------------------------------------------------
    async listInflows() {
      return repos.inflows();
    },

    async createInflow(body: { label: string; amount: string; expectedDate: number }, by: string) {
      const { chainTime } = await chain.getSnapshot();
      if (body.expectedDate <= chainTime) {
        throw new ApiError('VALIDATION_ERROR', `expectedDate must be after the current chain time (${chainTime})`, [
          { path: 'expectedDate', issue: 'custom', message: 'must be in the future' },
        ]);
      }
      const row = await prisma.expectedInflow.create({
        data: { id: newId('inf'), treasuryId, label: body.label, amount: body.amount, expectedDate: body.expectedDate, createdBy: by },
      });
      return { id: row.id, label: row.label, amount: BigInt(row.amount), expectedDate: row.expectedDate };
    },

    async deleteInflow(id: string) {
      const res = await prisma.expectedInflow.deleteMany({ where: { id, treasuryId } });
      if (res.count === 0) throw notFound(`Inflow ${id}`);
      return { id, deleted: true };
    },
  };
}

export type AnalyticsService = ReturnType<typeof createAnalyticsService>;
