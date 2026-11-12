import { describe, expect, it } from 'vitest';
import { loadDeployment } from '../src/deployments';

const A = (n: number) => `0x${n.toString(16).padStart(40, '0')}`;

// Shape of docs/11 §7 `deployment/fuji.json`.
const fuji = {
  chainId: 43113,
  deployBlock: '39000000',
  demoMode: true,
  demoStartTime: 1793318400,
  contracts: {
    MockUSDC: A(1),
    ObligationRegistry: A(2),
    PolicyEngine: A(3),
    Treasury: A(4),
    MockLendingPool: A(5),
    VaultAdapter: A(6),
  },
  roles: { admin: A(7), agent: A(8) },
};

describe('loadDeployment', () => {
  it('parses the documented fuji.json shape; deployBlock becomes bigint', () => {
    const d = loadDeployment(fuji);
    expect(d.chainId).toBe(43113);
    expect(d.deployBlock).toBe(39_000_000n);
    expect(d.contracts.Treasury).toBe(A(4));
  });

  it('accepts a real-USDC deployment without MockUSDC', () => {
    const { MockUSDC: _omit, ...contracts } = fuji.contracts;
    expect(loadDeployment({ ...fuji, contracts }).contracts.MockUSDC).toBeUndefined();
  });

  it('rejects a missing contract address', () => {
    const { Treasury: _omit, ...contracts } = fuji.contracts;
    expect(() => loadDeployment({ ...fuji, contracts })).toThrow(/Treasury/);
  });
});

describe('deploymentForChain with a secondary treasury on the same chain (D6-A1)', () => {
  it('prefers the primary file (fuji) over fuji-usdc regardless of map order', async () => {
    const { deploymentForChain } = await import('../src/deployments');
    const dep = (treasury: string) => ({
      chainId: 43113,
      deployBlock: '1',
      demoMode: true,
      demoStartTime: 1,
      contracts: {
        ObligationRegistry: '0x0000000000000000000000000000000000000002',
        PolicyEngine: '0x0000000000000000000000000000000000000003',
        Treasury: treasury,
        MockLendingPool: '0x0000000000000000000000000000000000000004',
        VaultAdapter: '0x0000000000000000000000000000000000000005',
      },
      roles: { admin: '0x0000000000000000000000000000000000000006', agent: '0x0000000000000000000000000000000000000007' },
    });
    const usdc = dep('0x00000000000000000000000000000000000000Aa');
    const primary = dep('0x00000000000000000000000000000000000000bB');
    expect(deploymentForChain({ 'fuji-usdc': usdc, fuji: primary }, 43113)?.contracts.Treasury.toLowerCase()).toBe('0x00000000000000000000000000000000000000bb');
    expect(deploymentForChain({ 'fuji-usdc': usdc }, 43113)?.contracts.Treasury.toLowerCase()).toBe('0x00000000000000000000000000000000000000aa');
  });
});
