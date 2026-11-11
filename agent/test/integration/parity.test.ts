// D2 gate: engine requiredReserve == PolicyEngine.requiredReserve on a local deployment, at D0/D7/D16/D30/D31/D45
// (docs/10 §4.1 "On-chain parity"). Requires Anvil + Deploy.s.sol + SeedDemo.s.sol (docs/11 §5).
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestClient, createWalletClient, http, publicActions, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { anvil } from 'viem/chains';
import { treasuryAbi } from '@runwaymind/shared/abi';
import { loadDeployment } from '@runwaymind/shared';
import { computeCashLadder } from '../../src/engines/cashLadder';
import { readSnapshot } from '../../src/chain/reader';
import { decodeContractError } from '../../src/chain/errors';

const RPC = process.env.ANVIL_RPC_URL ?? 'http://127.0.0.1:8545';
const DEPLOYMENT = resolve(__dirname, '../../../deployment/local.json');
// Anvil default account #0 (public test key) = ADMIN of the local deployment; #2 = keeper.
const ADMIN_KEY: Hex = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const KEEPER_KEY: Hex = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdfa8ac8';
const DAY = 86_400n;

const enabled = existsSync(DEPLOYMENT);

describe.skipIf(!enabled)('on-chain parity with local Anvil deployment', () => {
  const test = createTestClient({ chain: anvil, mode: 'anvil', transport: http(RPC) }).extend(publicActions);
  const admin = createWalletClient({ chain: anvil, transport: http(RPC), account: privateKeyToAccount(ADMIN_KEY) });
  const keeper = createWalletClient({ chain: anvil, transport: http(RPC), account: privateKeyToAccount(KEEPER_KEY) });
  let addrs: { treasury: Address; registry: Address; policy: Address };
  let snapshotId: Hex;
  let t0: bigint;

  beforeAll(async () => {
    const d = loadDeployment(JSON.parse(readFileSync(DEPLOYMENT, 'utf8')));
    addrs = { treasury: d.contracts.Treasury, registry: d.contracts.ObligationRegistry, policy: d.contracts.PolicyEngine };
    snapshotId = await test.snapshot(); // every change below is reverted in afterAll
    // The keeper holds no role; give it gas (local only).
    await test.setBalance({ address: keeper.account.address, value: 10n ** 18n });
    t0 = BigInt(d.demoStartTime ?? 0);
  });

  afterAll(async () => {
    if (snapshotId) await test.revert({ id: snapshotId });
  });

  async function send(wallet: typeof admin, functionName: 'advanceTime' | 'pay' | 'invest' | 'enforceDeadlines', args: readonly unknown[]) {
    try {
      const hash = await wallet.writeContract({ address: addrs.treasury, abi: treasuryAbi, functionName, args } as never);
      await test.waitForTransactionReceipt({ hash });
    } catch (e) {
      throw new Error(`${functionName} reverted: ${JSON.stringify(decodeContractError(e))} ${(e as Error).message.slice(0, 600)}`);
    }
  }

  async function goToDay(day: bigint) {
    const now = (await test.readContract({ address: addrs.treasury, abi: treasuryAbi, functionName: 'currentTime' })) as bigint;
    const target = t0 + day * DAY;
    if (target > now) await send(admin, 'advanceTime', [target - now]);
  }

  async function expectParity(label: string) {
    const s = await readSnapshot(test as never, addrs);
    const ladder = computeCashLadder(s);
    expect(ladder.requiredReserve, label).toBe(s.onchainRequiredReserve);
    expect(ladder.warnings.find((w) => w.code === 'ONCHAIN_MISMATCH'), label).toBeUndefined();
    return { s, ladder };
  }

  it('matches at D0 / D7 / D16 / D30 / D31 / D45 through the SRC lifecycle', async () => {
    const d0 = await expectParity('D0');
    expect(d0.s.onchainRequiredReserve).toBe(30_000_000_000n);
    expect(d0.ladder.investableNow[0]?.amount).toBe(70_000_000_000n);

    const adapter = d0.s.adapters[0]!.address;
    await send(admin, 'invest', [adapter, 70_000_000_000n]); // admin may invest (AGENT or ADMIN)
    const after = await expectParity('D0 after invest');
    expect(after.ladder.withdrawalSchedule.map((x) => [x.deadline - Number(t0), x.amount])).toEqual([
      [16 * 86_400, 20_000_000_000n],
      [31 * 86_400, 10_000_000_000n],
    ]);

    await goToDay(7n);
    await send(keeper, 'pay', [1n]);
    expect((await expectParity('D7')).s.onchainRequiredReserve).toBe(10_000_000_000n);

    await goToDay(16n);
    expect((await expectParity('D16')).ladder.shortfall).toBe(20_000_000_000n);
    await send(keeper, 'enforceDeadlines', []);
    expect((await expectParity('D16 enforced')).ladder.shortfall).toBe(0n);

    await goToDay(30n);
    await send(keeper, 'pay', [2n]);
    expect((await expectParity('D30')).s.onchainRequiredReserve).toBe(10_000_000_000n);

    await goToDay(31n);
    expect((await expectParity('D31')).s.onchainRequiredReserve).toBe(20_000_000_000n);
    await send(keeper, 'enforceDeadlines', []);

    await goToDay(45n);
    await send(keeper, 'pay', [3n]);
    expect((await expectParity('D45')).s.onchainRequiredReserve).toBe(10_000_000_000n);
  });
});
