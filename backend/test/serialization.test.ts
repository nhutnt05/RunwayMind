// D7-B1: no amount is ever serialized as a JSON number (docs/07 §2.2 bigint → string rule, docs/10 §5).
// Boots the real app (fake chain, fake executor / keeper, mock LLM), seeds data through the API, calls EVERY
// registered route (enumerated from the OpenAPI spec, so a new route without a case here fails the test) and walks
// each JSON body: a number under an amount-like key, or any number outside the safe-integer range, fails.
import { randomUUID } from 'node:crypto';
import { encodeAbiParameters, encodeEventTopics, getAddress, type Abi, type Hex, type Log, type PublicClient } from 'viem';
import { generatePrivateKey, privateKeyToAccount, type LocalAccount } from 'viem/accounts';
import { createSiweMessage } from 'viem/siwe';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createAgentLoop, type LlmProvider } from '@runwaymind/agent';
import { treasuryAbi } from '@runwaymind/shared/abi';
import { createScheduler } from '../src/scheduler';
import { ADAPTER, DAY, FakeChain, T0, USDC, makeApp, prisma, resetDb } from './helpers';

const API = '/api/v1';
const admin = privateKeyToAccount(generatePrivateKey());
const viewer = privateKeyToAccount(generatePrivateKey());
const R1 = '0x0000000000000000000000000000000000000001';

/** Keys whose value is a token amount (base units) — must be a string (or null), never a JSON number. */
const AMOUNT_KEY =
  /amount|idle|balance|total|reserve|shortfall|investable|capital|yield|liquidity|tvl|buffer|deficit|surplus|principal|payments?$|withdrawals?$|withdrawn|inflows?$|outflows?$|needed|available|deposit|cash|minAction|value$|gas/i;
/** Amount-looking keys that are actually ratios, counts or times. */
const NOT_AMOUNT = /bps|days|count|index|time|date|sec$|ms$|at$|percent|score|occurrences|decimals|number$|chainId|interval|horizon|^id$|attempt|limit|band/i;

/** Sub-objects holding Pool Risk sub-scores / weights (docs/06 §4.1: 0–100 scores keyed `utilization`, `tvl`, …). */
const SCORE_OBJECT = /^(components|weights)$/;

function findAmountNumbers(value: unknown, path = '$', parentKey = '', inScores = false): string[] {
  const out: string[] = [];
  const isAmountKey = (k: string) => !inScores && AMOUNT_KEY.test(k) && !NOT_AMOUNT.test(k);
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) {
      out.push(`${path} = ${value} (unsafe number)`);
    } else if (isAmountKey(parentKey)) {
      out.push(`${path} = ${value} (amount as JSON number)`);
    }
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => out.push(...findAmountNumbers(v, `${path}[${i}]`, parentKey, inScores)));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.push(...findAmountNumbers(v, `${path}.${k}`, k, inScores || SCORE_OBJECT.test(k)));
    }
  }
  return out;
}

describe('findAmountNumbers (the scanner itself)', () => {
  it('flags amounts as numbers, nested and in arrays; ignores bps / days / times / strings', () => {
    expect(findAmountNumbers({ idle: '1', capitalEfficiencyBps: 7000, runwayDays: 365, chainTime: T0, amount: null })).toEqual([]);
    expect(findAmountNumbers({ a: { requiredReserve: 30_000_000_000 } })).toEqual(['$.a.requiredReserve = 30000000000 (amount as JSON number)']);
    expect(findAmountNumbers({ rows: [{ withdrawAmount: 5 }] })).toHaveLength(1);
    expect(findAmountNumbers({ balances: [1, 2] })).toHaveLength(2);
    expect(findAmountNumbers({ x: 2 ** 60 })).toEqual([`$.x = ${2 ** 60} (unsafe number)`]);
    expect(findAmountNumbers({ shortfallBefore: 1.5, emergencyBuffer: 0, minActionAmount: 1 })).toHaveLength(3);
    expect(findAmountNumbers({ risk: { components: { tvl: 33.33 }, weights: { tvl: 0.2 } } })).toEqual([]);
    expect(findAmountNumbers({ risk: { components: { tvl: 2 ** 60 } } })).toHaveLength(1);
  });
});

