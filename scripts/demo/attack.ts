// Hacked-agent scene (docs/12 §2.1, docs/10 §3 #1–#2). Uses the AGENT key and tries to move Treasury funds.
// Every attempt is sent with gas 300_000 so client-side estimation is skipped and the revert is MINED (visible on
// Snowtrace). Exit code 0 only if ALL attempts reverted and the Treasury balance is unchanged.
//
// Usage:  pnpm demo:attack                 (Fuji: deployment/fuji.json, FUJI_RPC_URL, AGENT_PRIVATE_KEY from .env)
//         pnpm demo:attack --network local (Anvil 127.0.0.1:8545, deployment/local.json, Anvil account #1 = AGENT)
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  BaseError,
  createPublicClient,
  createWalletClient,
  decodeErrorResult,
  encodeFunctionData,
  erc20Abi,
  http,
  type Abi,
  type Account,
  type Address,
  type Hex,
} from 'viem';
import { mnemonicToAccount, privateKeyToAccount } from 'viem/accounts';
import { avalancheFuji, foundry } from 'viem/chains';
import { formatUsdc, loadDeployment } from '@runwaymind/shared';
import {
  mockLendingPoolAbi,
  mockUSDCAbi,
  obligationRegistryAbi,
  policyEngineAbi,
  treasuryAbi,
  vaultAdapterAbi,
} from '@runwaymind/shared/abi';

const ROOT = resolve(import.meta.dirname, '..', '..');
const GAS = 300_000n;
const USDC = 10n ** 6n;
/** Recipient the hacked agent tries to drain to. Never registered as an obligation recipient. */
const ATTACKER: Address = '0x000000000000000000000000000000000000bad1';
/** Anvil's public default test mnemonic (not a secret); account index 1 is the AGENT in deployment/local.json. */
const ANVIL_MNEMONIC = 'test test test test test test test test test test test junk';

type Network = 'fuji' | 'local';

interface AttemptResult {
  attempt: string;
  hash: Hex | null;
  status: 'reverted' | 'SUCCESS' | 'not sent';
  error: string;
}

function parseNetwork(argv: string[]): Network {
  const i = argv.indexOf('--network');
  const value = i >= 0 ? argv[i + 1] : 'fuji';
  if (value !== 'fuji' && value !== 'local') throw new Error(`--network must be fuji or local, got ${value}`);
  return value;
}

function loadEnv(): void {
  const file = resolve(ROOT, '.env');
  // Never overrides variables already set in the shell (e.g. by scripts/load-env.ps1).
  if (existsSync(file)) process.loadEnvFile(file);
}

