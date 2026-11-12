// D6-A1 smoke run on the real-USDC treasury (docs/02 §H, docs/11 §7.2): register obligation 1 USDC due +1 day →
// AGENT invests 5 USDC → ADMIN advanceTime 1 day → KEEPER pays → AGENT withdraws all. Every tx is waited for and
// recorded (hash, Snowtrace link, status) in docs/USDC_SMOKE_TEST.md. Keys only from .env (rule 7); amounts bigint.
//
// Usage: pnpm demo:usdc-smoke                       (Fuji, deployment/fuji-usdc.json, FUJI_RPC_URL)
//        pnpm demo:usdc-smoke --rpc-url <url> --deployment <file> --report <file>   (e.g. an Anvil fork of Fuji)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPublicClient, createWalletClient, erc20Abi, http, maxUint256, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { avalancheFuji } from 'viem/chains';
import { formatUsdc, loadDeployment } from '@runwaymind/shared';
import { mockLendingPoolAbi, obligationRegistryAbi, treasuryAbi, vaultAdapterAbi } from '@runwaymind/shared/abi';

const ROOT = resolve(import.meta.dirname, '..', '..');
const USDC = 1_000_000n;
const DAY = 86_400n;
const MIN_TREASURY = 10n * USDC; // docs: fund 10–20 USDC from the Circle faucet
const RESERVE = 1n * USDC;

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : def;
};
const strip = (v: string | undefined) => v?.replace(/\s+#.*$/, '').trim() || undefined;
const key = (name: string): Hex => {
  const v = strip(process.env[name]);
  if (!v || !/^0x[0-9a-fA-F]{64}$/.test(v)) throw new Error(`${name} missing or malformed in .env`);
  return v as Hex;
};

interface Step {
  step: string;
  signer: string;
  hash: Hex;
  status: string;
  block: bigint;
  note: string;
}

async function main(): Promise<number> {
  if (existsSync(resolve(ROOT, '.env'))) process.loadEnvFile(resolve(ROOT, '.env'));
  const rpcUrl = arg('--rpc-url', strip(process.env.FUJI_RPC_URL) ?? '');
  if (!rpcUrl) throw new Error('FUJI_RPC_URL is not set');
  const deploymentFile = resolve(ROOT, arg('--deployment', 'deployment/fuji-usdc.json'));
  const reportFile = resolve(ROOT, arg('--report', 'docs/USDC_SMOKE_TEST.md'));
  const explorer = (strip(process.env.NEXT_PUBLIC_SNOWTRACE_BASE) ?? 'https://testnet.snowtrace.io').replace(/\/$/, '');
  const recipient = (strip(process.env.RECIPIENT_PAYROLL) ?? '0x0000000000000000000000000000000000000001') as Address;

  const d = loadDeployment(JSON.parse(readFileSync(deploymentFile, 'utf8')));
  const { Treasury: treasury, ObligationRegistry: registry, MockLendingPool: pool, VaultAdapter: adapter } = d.contracts;
  const admin = privateKeyToAccount(key('DEPLOYER_PRIVATE_KEY'));
  const agent = privateKeyToAccount(key('AGENT_PRIVATE_KEY'));
  const keeper = privateKeyToAccount(key('KEEPER_PRIVATE_KEY'));
  const pub = createPublicClient({ chain: avalancheFuji, transport: http(rpcUrl) });
  const wallet = (account: typeof admin) => createWalletClient({ account, chain: avalancheFuji, transport: http(rpcUrl) });
  const asset = (await pub.readContract({ address: treasury, abi: treasuryAbi, functionName: 'asset' })) as Address;
  const bal = (who: Address) => pub.readContract({ address: asset, abi: erc20Abi, functionName: 'balanceOf', args: [who] });

  const steps: Step[] = [];
  async function send(step: string, signer: string, account: typeof admin, req: Parameters<ReturnType<typeof wallet>['writeContract']>[0], note = '') {
    const { request } = await pub.simulateContract({ ...(req as object), account } as never);
    const hash = await wallet(account).writeContract(request as never);
    const r = await pub.waitForTransactionReceipt({ hash });
    steps.push({ step, signer, hash, status: r.status, block: r.blockNumber, note });
    console.log(`${r.status === 'success' ? 'OK  ' : 'FAIL'} ${step.padEnd(34)} ${explorer}/tx/${hash}`);
    if (r.status !== 'success') throw new Error(`${step} reverted`);
    return r;
  }

  const idle0 = await bal(treasury);
  console.log(`USDC treasury ${treasury} (asset ${asset}) idle ${formatUsdc(idle0)} USDC`);
  if (idle0 < MIN_TREASURY) {
    throw new Error(`Treasury holds ${formatUsdc(idle0)} USDC; fund it with 10–20 USDC from https://faucet.circle.com (Avalanche Fuji) first`);
  }

  // Pool interest reserve (1 USDC) so the pool can pay accrued interest on withdraw-all.
  const poolCash0 = await bal(pool);
  if (poolCash0 < RESERVE) {
    if ((await bal(admin.address)) < RESERVE) throw new Error('ADMIN needs 1 USDC to fund the pool interest reserve');
    await send('ADMIN approve 1 USDC → pool', 'ADMIN', admin, { address: asset, abi: erc20Abi, functionName: 'approve', args: [pool, RESERVE] });
    await send('ADMIN fundInterestReserve(1 USDC)', 'ADMIN', admin, { address: pool, abi: mockLendingPoolAbi, functionName: 'fundInterestReserve', args: [RESERVE] });
  }

  const now0 = (await pub.readContract({ address: treasury, abi: treasuryAbi, functionName: 'currentTime' })) as bigint;
  const id = (await pub.readContract({ address: registry, abi: obligationRegistryAbi, functionName: 'obligationCount' })) as bigint + 1n;
  await send('ADMIN createObligation 1 USDC @ +1d', 'ADMIN', admin, {
    address: registry,
    abi: obligationRegistryAbi,
    functionName: 'createObligation',
    args: [{ recipient, amount: 1n * USDC, firstDueDate: now0 + DAY, interval: 0n, maxOccurrences: 1, category: 0, metadataHash: `0x${'0'.repeat(64)}` }],
  }, `obligation #${id} → ${recipient}`);
  const required = (await pub.readContract({ address: treasury, abi: treasuryAbi, functionName: 'requiredReserve' })) as bigint;

  await send('AGENT invest 5 USDC', 'AGENT', agent, { address: treasury, abi: treasuryAbi, functionName: 'invest', args: [adapter, 5n * USDC] },
    `required reserve ${formatUsdc(required)} USDC`);
  await send('ADMIN advanceTime(1 day)', 'ADMIN', admin, { address: treasury, abi: treasuryAbi, functionName: 'advanceTime', args: [DAY] });
  const recipientBefore = await bal(recipient);
  await send(`KEEPER pay(${id})`, 'KEEPER', keeper, { address: treasury, abi: treasuryAbi, functionName: 'pay', args: [id] });
  const paid = (await bal(recipient)) - recipientBefore;
  const vaultBefore = (await pub.readContract({ address: adapter, abi: vaultAdapterAbi, functionName: 'balance' })) as bigint;
  await send('AGENT withdraw all', 'AGENT', agent, { address: treasury, abi: treasuryAbi, functionName: 'withdraw', args: [adapter, maxUint256] },
    `vault ${formatUsdc(vaultBefore, 6, 6)} USDC incl. 1 day of interest`);
  const vaultAfter = (await pub.readContract({ address: adapter, abi: vaultAdapterAbi, functionName: 'balance' })) as bigint;
  const idle1 = await bal(treasury);

  const ok = paid === 1n * USDC && vaultAfter === 0n;
  const rows = steps.map((s) => `| ${s.step} | ${s.signer} | ${s.status === 'success' ? '✅ confirmed' : '❌ ' + s.status} | ${s.block} | [${s.hash.slice(0, 10)}…](${explorer}/tx/${s.hash}) | ${s.note} |`);
  const md = `# USDC smoke test (D6-A1)

> Generated by \`scripts/demo/usdcSmoke.ts\` against \`${deploymentFile.replace(ROOT, '.').replace(/\\/g, '/')}\`. Every transaction below was mined and its receipt checked.

| Item | Value |
|---|---|
| Asset | Circle USDC \`${asset}\` |
| Treasury | [\`${treasury}\`](${explorer}/address/${treasury}) |
| Pool / adapter | \`${pool}\` / \`${adapter}\` |
| Idle before → after | ${formatUsdc(idle0, 6, 6)} → ${formatUsdc(idle1, 6, 6)} USDC |
| Recipient received | ${formatUsdc(paid, 6, 6)} USDC (expected 1.000000) |
| Vault after withdraw-all | ${formatUsdc(vaultAfter, 6, 6)} USDC (expected 0) |
| Result | **${ok ? 'PASS' : 'FAIL'}** |

| Step | Signer | Status | Block | Tx | Note |
|---|---|---|---|---|---|
${rows.join('\n')}
`;
  writeFileSync(reportFile, md);
  console.log(`\n${ok ? 'PASS' : 'FAIL'} — paid ${formatUsdc(paid, 6, 6)} USDC, vault after ${formatUsdc(vaultAfter, 6, 6)}; report: ${reportFile}`);
  return ok ? 0 : 1;
}

main().then(
  (c) => process.exit(c),
  (e: unknown) => {
    console.error(`usdc smoke failed: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
    process.exit(2);
  },
);
