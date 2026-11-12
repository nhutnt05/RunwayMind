// Public runtime configuration (docs/11 §4, NEXT_PUBLIC_* only).
// Next.js inlines NEXT_PUBLIC_* at build time, so each variable must be referenced literally.
export const FUJI_CHAIN_ID = 43113 as const;

export const publicEnv = {
  chainId: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? FUJI_CHAIN_ID),
  fujiRpcUrl: process.env.NEXT_PUBLIC_FUJI_RPC_URL ?? 'https://api.avax-test.network/ext/bc/C/rpc',
  apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api/v1',
  walletConnectProjectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? '',
  snowtraceBase: process.env.NEXT_PUBLIC_SNOWTRACE_BASE ?? 'https://testnet.snowtrace.io',
  /** Playwright E2E only (docs/10 §6): wagmi mock connector on Anvil. Never set in normal builds. */
  e2e: process.env.NEXT_PUBLIC_E2E === 'true',
} as const;