const demoLlm = (): LlmProvider => ({
  name: 'mock',
  completeJson: async () =>
    JSON.stringify({
      obligations: [
        {
          label: 'Grant',
          category: 'GRANT',
          recipient: R1,
          amount: '10000',
          currency: 'USDC',
          firstDueDate: new Date((T0 + 45 * DAY) * 1000).toISOString().slice(0, 10),
          recurrence: { type: 'NONE', everyNDays: null, occurrences: null },
          sourceSpan: 'grant 10k',
        },
      ],
      needsClarification: [],
    }),
});

function investedLog(txHash: Hex, chain: FakeChain): Log {
  const args = { adapter: getAddress(ADAPTER), amount: USDC(50_000), caller: getAddress(admin.address), idleAfter: USDC(50_000) };
  const topics = encodeEventTopics({ abi: treasuryAbi as Abi, eventName: 'Invested', args } as never);
  return {
    address: chain.addresses.treasury,
    topics: topics as [Hex, ...Hex[]],
    data: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [args.amount, args.idleAfter]),
    blockNumber: 200n,
    transactionHash: txHash,
    logIndex: 0,
    blockHash: `0x${'9'.padStart(64, '0')}`,
    transactionIndex: 0,
    removed: false,
  } as Log;
}

async function setup() {
  const chain = new FakeChain();
  chain.admins.add(admin.address);
  const built = await makeApp(chain, undefined, {
    llm: { provider: demoLlm(), timeoutMs: 1_000 },
    flags: { agentEnabled: true, keeperEnabled: true, llmEnabled: true },
    receiptTimeoutMs: 50,
    scheduler: (c) => {
      const executor = {
        address: admin.address,
        enqueue: async (id: string) => c.store.transitionDecision(id, ['APPROVED'], { status: 'EXECUTED' }),
      };
      return createScheduler({
        loop: createAgentLoop({
          client: {} as PublicClient,
          addresses: chain.addresses,
          store: c.store,
          audit: c.audit,
          executor,
          readSnapshot: async () => ({ ...chain.snapshot, snapshotId: `snap_${randomUUID()}` }),
        }),
        executor,
        keeper: {
          address: viewer.address,
          tick: async () => ({
            id: 'kr_serial',
            chainTime: chain.snapshot.chainTime,
            shortfallBefore: USDC(5_000),
            enforced: true,
            paidIds: [1n],
            txHashes: ['0xabc'],
            errors: [{ step: 'pay' as const, obligationId: '2', error: { name: 'InsufficientLiquidity', args: { needed: '20000000000', available: '0' } } }],
            startedAt: new Date(),
            finishedAt: new Date(),
          }),
        },
        indexer: null,
        getSettings: () => c.repos.agentSettings(),
        getBalance: async () => 2n * 10n ** 18n,
      });
    },
  });
  return { ...built, chain };
}