const stripComment = (v: string | undefined) => v?.replace(/\s+#.*$/, '').trim() || undefined;

/** Every custom error from every contract ABI (incl. OZ ERC20/AccessControl errors), for decoding revert data. */
const ALL_ERRORS: Abi = [
  treasuryAbi,
  obligationRegistryAbi,
  policyEngineAbi,
  vaultAdapterAbi,
  mockLendingPoolAbi,
  mockUSDCAbi,
].flatMap((abi) => (abi as Abi).filter((item) => item.type === 'error'));

function findRevertData(err: unknown): Hex | undefined {
  if (!(err instanceof BaseError)) return undefined;
  const found = err.walk((e) => typeof (e as { data?: unknown }).data === 'string') as { data?: Hex } | null;
  return found?.data;
}

function describeRevert(data: Hex | undefined): string {
  if (!data || data === '0x') return 'reverted without data (no such function, no fallback/receive)';
  try {
    const { errorName, args } = decodeErrorResult({ abi: ALL_ERRORS, data });
    const shown = (args ?? []).map((a) => (typeof a === 'bigint' && a >= USDC ? `${a} (${formatUsdc(a)})` : String(a)));
    return `${errorName}(${shown.join(', ')})`;
  } catch {
    return `unknown revert ${data.slice(0, 10)}`;
  }
}

async function main(): Promise<number> {
  const network = parseNetwork(process.argv.slice(2));
  loadEnv();

  const chain = network === 'fuji' ? avalancheFuji : foundry;
  const rpcUrl = network === 'fuji' ? stripComment(process.env.FUJI_RPC_URL) : 'http://127.0.0.1:8545';
  if (!rpcUrl) throw new Error('FUJI_RPC_URL is not set (see docs/11 §4)');

  let account: Account;
  if (network === 'local') {
    account = mnemonicToAccount(ANVIL_MNEMONIC, { addressIndex: 1 });
  } else {
    const key = stripComment(process.env.AGENT_PRIVATE_KEY);
    if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error('AGENT_PRIVATE_KEY missing or malformed in .env');
    account = privateKeyToAccount(key as Hex);
  }

  const deployment = loadDeployment(JSON.parse(readFileSync(resolve(ROOT, 'deployment', `${network}.json`), 'utf8')));
  if (deployment.chainId !== chain.id) {
    throw new Error(`deployment/${network}.json is for chain ${deployment.chainId}, expected ${chain.id}`);
  }
  const treasury = deployment.contracts.Treasury;
  const adapter = deployment.contracts.VaultAdapter;
  const explorer = (stripComment(process.env.NEXT_PUBLIC_SNOWTRACE_BASE) ?? 'https://testnet.snowtrace.io').replace(/\/$/, '');
  const txUrl = (hash: Hex | null) => (hash && network === 'fuji' ? `${explorer}/tx/${hash}` : '-');

  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const wallet = createWalletClient({ account, chain, transport: http(rpcUrl) });

  const agentRole = await publicClient.readContract({ address: treasury, abi: treasuryAbi, functionName: 'AGENT_ROLE' });
  const hasRole = await publicClient.readContract({
    address: treasury,
    abi: treasuryAbi,
    functionName: 'hasRole',
    args: [agentRole, account.address],
  });
  if (!hasRole) throw new Error(`${account.address} does not hold AGENT_ROLE on Treasury ${treasury}`);

  const asset = (await publicClient.readContract({ address: treasury, abi: treasuryAbi, functionName: 'asset' })) as Address;
  const balanceOf = (who: Address) =>
    publicClient.readContract({ address: asset, abi: erc20Abi, functionName: 'balanceOf', args: [who] });

  const treasuryBefore = await balanceOf(treasury);
  const attackerBefore = await balanceOf(ATTACKER);

  console.log(`RunwayMind hacked-agent attack — ${network} (chain ${chain.id})`);
  console.log(`  agent     ${account.address} (has AGENT_ROLE)`);
  console.log(`  treasury  ${treasury}  idle ${formatUsdc(treasuryBefore)}`);
  console.log(`  attacker  ${ATTACKER}\n`);

  const attempts: { attempt: string; to: Address; data: Hex }[] = [
    {
      attempt: '1. transferFrom treasury→attacker 50,000',
      to: asset,
      data: encodeFunctionData({ abi: erc20Abi, functionName: 'transferFrom', args: [treasury, ATTACKER, 50_000n * USDC] }),
    },
    {
      attempt: '2. adapter.withdraw 50,000 direct',
      to: adapter,
      data: encodeFunctionData({ abi: vaultAdapterAbi, functionName: 'withdraw', args: [50_000n * USDC] }),
    },
    {
      attempt: '3. raw transfer selector on Treasury',
      to: treasury,
      data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [ATTACKER, 50_000n * USDC] }),
    },
    {
      attempt: '4. pay fake obligation #999',
      to: treasury,
      data: encodeFunctionData({ abi: treasuryAbi, functionName: 'pay', args: [999n] }),
    },
    {
      attempt: '5. invest 90,000 beyond reserve',
      to: treasury,
      data: encodeFunctionData({ abi: treasuryAbi, functionName: 'invest', args: [adapter, 90_000n * USDC] }),
    },
  ];

  const results: AttemptResult[] = [];
  for (const { attempt, to, data } of attempts) {
    // Decode the custom error from a pre-flight eth_call (mined receipts carry no revert data), then send anyway.
    let error = 'call succeeded (!)';
    try {
      await publicClient.call({ account, to, data });
    } catch (err) {
      error = describeRevert(findRevertData(err));
    }
    try {
      const hash = await wallet.sendTransaction({ to, data, gas: GAS });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      results.push({ attempt, hash, status: receipt.status === 'reverted' ? 'reverted' : 'SUCCESS', error });
    } catch (err) {
      results.push({ attempt, hash: null, status: 'not sent', error: `${error}; send failed: ${(err as Error).message.split('\n')[0]}` });
    }
  }

  const treasuryAfter = await balanceOf(treasury);
  const attackerAfter = await balanceOf(ATTACKER);

  for (const r of results) {
    console.log(`${r.status === 'reverted' ? 'BLOCKED' : 'FAILED '}  ${r.attempt}`);
    console.log(`         tx       ${r.hash ?? '-'}`);
    console.log(`         snowtrace ${txUrl(r.hash)}`);
    console.log(`         error    ${r.error}`);
  }

  const allReverted = results.every((r) => r.status === 'reverted');
  const treasuryUnchanged = treasuryAfter === treasuryBefore;
  const attackerUnchanged = attackerAfter === attackerBefore;
  console.log(`\nTreasury idle ${formatUsdc(treasuryBefore)} → ${formatUsdc(treasuryAfter)} ${treasuryUnchanged ? '(unchanged)' : '(CHANGED!)'}`);
  console.log(`Attacker      ${formatUsdc(attackerBefore)} → ${formatUsdc(attackerAfter)}`);
  const ok = allReverted && treasuryUnchanged && attackerUnchanged;
  console.log(ok ? '\nRESULT: all 5 attempts reverted on-chain; no funds moved.' : '\nRESULT: ATTACK NOT FULLY BLOCKED');
  return ok ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(`demo:attack failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  },
);
