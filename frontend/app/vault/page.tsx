import { EmptyState, PageHeader } from '@/components/ui';

export default function VaultPage() {
  return (
    <>
      <PageHeader title="Yield Vault" description="Adapter balances, APY, liquidity and manual invest / withdraw." />
      <EmptyState title="No yield vaults" description="Whitelisted adapters appear here after deployment." />
    </>
  );
}
