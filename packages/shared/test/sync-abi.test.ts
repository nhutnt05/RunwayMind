import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { abiConstName, renderAbiModule, syncAbi } from '../scripts/sync-abi';

const CONTRACTS = ['Treasury', 'ObligationRegistry', 'PolicyEngine', 'VaultAdapter', 'MockLendingPool', 'MockUSDC'];

describe('sync-abi', () => {
  let root: string | undefined;
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  function setup(withAave: boolean): { repoRoot: string; packageRoot: string } {
    root = mkdtempSync(join(tmpdir(), 'rm-sync-'));
    const repoRoot = join(root, 'repo');
    const packageRoot = join(repoRoot, 'packages', 'shared');
    mkdirSync(packageRoot, { recursive: true });
    for (const c of withAave ? [...CONTRACTS, 'AaveV3Adapter'] : CONTRACTS) {
      mkdirSync(join(repoRoot, 'out', `${c}.sol`), { recursive: true });
      writeFileSync(join(repoRoot, 'out', `${c}.sol`, `${c}.json`), JSON.stringify({ abi: [{ type: 'function', name: `f${c}` }] }));
    }
    mkdirSync(join(repoRoot, 'deployment'));
    writeFileSync(join(repoRoot, 'deployment', 'fuji.json'), '{"chainId":43113}');
    writeFileSync(join(repoRoot, 'deployment', 'local.json'), '{"chainId":31337}');
    return { repoRoot, packageRoot };
  }

  it('names constants in lowerCamelCase', () => {
    expect(abiConstName('MockUSDC')).toBe('mockUSDCAbi');
    expect(abiConstName('ObligationRegistry')).toBe('obligationRegistryAbi');
  });

  it('renders an `as const` module', () => {
    expect(renderAbiModule('Treasury', [])).toContain('export const treasuryAbi = [] as const;');
  });

  it('writes the 6 ABIs, an index, and copies deployments', () => {
    const paths = setup(false);
    const result = syncAbi({ ...paths, network: null });
    expect(result.abis).toEqual(CONTRACTS);
    expect(result.deployments.sort()).toEqual(['fuji.json', 'local.json']);
    const index = readFileSync(join(paths.packageRoot, 'src', 'abi', 'index.ts'), 'utf8');
    expect(index).toContain("export { treasuryAbi } from './Treasury';");
    expect(index).not.toContain('aaveV3AdapterAbi');
    expect(existsSync(join(paths.packageRoot, 'src', 'deployments', 'fuji.json'))).toBe(true);
    const depIndex = readFileSync(join(paths.packageRoot, 'src', 'deployments', 'index.ts'), 'utf8');
    expect(depIndex).toContain("import fuji from './fuji.json';");
    expect(depIndex).toContain("'local': local");
  });

  it('includes AaveV3Adapter when present and filters deployments by --network', () => {
    const paths = setup(true);
    const result = syncAbi({ ...paths, network: 'fuji' });
    expect(result.abis).toContain('AaveV3Adapter');
    expect(result.deployments).toEqual(['fuji.json']);
  });

  it('fails clearly when a required artifact is missing', () => {
    const paths = setup(false);
    rmSync(join(paths.repoRoot, 'out', 'Treasury.sol'), { recursive: true });
    expect(() => syncAbi({ ...paths, network: null })).toThrow(/Treasury/);
  });
});
