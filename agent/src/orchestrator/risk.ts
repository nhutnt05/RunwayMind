// Pool Risk per tick (docs/06 §4.1): one PoolMetricSample per adapter from the snapshot, scored against the stored
// history (newest RISK_SAMPLE_WINDOW samples incl. the current one). Shared by the agent tick and the executor's
// staleness check so both see the same risk scores.
import type { AgentSettings, ChainSnapshot, PoolMetricSample, PoolRiskResult } from '@runwaymind/shared';
import { RISK_SAMPLE_WINDOW, computePoolRisk, sampleFromAdapter } from '../engines/poolRisk';
import type { AgentStore } from './store';

export interface SnapshotRisks {
  samples: PoolMetricSample[];
  risks: PoolRiskResult[];
}

export async function computeSnapshotRisks(
  store: Pick<AgentStore, 'poolHistory'>,
  s: ChainSnapshot,
  settings: Pick<AgentSettings, 'riskInvestThreshold' | 'riskWithdrawThreshold'>,
): Promise<SnapshotRisks> {
  const samples = s.adapters.map((a) => sampleFromAdapter(a, s.chainTime, s.blockNumber));
  const risks = await Promise.all(
    s.adapters.map(async (a, i) => {
      const history = await store.poolHistory(a.address, RISK_SAMPLE_WINDOW - 1);
      return computePoolRisk(a, [samples[i]!, ...history], {
        computedAt: s.chainTime,
        decimals: s.assetDecimals,
        thresholds: settings,
      });
    }),
  );
  return { samples, risks };
}
