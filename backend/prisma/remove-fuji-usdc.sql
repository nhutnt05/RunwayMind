-- One-off cleanup (2026-11-14, DEC-USDC-1): removes the real-USDC treasury `fuji-usdc` and all of its rows from the
-- backend database. The mUSDC treasury (`fuji-musdc`) is untouched. Run with the backend STOPPED:
--   pnpm --filter @runwaymind/backend exec prisma db execute --file prisma/remove-fuji-usdc.sql --schema prisma/schema.prisma
-- Children first (foreign keys).
DELETE FROM "AgentAction" WHERE "decisionId" IN (SELECT "id" FROM "AgentDecision" WHERE "treasuryId" = 'fuji-usdc');
DELETE FROM "AgentDecision" WHERE "treasuryId" = 'fuji-usdc';
DELETE FROM "LadderSnapshot" WHERE "snapshotId" IN (SELECT "id" FROM "ChainSnapshotRecord" WHERE "treasuryId" = 'fuji-usdc');
DELETE FROM "PoolRiskSnapshot" WHERE "adapterAddress" IN (SELECT "adapterAddress" FROM "Pool" WHERE "treasuryId" = 'fuji-usdc');
DELETE FROM "PoolMetricSample" WHERE "adapterAddress" IN (SELECT "adapterAddress" FROM "Pool" WHERE "treasuryId" = 'fuji-usdc');
DELETE FROM "ChainSnapshotRecord" WHERE "treasuryId" = 'fuji-usdc';
DELETE FROM "Pool" WHERE "treasuryId" = 'fuji-usdc';
DELETE FROM "ObligationMetadata" WHERE "treasuryId" = 'fuji-usdc';
DELETE FROM "ObligationDraft" WHERE "treasuryId" = 'fuji-usdc';
DELETE FROM "Transaction" WHERE "treasuryId" = 'fuji-usdc';
DELETE FROM "IndexedEvent" WHERE "treasuryId" = 'fuji-usdc';
DELETE FROM "ChainEventCursor" WHERE "treasuryId" = 'fuji-usdc';
DELETE FROM "KeeperRun" WHERE "treasuryId" = 'fuji-usdc';
DELETE FROM "StressTestRun" WHERE "treasuryId" = 'fuji-usdc';
DELETE FROM "ExpectedInflow" WHERE "treasuryId" = 'fuji-usdc';
DELETE FROM "AgentSettings" WHERE "treasuryId" = 'fuji-usdc';
DELETE FROM "AuditLog" WHERE "treasuryId" = 'fuji-usdc';
DELETE FROM "TreasuryConfig" WHERE "id" = 'fuji-usdc';
UPDATE "TreasuryConfig" SET "isPrimary" = 1 WHERE "id" = 'fuji-musdc';
