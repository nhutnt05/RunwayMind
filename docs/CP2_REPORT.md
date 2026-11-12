# CP2 Report — Fuji rehearsal (D5-ALL)

> **Run 1** (deployment block 60880334, sections 1–4 below) diverged after scene 0:20 and is kept as history.
> **Run 2** (fresh deployment, section 5) is the authoritative CP2 rehearsal.

> Status: **IN PROGRESS** — scenes are filled in as they are run. A scene is only marked PASS after its numbers were
> observed (on-chain / API by the agent, on-screen by the operator). Nothing below is assumed.

## 1. Deployment

| Item | Value |
|---|---|
| Date | 2026-11-11 |
| Network | Avalanche Fuji (chain ID 43113, verified via RPC) |
| Previous deployment backup | `deployment/backup/fuji-20261111-143712-pre-cp2.json` (sha256 `0006a8f9…ad973`, identical to the pre-CP2 `fuji.json`) |
| Previous backend DB backup | `backend/prisma/runwaymind-20261111-143712-pre-cp2.db.bak` (original `runwaymind.db` untouched) |
| CP2 backend DB | `backend/prisma/runwaymind-cp2.db` (fresh: `prisma migrate deploy` + seed, `SEED_OBLIGATIONS=false`) |
| Deploy block | 60880334 |
| `demoStartTime` (T0) | 1794382804 |
| ADMIN (deployer) | `0xaC9309a1C6C150D98111AfffF851D07AD650CB5E` |
| AGENT | `0x901999461cB4ecF9d971458A6aaf4bFbEbbB0051` |
| KEEPER (no role) | `0xe052cDe7C1c7060fCE44e862FD6E60307c3649B1` |

| Contract | Address | Snowtrace |
|---|---|---|
| MockUSDC | `0x2ef65B3767c1b18eCd3647d02ee1a8bBd2B6D01e` | verified ✓ https://testnet.snowtrace.io/address/0x2ef65B3767c1b18eCd3647d02ee1a8bBd2B6D01e |
| ObligationRegistry | `0x837b79bc6f00729287D6cb5F267c291B73473175` | verified ✓ https://testnet.snowtrace.io/address/0x837b79bc6f00729287D6cb5F267c291B73473175 |
| PolicyEngine | `0xc4b05a6c0528af3a6dB59912Fa5C6AA5342937d1` | verified ✓ https://testnet.snowtrace.io/address/0xc4b05a6c0528af3a6dB59912Fa5C6AA5342937d1 |
| Treasury | `0xDBb9Ddc80FCBeacCB6588aFB04eBefb7d6795B9f` | verified ✓ https://testnet.snowtrace.io/address/0xDBb9Ddc80FCBeacCB6588aFB04eBefb7d6795B9f |
| MockLendingPool | `0x68d62FC0ed6C334B64B11b242580846c7a5894CF` | verified ✓ https://testnet.snowtrace.io/address/0x68d62FC0ed6C334B64B11b242580846c7a5894CF |
| VaultAdapter | `0xE1729AD0752E8B32F9f38D4e7907573bFef5d520` | verified ✓ https://testnet.snowtrace.io/address/0xE1729AD0752E8B32F9f38D4e7907573bFef5d520 |

`CheckRoles.s.sol`: OK (ADMIN roles on Treasury/Registry/Policy, pool owner = ADMIN, AGENT_ROLE, AGENT ≠ ADMIN,
TREASURY_ROLE held by Treasury, VaultAdapter ACTIVE, clock wired, demoMode true).