describe('no amount is ever a JSON number — every API route (docs/07 §2.2)', () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it('scans the response of every registered route', async () => {
    const { app, chain, store } = await setup();
    const covered = new Set<string>();
    const problems: string[] = [];
    let amountStrings = 0; // sanity: the scan must actually see amounts (as base-unit strings)

    async function call(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', route: string, url: string, opts: { cookie?: string; payload?: unknown; status?: number } = {}) {
      const res = await app.inject({
        method,
        url: `${API}${url}`,
        ...(opts.cookie ? { headers: { cookie: opts.cookie } } : {}),
        ...(opts.payload !== undefined ? { payload: opts.payload as object } : {}),
      });
      expect(res.statusCode, `${method} ${url}: ${res.body}`).toBe(opts.status ?? 200);
      covered.add(`${method} ${route}`);
      const body = res.json();
      problems.push(...findAmountNumbers(body, `${method} ${url}`));
      amountStrings += res.body.match(/"\w*(?:amount|Amount|idle|Reserve|balance|Balance|shortfall|Buffer)\w*":"\d+"/g)?.length ?? 0;
      return body;
    }

    async function login(a: LocalAccount) {
      const { data } = await call('POST', '/auth/nonce', '/auth/nonce');
      const message = createSiweMessage({ address: a.address, chainId: 43113, domain: 'localhost:3000', nonce: data.nonce, uri: 'http://localhost:3000', version: '1' });
      const res = await app.inject({ method: 'POST', url: `${API}/auth/verify`, payload: { message, signature: await a.signMessage({ message }) } });
      expect(res.statusCode).toBe(200);
      covered.add('POST /auth/verify');
      problems.push(...findAmountNumbers(res.json(), 'POST /auth/verify'));
      const raw = res.headers['set-cookie'];
      return String(Array.isArray(raw) ? raw[0] : raw).split(';')[0]!;
    }

    const adminCookie = await login(admin);
    const viewerCookie = await login(viewer);
    await call('GET', '/auth/me', '/auth/me', { cookie: adminCookie });

    // reads over the SRC snapshot
    await call('GET', '/health', '/health');
    await call('GET', '/treasuries', '/treasuries');
    await call('GET', '/treasury/overview', '/treasury/overview');
    await call('GET', '/obligations', '/obligations');
    await call('GET', '/obligations/{id}', '/obligations/1');
    await call('GET', '/cash-ladder', '/cash-ladder?includeYield=true');
    await call('GET', '/cash-ladder/withdrawal-schedule', '/cash-ladder/withdrawal-schedule');
    await call('GET', '/pools', '/pools');
    await call('GET', '/pools/{adapter}', `/pools/${ADAPTER}`);
    await call('GET', '/pools/{adapter}/risk', `/pools/${ADAPTER}/risk`);
    await call('GET', '/runway', '/runway');

    // stress tests + inflows
    const stress = await call('POST', '/stress-tests', '/stress-tests', { cookie: viewerCookie, payload: {} });
    await call('GET', '/stress-tests', '/stress-tests');
    await call('GET', '/stress-tests/{id}', `/stress-tests/${stress.data.id}`);
    const inflow = await call('POST', '/inflows', '/inflows', { cookie: adminCookie, payload: { label: 'Grant tranche', amount: '15000000000', expectedDate: T0 + 20 * DAY } });
    await call('GET', '/inflows', '/inflows');

    // obligation writes (prepared ADMIN transactions) + NL parse
    await call('POST', '/obligations/parse', '/obligations/parse', { cookie: adminCookie, payload: { text: `grant 10k cho ${R1} sau 45 ngày`, locale: 'vi' } });
    const created = await call('POST', '/obligations', '/obligations', {
      cookie: adminCookie,
      payload: { label: 'December payroll', category: 'PAYROLL', recipient: R1, amount: '20000000000', firstDueDate: T0 + 30 * DAY, interval: 0, maxOccurrences: 1 },
    });
    await call('PATCH', '/obligations/{id}', '/obligations/1', { cookie: adminCookie, payload: { amount: '25000000000' } });
    await call('POST', '/obligations/{id}/cancel', '/obligations/2/cancel', { cookie: adminCookie });

    // agent: evaluate → approve; a second decision is rejected
    const evaluated = await call('POST', '/agent/evaluate', '/agent/evaluate', { cookie: adminCookie });
    const decisionId = evaluated.data.decisions[0].id as string;
    await call('GET', '/recommendations', '/recommendations');
    await call('GET', '/recommendations/{id}', `/recommendations/${decisionId}`);
    await call('POST', '/recommendations/{id}/approve', `/recommendations/${decisionId}/approve`, { cookie: adminCookie });
    const pending = await store.createDecision({
      snapshotId: 'snap',
      action: 'WITHDRAW',
      adapter: ADAPTER,
      amount: USDC(20_000),
      reasonCode: 'MANUAL',
      status: 'PENDING_APPROVAL',
      mode: 'APPROVE',
      facts: { amount: '20000' } as never,
      explanation: null,
      expiresAt: new Date(Date.now() + 600_000),
    });
    await call('POST', '/recommendations/{id}/reject', `/recommendations/${pending.id}/reject`, { cookie: adminCookie, payload: { reason: 'not now' } });
    await call('GET', '/agent/settings', '/agent/settings');
    await call('PUT', '/agent/settings', '/agent/settings', { cookie: adminCookie, payload: { minActionAmount: '2000000000' } });

    // keeper (fake tick with bigint shortfall / ids)
    await call('POST', '/keeper/run', '/keeper/run', { cookie: adminCookie });
    await call('GET', '/keeper/status', '/keeper/status');

    // vault, policy, demo
    await call('POST', '/vault/withdrawals', '/vault/withdrawals', { cookie: adminCookie, payload: { adapter: ADAPTER, amount: '20000000000' } });
    await call('POST', '/vault/investments', '/vault/investments', { cookie: adminCookie, payload: { adapter: ADAPTER, amount: '50000000000', executeVia: 'ADMIN_WALLET' } });
    await call('POST', '/policy/prepare', '/policy/prepare', { cookie: adminCookie, payload: { fn: 'setEmergencyBuffer', args: ['5000000000'] } });
    await call('POST', '/demo/prepare', '/demo/prepare', { cookie: adminCookie, payload: { fn: 'advanceTime', args: [2 * DAY] } });

    // transactions: register one with an Invested receipt (decoded event amounts)
    const txHash = `0x${'c1'.padStart(64, '0')}` as Hex;
    chain.receipts.set(txHash, { status: 'success', blockNumber: 200n, from: admin.address, logs: [investedLog(txHash, chain)] });
    await call('POST', '/transactions', '/transactions', { cookie: adminCookie, payload: { txHash, kind: 'INVEST', relatedDraftId: created.data.draftId } });
    await expect.poll(async () => (await app.inject({ method: 'GET', url: `${API}/transactions/${txHash}` })).json().data?.status).toBe('CONFIRMED');
    await call('GET', '/transactions', '/transactions');
    await call('GET', '/transactions/{hash}', `/transactions/${txHash}`);
    await call('GET', '/agent/activity', '/agent/activity');
    const logs = await call('GET', '/audit-logs', '/audit-logs?limit=100');
    expect((logs.data as unknown[]).length).toBeGreaterThan(5);

    await call('DELETE', '/inflows/{id}', `/inflows/${inflow.data.id}`, { cookie: adminCookie });
    await call('POST', '/auth/logout', '/auth/logout', { cookie: viewerCookie });

    // Error envelopes too (bodies carry decoded revert args).
    chain.simulation = { ok: false, error: { name: 'ReserveViolation', args: { idleAfter: '10000000000', requiredReserve: '30000000000' } }, message: 'reverted' } as never;
    const blocked = await app.inject({ method: 'POST', url: `${API}/vault/investments`, headers: { cookie: adminCookie }, payload: { adapter: ADAPTER, amount: '90000000000' } });
    problems.push(...findAmountNumbers(blocked.json(), 'POST /vault/investments (blocked)'));

    expect(problems).toEqual([]);
    expect(amountStrings).toBeGreaterThan(50);

    // Every route in the OpenAPI spec must have been exercised above (new routes cannot be silently skipped).
    const spec = (await app.inject({ method: 'GET', url: `${API}/docs/json` })).json() as { paths: Record<string, Record<string, unknown>> };
    const registered = new Set<string>();
    for (const [path, methods] of Object.entries(spec.paths)) {
      const route = path.startsWith(API) ? path.slice(API.length) : path;
      for (const m of Object.keys(methods)) if (m !== 'parameters') registered.add(`${m.toUpperCase()} ${route}`);
    }
    const ALLOWLIST = new Set<string>([]); // routes intentionally not scanned (none)
    expect([...registered].filter((r) => !ALLOWLIST.has(r)).sort()).toEqual([...covered].sort());
    expect(registered.size).toBeGreaterThanOrEqual(40);
  });
});
