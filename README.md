# RunwayMind — AI CFO for DAOs

*The Treasury That Never Runs Out of Cash. The AI That Never Exceeds Its Authority.*

RunwayMind manages a DAO's stablecoin treasury based on its **future obligations** (payroll, grants, invoices). It invests only capital that is genuinely idle within the safety horizon, and smart contracts enforce every limit the AI agent works within. Built for Team1 Vietnam UniHack 2026 (Avalanche, track: AI Agents & Security). Full specification: [docs/](docs/README.md).

## Deployed contracts — Avalanche Fuji (chain ID 43113)

Deployed at block `60869633` with demo mode on. Every contract is verified on Snowtrace. Machine-readable copy: [deployment/fuji.json](deployment/fuji.json).

| Contract | Address | Snowtrace |
|---|---|---|
| Treasury | `0xDaa7ed64Eb3eDbb74D193a92AACe7d7208e6eaf6` | [view](https://testnet.snowtrace.io/address/0xDaa7ed64Eb3eDbb74D193a92AACe7d7208e6eaf6) |
| ObligationRegistry | `0x16Aa744F1f39a6376da466AEB9c53b6EC55DAFAc` | [view](https://testnet.snowtrace.io/address/0x16Aa744F1f39a6376da466AEB9c53b6EC55DAFAc) |
| PolicyEngine | `0x1d4f763cCD2aEfC90B1Dc2f31A08c0e6e6A1BEc8` | [view](https://testnet.snowtrace.io/address/0x1d4f763cCD2aEfC90B1Dc2f31A08c0e6e6A1BEc8) |
| VaultAdapter | `0xABcD4CCfBa283635c1209ceee5F78b5E73BdEda1` | [view](https://testnet.snowtrace.io/address/0xABcD4CCfBa283635c1209ceee5F78b5E73BdEda1) |
| MockLendingPool | `0xD5C180C1f9844Fe94E101127803eC98f875Cba47` | [view](https://testnet.snowtrace.io/address/0xD5C180C1f9844Fe94E101127803eC98f875Cba47) |
| MockUSDC (mUSDC, 6 decimals) | `0xa676b3a18947eCCa4A9FA0022685E0B395D3c203` | [view](https://testnet.snowtrace.io/address/0xa676b3a18947eCCa4A9FA0022685E0B395D3c203) |

| Role | Address |
|---|---|
| ADMIN (deployer) | `0xaC9309a1C6C150D98111AfffF851D07AD650CB5E` |
| AGENT | `0x901999461cB4ecF9d971458A6aaf4bFbEbbB0051` |

## Quick start

Requirements: Node ≥ 20, pnpm, Foundry.

```powershell
pnpm install
pnpm build              # forge build + all workspace packages
pnpm test               # forge test + all workspace tests
pnpm dev                # backend + frontend in watch mode
```