## 2. Pre-flight (docs/12 §1)

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | Fresh deployment without seeded obligations | PASS | Deploy + SeedDemo (`SEED_OBLIGATIONS=false`, no txs broadcast) |
| 2 | Idle 100,000; pool reserve 10,000; APY 8%; util 50%; shortage OFF | PASS (on-chain) | `idleBalance` 100000000000 · pool cash 10000000000 · `apyBps` 800 · `utilizationBps` 5000 · `liquidityShortage` false |
| 3 | Agent mode APPROVE, loop 10 s; keeper 15 s | PASS | `GET /agent/settings` → mode APPROVE, loopIntervalSec 10 (set by operator in Settings → Agent, B-1 fix); keeper 15 s |
| 4 | Presenter wallet = ADMIN with ≥ 1 AVAX | PENDING | ADMIN balance 0.99999 AVAX before deploy (deploy cost < 0.001) — operator wallet to confirm |
| 5 | LLM reachable | PASS (after B-2/B-4/B-6) | Real call via `createLlmProvider` (`claude-opus-5-5` through `LLM_BASE_URL` relay host `api.llmsrelay.com`): `{"ok": true}` in 2,729 ms. Real `parseObligations` dry run on the scene 0:20 text (no DB/chain writes): 3 drafts — PAYROLL 20,000,000,000 / PAYROLL 20,000,000,000 / GRANT 10,000,000,000 to RECIPIENT_PAYROLL / _2 / _GRANT, one-time, no warnings, no clarifications, 7,315 ms, 1 attempt. Due dates see B-5 |
| 6–8 | Browser tabs / terminal / recorder | operator | |

Backend: `GET /health` → chainId 43113, agent + keeper enabled. `GET /treasury/overview` → idle 100,000.00, required
10,000.00 (buffer only), runway 365+ SAFE, pool risk score 87.

## 3. Scenes (docs/12 §2)

| Scene | Expected | Actual | Result | Tx / evidence |
|---|---|---|---|---|
| 0:20 NL obligations | 3 obligations (D7/D30/D45); required 30,000; runway 365+ | NL (VI) → 3 drafts → 3 signatures (QuickNode/wallet issues B-7…B-10 resolved). On-chain: #1 20,000 → `0x2519…E4C5` due T0+7.38 d, #2 20,000 → `0x34cC…df83` due T0+30.38 d, #3 10,000 → `0x0E30…6183` due T0+45.38 d (Day 7 / 30 / 45, exact offsets B-5); `requiredReserve()` = 30,000,000,000; drafts CONFIRMED and linked to the create txs. On-screen values (required 30,000, runway 365+) not separately reported by the operator | **PASS** (on-chain + API evidence) | [0xb142d7f8…](https://testnet.snowtrace.io/tx/0xb142d7f86a4236e998eaaf925585beb4be84ef65eb9e7f0d3b7e6c4e456f184d), [0xd1fbbbf1…](https://testnet.snowtrace.io/tx/0xd1fbbbf1584126a323ff8f1d51ec9ee30f0985d6e7ecdd16fe90a2b5267d3bc9), [0xf2e07dea…](https://testnet.snowtrace.io/tx/0xf2e07dea013ad9240ea93af475e14a2ac57ebcef8009160234ce0bff3e0ef7c1) |
| 0:45 Cash Ladder + approve | Card INVEST 70,000 (reserve 30,000, APY 8.00%, score 87); idle 30,000 / vault 70,000 / efficiency 70%; timeline D16 20,000, D31 10,000 | Not run per script — deployment state diverged after 0:20 (see §3.1) | **BLOCKED**
| 1:10 APY crash | ticker +30.68 (vault 70,030.68); score 22 CRITICAL; WITHDRAW_ALL 70,030.68 → idle 100,030.68 | Not run per script — deployment state diverged after 0:20 (see §3.1) | **BLOCKED**
| 1:35 Hacked agent | 4 vectors revert; `ReserveViolation(10,030.68, 30,000)`; red "Blocked by R1"; balance unchanged | Not run per script — deployment state diverged after 0:20 (see §3.1) | **BLOCKED**
| 2:05 Payday | keeper pays #1 (+20,000) within 15 s; idle 80,030.68 | Not run per script — deployment state diverged after 0:20 (see §3.1) | **BLOCKED**
| 2:30 Stress test | 5 cards; pool lock 14 d SAFE; worst case shown | Not run per script — deployment state diverged after 0:20 (see §3.1) | **BLOCKED**
| 0:00 / 2:50 Problem / Close | slides / narrative | n/a | NOT APPLICABLE | |

### 3.1 Divergence after scene 0:20 (2026-11-11 16:53–17:08 UTC)

