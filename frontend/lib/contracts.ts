// Contract addresses and ABIs (docs/08 §6): addresses from the shared deployments (synced by `sync-abi`), ABIs from
// the shared package (generated from forge out/, never hand-written).
import { deploymentForChain, type Deployment } from '@runwaymind/shared';
import { mockLendingPoolAbi, obligationRegistryAbi, policyEngineAbi, treasuryAbi } from '@runwaymind/shared/abi';
import { deploymentFiles } from '@runwaymind/shared/deployments';
import { appChain } from './chains';

export const deployment: Deployment | null = deploymentForChain(deploymentFiles, appChain.id);

export const contracts = deployment
  ? {
      treasury: { address: deployment.contracts.Treasury, abi: treasuryAbi },
      registry: { address: deployment.contracts.ObligationRegistry, abi: obligationRegistryAbi },
      policy: { address: deployment.contracts.PolicyEngine, abi: policyEngineAbi },
      pool: { address: deployment.contracts.MockLendingPool, abi: mockLendingPoolAbi },
    }
  : null;

export const DEFAULT_ADMIN_ROLE = `0x${'0'.repeat(64)}` as const;
