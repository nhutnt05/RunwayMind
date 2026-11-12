// Contract addresses and ABIs (docs/08 §6): addresses from the selected treasury (GET /treasuries, D6 multi-treasury)
// with the shared deployment file (synced by `sync-abi`) as fallback; ABIs from the shared package (generated from
// forge out/, never hand-written). `deployment` / `contracts` are live bindings updated by `applyTreasury`.
import { deploymentForChain, loadDeployment, type Address, type Deployment } from '@runwaymind/shared';
import { mockLendingPoolAbi, obligationRegistryAbi, policyEngineAbi, treasuryAbi } from '@runwaymind/shared/abi';
import { deploymentFiles } from '@runwaymind/shared/deployments';
import { appChain } from './chains';
import type { TreasuryInfo } from './treasurySelection';

const primaryDeployment: Deployment | null = deploymentForChain(deploymentFiles, appChain.id);

export interface ContractSet {
  treasury: { address: Address; abi: typeof treasuryAbi };
  registry: { address: Address; abi: typeof obligationRegistryAbi };
  policy: { address: Address; abi: typeof policyEngineAbi };
  pool: { address: Address | undefined; abi: typeof mockLendingPoolAbi };
}

function fromDeployment(d: Deployment | null): ContractSet | null {
  return d
    ? {
        treasury: { address: d.contracts.Treasury, abi: treasuryAbi },
        registry: { address: d.contracts.ObligationRegistry, abi: obligationRegistryAbi },
        policy: { address: d.contracts.PolicyEngine, abi: policyEngineAbi },
        pool: { address: d.contracts.MockLendingPool, abi: mockLendingPoolAbi },
      }
    : null;
}

/** Deployment file whose Treasury matches (for roles); null when none does. */
function deploymentForTreasury(treasury: Address): Deployment | null {
  for (const raw of Object.values(deploymentFiles)) {
    try {
      const d = loadDeployment(raw);
      if (d.contracts.Treasury.toLowerCase() === treasury.toLowerCase()) return d;
    } catch {
      /* not a deployment file */
    }
  }
  return null;
}

/** Contract set for a treasury from GET /treasuries (pure; exported for tests). */
export function contractsFromTreasury(t: TreasuryInfo): ContractSet {
  return {
    treasury: { address: t.treasuryAddress, abi: treasuryAbi },
    registry: { address: t.registryAddress, abi: obligationRegistryAbi },
    policy: { address: t.policyAddress, abi: policyEngineAbi },
    pool: { address: t.poolAddress ?? undefined, abi: mockLendingPoolAbi },
  };
}

export let deployment: Deployment | null = primaryDeployment;
export let contracts: ContractSet | null = fromDeployment(primaryDeployment);

/** Switches the live contract bindings to `t` (null → shared deployment file fallback). Idempotent. */
export function applyTreasury(t: TreasuryInfo | null): void {
  if (!t || t.chainId !== appChain.id) {
    deployment = primaryDeployment;
    contracts = fromDeployment(primaryDeployment);
    return;
  }
  if (contracts?.treasury.address.toLowerCase() === t.treasuryAddress.toLowerCase()) return;
  contracts = contractsFromTreasury(t);
  // Roles (admin / agent) are not part of /treasuries; take them from the matching file, else the primary one.
  deployment = deploymentForTreasury(t.treasuryAddress) ?? primaryDeployment;
}

export const DEFAULT_ADMIN_ROLE = `0x${'0'.repeat(64)}` as const;