After the three obligations, the deployment was exercised outside the docs/12 script: manual invest 70,000 via the Vault
page (scene 0:45 requires approving the agent's recommendation card), four pool-control txs (APY now 0.25 %), three
agent WITHDRAW_ALL (`APY_BELOW_MINIMUM`, 40,000 / 20,000 / 10,000 — liquidity-capped), manual invest 60,000,
`advanceTime(+2 d)`, trip + 2 × reset breaker, manual invest 9,999.75, manual withdraw 20,000. All txs confirmed
(18 rows in the backend `Transaction` table). State at Day 2.88: idle 50,000.25, vault 50,000.75, timeOffset 172,800 s.
Because chain time is monotonic, the scripted values for 0:45–2:30 (70,000 / 70 % / 70,030.68 / score 22 /
`ReserveViolation(10,030.68, 30,000)` / 80,030.68) cannot be reproduced on this deployment. **Unblock:** fresh
deployment (`pnpm demo:reset -- --no-seed`, wipes the DB in `DATABASE_URL`) and re-run 0:20 → 2:30 strictly in order.
Cosmetic note: obligation metadata labels show the seed labels ("November payroll", "December payroll", "Q1 grant")
instead of the NL draft labels — likely from a later `db:seed` run without `SEED_OBLIGATIONS=false`.

## 4. Bugs

| ID | Found at | Description | Status |
|---|---|---|---|
| B-1 | Pre-flight #3 | Settings → Agent form had no loop-interval field, so pre-flight "loop 10 s" could not be set from the UI | FIXED (`frontend/components/settings/AgentAndDemo.tsx`), needs operator confirmation |
| B-2 | Pre-flight #5 | LLM not configured in `.env` | Operator chose option A (real LLM). `.env` now `LLM_PROVIDER=anthropic`, `LLM_MODEL=claude-opus-5-5`, key present → see B-4 |
| B-3 | Backend start | Indexer failed every poll: the Fuji RPC in `.env` is a free-tier endpoint that limits `eth_getLogs` to 10 blocks; indexer used 2,000-block chunks → no events / `accruedYield` stays null (breaks the 1:10 yield ticker) | FIXED: `INDEXER_BLOCK_RANGE` / `INDEXER_MAX_CHUNKS_PER_POLL` added to backend config (`backend/src/config.ts`, `server.ts`); CP2 backend runs with 10 / 100. Verified: 0 indexer errors, cursor advancing |
| B-3b | Backend start (security) | viem error messages embed the full RPC URL, so the provider API key (URL path) was written to the backend log | FIXED: `redactUrls` in the JSON logger (`agent/src/audit/audit.ts`, unit-tested) keeps only `scheme://host/…`; new log verified free of key paths. Old log overwritten. **Recommend rotating the RPC provider key** since it was logged locally |
| B-4 | Agent tick | LLM explanation falls back to template: Anthropic returns `401 authentication_error: invalid x-api-key` for `LLM_API_KEY` (again at 14:19Z and 14:29Z after the operator's backend restart). Format check (no value read): the key does **not** start with `sk-ant-`, so it is not an Anthropic key; the same key was rejected by OpenAI earlier (09:54Z) | OPEN. 21:44 local: operator replaced the key (now `sk-ant-…`). Direct check through `createLlmProvider` (fresh process, `claude-opus-5-5`): authentication passes, but Anthropic returns `400 invalid_request_error: credit balance is too low`. Needs API credits on the Anthropic account, then a backend restart (running backend still holds the old key). Blocks scene 0:20 NL parse; explanations use templates meanwhile |
| B-6 | Pre-flight #5 | Operator configured an Anthropic-compatible relay via `LLM_BASE_URL`, but the provider always called the official API URL | FIXED: optional `LLM_BASE_URL` (https only; unset → official API) in `agent/src/llm/provider.ts`, unit-tested with a fake fetch. **Deviation:** not in docs/11 §4 env list. Note: prompts and the key now go to a third-party relay, not Anthropic directly. B-4 resolved by the operator's new key |
| B-5 | Pre-flight #5 dry run | NL relative dates are normalized to 00:00 UTC (A-06) while T0 = 07:40 UTC, so "sau 7 / 30 / 45 ngày" land at Day 6.68 / 29.68 / 44.68 instead of Day 7 / 30 / 45. Effect: withdrawal timeline would show **Day 15 / Day 30** (expected Day 16 / Day 31) and the 1:10 explanation "due in 4 days" (expected 5). Money numbers unaffected | FIXED (operator chose exact offsets): relative phrases in the user's own text (`sau N ngày`, `N ngày nữa/tới`, `in/after N days`, `N days from now/later`) → `firstDueDate = chainTime + N × 86,400` (deterministic regex on `sourceSpan`, not LLM arithmetic); calendar dates still 00:00 UTC (A-06); draft review keeps the exact time unless the date is edited. Files: `agent/src/llm/parseObligations.ts`, `frontend/lib/insights.ts`, `frontend/components/obligations/NaturalLanguageInput.tsx`. Tests: NL exact offsets vi/en, calendar rounding, ambiguity, timeline Day 16/31 (`agent/test/cashLadder.test.ts`), `draftDueDate`. Live LLM dry run: due +7.00 / +30.00 / +45.00 d from chain time (T0 + 0.32 d → Day 7 / 30 / 45). No financial logic changed |
| B-7 | Scene 0:20 (Confirm & sign) | UI refused the prepared tx: "Prepared tx is not addressed to the ObligationRegistry". The frontend dev server's webpack cache still served the **old** `fuji.json` (old registry `0x16Aa…DAFAc`) after `sync-abi` replaced it; backend correctly used the new registry. The prepared-tx guard (`verifyRegistryTx`) did its job: nothing was signed | FIXED (no code change): touched `packages/shared/src/deployments/fuji.json` → dev server recompiled; bundle now contains only the new registry `0x837b…3175`. Runbook note: after a redeploy, restart the frontend with a clean `.next` (or touch the deployment JSON) |
| B-8 | Scene 0:20 (Confirm & sign) | NL parse OK (3 drafts, exact due times 2026-11-18 / 12-11 / 12-26 15:36 UTC), but all 3 `createObligation` signatures failed with "Request is being rate limited" (`RPC 0xa869 … eth_sendRawTransaction`). Browser RPC traffic (frontend polling on public `api.avax-test.network` + MetaMask's Fuji RPC) from one IP is throttled by the public endpoint. Verified nothing was sent: `obligationCount` 0, ADMIN nonce 35 latest = pending | OPEN — environment: operator to point MetaMask's Fuji network at a non-public RPC (or retry after the limit window) |
| B-9 | Scene 0:20 attempt 3 | `Create obligation` failed before any tx hash with "Request exceeds defined limit." Ruled out: backend prepare (draft → SUBMITTED), contract (eth_call returns id 1, estimateGas 244,802 on public RPC and Alchemy), fee methods (`eth_feeHistory` 5–100 blocks, `eth_maxPriorityFeePerGas` OK on both). Remaining suspect: the RPC configured inside the operator's MetaMask (not observable by the agent). Still no tx sent (`obligationCount` 0) | OPEN. Operator's MetaMask Fuji RPC = a second free-tier Alchemy app (key not recorded here; rotate after CP2). Probed that endpoint with every pre-send call (chainId, nonce, gasPrice, feeHistory 10–1,024, latest block, estimateGas 0x3bc42, eth_call → id 1, batch of 20): all OK, so the failing step is still unknown. Diagnostic added: write-flow errors now name the stage (prepare / simulation / wallet / receipt) and include the provider's `details`, with URLs redacted (`frontend/lib/preparedTx.ts`, both write hooks, unit test) |
| B-9 (cont.) | Scene 0:20 attempt 4 | Stage diagnostic: **Wallet / wallet RPC** — MetaMask signed but its broadcast `eth_sendRawTransaction` got "RPC endpoint returned HTTP client error" (4xx). Verified: no tx landed (`obligationCount` 0, ADMIN nonce latest 35 = pending 35). The same Alchemy endpoint answers `eth_sendRawTransaction` with normal JSON-RPC (HTTP 200) from the agent, also with MetaMask's extension Origin → most likely per-client throttling (429) of the wallet's broadcast. App/contract/backend not at fault | OPEN — wallet environment; operator to use the docs/12 §6 fallback (Core Wallet) or a different wallet RPC |
| B-10 | Scene 0:20 (wallet RPC) | Operator added a QuickNode Fuji endpoint (token-authenticated; URL without token → HTTP 401). Agent test with token (token not recorded): chainId 0xa869, nonce, feeHistory, estimateGas 0x3bc42, eth_call → id 1, `eth_sendRawTransaction` → normal JSON-RPC (HTTP 200), burst of 15 parallel requests all HTTP 200; `eth_getLogs` limited to **5 blocks** (HTTP 413). Set as `FUJI_RPC_URL_FALLBACK`; backend restarted on the CP2 DB with `INDEXER_BLOCK_RANGE=5`; frontend restarted from a clean `.next` (bundle: new registry only). **Rotate the QuickNode token and the Alchemy keys after CP2** (they were shared in chat) | Operator to set the QuickNode URL (with token) as MetaMask's Fuji RPC and retry |


## 5. Run 2 — fresh deployment (2026-11-12)

### 5.1 Reset

| Item | Value |
|---|---|
| Command | `pnpm demo:reset -- --no-seed --verify` (operator-confirmed after dry run) — 154.6 s, within the 5-min budget |
| Backups (pre-reset) | CP2 DB snapshot `backend/prisma/backup/runwaymind-cp2-20261112-141621-pre-reset.db` (`VACUUM INTO`; row counts equal to live in 9 tables; `PRAGMA integrity_check` = ok) · `deployment/backup/fuji-20261112-141621-pre-cp2-reset.json` (sha256 = original) · script backup `deployment/backup/fuji-20261112-073841-pre-reset.json` · Run 1 backup `fuji-20261111-143712-pre-cp2.json` kept |
| DB reset | `backend/prisma/runwaymind-cp2.db` only (`prisma migrate reset --force`), seeded with TreasuryConfig `fuji-musdc` (primary) + `fuji-usdc`, no obligations; `runwaymind.db` untouched |
| Deploy block / T0 | 60935515 / `demoStartTime` 1794469257 |
| Verification | All 6 contracts `Pass - Verified` |

| Contract | Address |
|---|---|
| Treasury | [`0xea19CD2eE794e29c977f85d867BF730Cf65eab92`](https://testnet.snowtrace.io/address/0xea19CD2eE794e29c977f85d867BF730Cf65eab92) |
| ObligationRegistry | [`0x4B0e94ECCf64175385374F091c1A424c9543FA36`](https://testnet.snowtrace.io/address/0x4B0e94ECCf64175385374F091c1A424c9543FA36) |
| PolicyEngine | [`0xa862F86092Aa6625A771f964cDAaa50a36BbFA53`](https://testnet.snowtrace.io/address/0xa862F86092Aa6625A771f964cDAaa50a36BbFA53) |
| VaultAdapter | [`0x31762954AdDD4FbAB318B9Ac375083434BA01d66`](https://testnet.snowtrace.io/address/0x31762954AdDD4FbAB318B9Ac375083434BA01d66) |
| MockLendingPool | [`0x7300607b351A7D0295b81A798264b35B54d91fDa`](https://testnet.snowtrace.io/address/0x7300607b351A7D0295b81A798264b35B54d91fDa) |
| MockUSDC | [`0x561c9B3C8532C577a4b65D0b1E881FB485e58B50`](https://testnet.snowtrace.io/address/0x561c9B3C8532C577a4b65D0b1E881FB485e58B50) |

### 5.2 Pre-flight (on-chain, after reset)

| Check | Result |
|---|---|
| Idle 100,000; pool reserve 10,000; APY 8 %; util 50 %; shortage off; breaker off; timeOffset 0; 0 obligations; requiredReserve 10,000 (buffer) | PASS (on-chain reads) |
| CheckRoles (ADMIN roles, pool owner, AGENT_ROLE, AGENT ≠ ADMIN, TREASURY_ROLE, adapter ACTIVE, clock wired, demoMode) | PASS |
| Agent mode APPROVE, loop 10 s | PASS — `GET /agent/settings`: APPROVE, loopIntervalSec 10 (set by operator) |
| LLM | PASS earlier (relay); re-checked at scene 0:20 |

### 5.3 Scenes (Run 2)

| Scene | Expected | Actual | Result | Evidence |
|---|---|---|---|---|
| 0:20 NL obligations | 3 obligations D7/D30/D45; required 30,000; runway 365+ | NL (VI) → 3 drafts (CONFIRMED, linked) → 3 ADMIN signatures. On-chain: #1 20,000 → `0x2519…E4C5` due Day 7.01, #2 20,000 → `0x34cC…df83` due Day 30.01, #3 10,000 → `0x0E30…6183` due Day 45.01; `requiredReserve()` 30,000,000,000; idle 100,000 (no other actions); `GET /runway` baseline 365 capped SAFE. Pre-flight: agent APPROVE, loop 10 s | **PASS** | [0x037e5bff…](https://testnet.snowtrace.io/tx/0x037e5bff9590250e73d8669df306926e959cc3825ac8d180021c744cfa2e7ea6), [0xc9a20cde…](https://testnet.snowtrace.io/tx/0xc9a20cde4c9eadf95be854b5a75867f80bf5f0b8811051652a47bbb073b51e23), [0xfbc1a08e…](https://testnet.snowtrace.io/tx/0xfbc1a08ef70c1dacdf45b7afbf0ee86aa708ba24444a471e38d986e2633ad8c3) |
| 0:45 Cash Ladder + approve | INVEST 70,000 card (reserve 30,000, APY 8.00 %, score 87); idle 30,000 / vault 70,000 / efficiency 70 %; timeline D16 20,000, D31 10,000 | Card (LLM explanation, re-proposed after the pre-obligation card expired): "Invest 70000.00 idle surplus into Mock Lending Pool (mUSDC)", facts required 30,000.00 / investable 70,000.00 / APY 8.00 / risk 87. Approved by ADMIN `0xaC93…CB5E` → EXECUTED by AGENT. After: idle 30,000.00, vault 70,000.01 (interest since invest), actual efficiency 7000 bps = 70 %, plan 70 %; withdrawal schedule Day 16 20,000.00 + Day 31 10,000.00; pool score 93 (docs/06 §4.3 post-invest) | **PASS** | [0x246f4a16…](https://testnet.snowtrace.io/tx/0x246f4a16c928cbac60c23f8544bdecf0225493a9bf680c69389b6e014ba28ea7) (`invest`, CONFIRMED) |
| 1:10 APY crash | +2 d → ticker +30.68 (vault 70,030.68); APY 1 %, util 98 % → score 22 CRITICAL; WITHDRAW_ALL 70,030.68 → idle 100,030.68 | **Time advanced +3 d, not +2 d** (two `advanceTime` txs: +1 d then +2 d; timeOffset 259,200) → vault **70,046.08**. APY 8 % → 1 %, util 50 % → 98 %. Risk logger (5 s): 93 → 66 WATCH → **22 CRITICAL at 08:06:48 UTC (U 12, V 12.5, T 63.42)**. Cards: WITHDRAW_ALL (POOL_RISK_CRITICAL, then APY_BELOW_MINIMUM) and TRIP_CIRCUIT_BREAKER (P2b). Operator continued on Day 3: WITHDRAW_ALL **70,046.087132** approved by ADMIN → EXECUTED; dust WITHDRAW_ALL 0.000955 (interest accrued during execution) also executed; breaker card approved but SUPERSEDED by the executor's staleness check (pool no longer critical) → **breaker stays false on-chain**. After: idle **100,046.088087**, vault 0, required 30,000 | **PARTIAL** — score 22 CRITICAL **PASS**; WITHDRAW_ALL flow **PASS**; vault 70,030.68 / idle 100,030.68 **FAIL** (+1 extra day of interest: operator advanced 3 days) | [advance +1 d](https://testnet.snowtrace.io/tx/0x2152b38f9150de65312d741bc29691378eb8da4e562ca129b7a0a520b71d222a), [advance +2 d](https://testnet.snowtrace.io/tx/0x4e7bd507e7b35f5929df26d1549c1116b30837746e99e3e90c23948da9ab77cf), [setAPY](https://testnet.snowtrace.io/tx/0xd5d1fa1435fe4df5b9035a6c9d45c6e63cb9ce4d2cdbe202151fdb9ccd93c637), [setUtilization](https://testnet.snowtrace.io/tx/0x39baf9f7ad088cfa65e4c87d254eaa2718d09756f28ef1f4ca72d060fcf398ea), [withdraw 70,046.09](https://testnet.snowtrace.io/tx/0xdfe433440e71b01952b26324d1e06cdab1c596b45ea430dc271fd3fabebd5992), [withdraw dust](https://testnet.snowtrace.io/tx/0x2e74ba2c254a7442aa32d24fc67de37dcabdf2e6f6c9e4f7ac441b2d6e36a4df) |
| 1:35 Hacked agent | 4 vectors revert; `ReserveViolation(10,030.68, 30,000)`; balance unchanged — adjusted for Day 3: `ReserveViolation(10,046.088087, 30,000)` | `pnpm demo:attack` (operator, AGENT key): all 5 txs mined with **status 0** from AGENT `0x9019…0051` (verified by the agent on the public RPC): (1) transferFrom → `ERC20InsufficientAllowance`; (2) adapter.withdraw → `NotTreasury`; (3) raw `transfer` on Treasury → no data (no function / fallback); (4) pay(999) → `UnknownObligation(999)`; (5) invest 90,000 → **`ReserveViolation(10,046,088,087, 30,000,000,000)`** (replayed eth_call: selector `0x0036875f` = ReserveViolation, args 10,046.088087 / 30,000). Treasury idle 100,046.088087 → unchanged; attacker 0; breaker false. Note: docs/12 also mentions a red "Blocked by R1" row in Agent Activity — raw attack txs are not agent decisions, so they appear on Snowtrace, not in the activity timeline (open question since D4) | **PASS** (security behaviour) — idle-after value 10,046.09 vs docs 10,030.68 differs only by the +1 day from 1:10 | [1](https://testnet.snowtrace.io/tx/0x89e41d6f6bece222c5d92b7c47f8a432fc75aa58208575eb3a41e61a7e0730a2) [2](https://testnet.snowtrace.io/tx/0x4210007659833e92b76defa6ea7aa29c26613213e80d32a15a030687466e42c6) [3](https://testnet.snowtrace.io/tx/0xee44d9094c5910603c1cf7529d758fb5d04f9c7920efb2ac07ef131d44562181) [4](https://testnet.snowtrace.io/tx/0x41f5fd91138142515f59c928b922a8644f849ee0b110741c8c122ce37d07474b) [5](https://testnet.snowtrace.io/tx/0x0d7776ba98d5ba2c620347b25b06826764bb42ba3f4349ae81831c6735972dff) |
| 2:05 Payday | +5 d → keeper pays #1 (+20,000) within 15 s; idle 80,030.68 — adjusted for Day 3: +4 d to Day 7; idle ≈ 80,046.09 | One `advanceTime(+4 d)` (offset 259,200 → 604,800; chain Day 7.03), confirmed 08:16:29.4 UTC. KEEPER `0xe052…49B1` (no role) sent `pay(1)` at 08:16:34.2 (**≈ 5 s later**), confirmed 08:16:35.7. Event `ObligationPaid(id 1, recipient 0x2519…E4C5, 20,000, occurrence 1, caller KEEPER, pulled 0)`; obligation #1 COMPLETED (paidOccurrences 1); recipient balance 20,000. After: idle **80,046.088087**, required 10,000, vault 0; upcoming list → #2 Lương tháng 12 Day 30.01, #3 Grant Day 45.01; runway 365+ SAFE | **PASS** (keeper payment, timing, recipient +20,000, required 10,000) — idle 80,046.09 vs docs 80,030.68 differs only by the +1 day from 1:10 | [advance +4 d](https://testnet.snowtrace.io/tx/0xa6980be389ae32c0d11775ef7f81bb42d7933eeb01fb1a2c7278c5a57ef6e415), [keeper pay(1)](https://testnet.snowtrace.io/tx/0x1b1af81f795e94efe49e882d5d279cd1617c6fb5975bcb1316438dbc56b7506c) |
| 2:30 Stress test | 5 cards; pool lock 14 d SAFE; worst case shown | Run `st_742bcda1bd634e5ab319477b668dca30` by ADMIN at 08:20:19 UTC (chain Day 7.03, persisted `StressTestRun`): baseline + 4 scenarios; **POOL_LOCK_14D 365+ SAFE, no failure** (payroll fully paid); worst case APY_DROP_50 (all scenarios tie at 365+ SAFE → fixed-order tie-break), overall SAFE. Cross-check vs on-chain state (idle 80,046.09, vault 0, remaining 20,000 @ Day 30 + 10,000 @ Day 45): min idle 50,046.09 = 80,046.09 − 30,000 ✓; EXPENSE_PLUS_20 44,046.09 = 80,046.09 − 36,000 ✓; yield 0 (empty vault) ✓; INFLOW_DELAY_30D "No expected inflows registered" | **PASS** | backend `StressTestRun` row; `GET /stress-tests/st_742bcda1…` |

### 5.4 Bugs found in Run 2

| ID | Found at | Description | Status |
|---|---|---|---|
| B-13 | Scene 1:10 (minor) | After WITHDRAW_ALL, interest accrued between the decision and execution left 0.000955 USDC in the adapter; the agent proposed a second WITHDRAW_ALL for that dust (P3 does not apply `minActionAmount`) | OPEN — cosmetic; consider a dust threshold for withdraw rules |
| B-12 | Scene 1:10 | Recommendation cards showed "expired" and hid Approve/Reject right after time travel: the frontend compared `expiresAt` (wall-clock TTL set and enforced by the backend, `approval.ts`) with **chain time** (+3 days after `advanceTime`) | FIXED: `RecommendationCard` takes wall-clock `nowSec` (ticking every second in `RecommendationList`); chain time still used for all financial/date displays. Regression test added (frontend 73/73) |

### 5.5 Run 2 result

| Gate value (docs/12 §3, D5-ALL) | Expected | Actual (Run 2) | Result |
|---|---|---|---|
| Required reserve after obligations | 30,000 | 30,000.00 (`requiredReserve()`) | ✅ PASS |
| Invested at Day 0 | 70,000 | 70,000.00 (`invest` tx `0x246f4a16…`) | ✅ PASS |
| Efficiency after invest | 70 % | 7000 bps actual / 7000 plan | ✅ PASS |
| Vault at Day 2 | 70,030.68 | 70,046.08 at Day 3.02 | ❌ FAIL — operator advanced **+3 days** (+1 d then +2 d); difference = one extra day of 8 % interest |
| Pool score after crash | 22 CRITICAL | 22 CRITICAL (U 12, V 12.5, T 63.42) at 08:06:48 UTC | ✅ PASS |
| Hacked invest 90,000 | `ReserveViolation(10,030.68, 30,000)` | `ReserveViolation(10,046.088087, 30,000)`; all 5 attacks reverted on-chain, no funds moved | ⚠️ behaviour PASS, value FAIL (same +1 day) |
| Idle after payday | 80,030.68 | 80,046.088087 (keeper paid #1 ≈ 5 s after Day 7) | ⚠️ behaviour PASS, value FAIL (same +1 day) |

**Verdict:** every scene's behaviour works end-to-end on Fuji (NL → approve → crash & risk response → hacked agent
blocked by R1 → keeper payday → stress test), but the **CP2 gate is not met as written**: 3 of 7 exact values are off by
exactly one day of interest (+15.40 USDC) because time was advanced 3 days in scene 1:10. No data was altered.

**To meet the gate exactly:** another `pnpm demo:reset -- --no-seed --verify` run with scene 1:10 advancing **once by 2 days**.
Even then the vault will read ≈ 70,030.7x rather than 70,030.68 — interest accrues in real time between the invest
(scene 0:45) and the time jump (≈ 0.0107 USDC per minute), so 70,030.68 is only reachable if the jump happens within a
few seconds of the invest. The gate figure should be read as "70,000 × 8 % × 2/365 + real-time accrual".

Evidence files: `docs/cp2-evidence/run2-pool-risk-transitions.json` (pool score transitions from a 5-second logger of
`GET /pools/:adapter/risk` and `GET /treasury/overview`); all transaction hashes link to Snowtrace above.
