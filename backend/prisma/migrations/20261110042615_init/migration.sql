-- CreateTable
CREATE TABLE "TreasuryConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chainId" INTEGER NOT NULL,
    "treasuryAddress" TEXT NOT NULL,
    "registryAddress" TEXT NOT NULL,
    "policyAddress" TEXT NOT NULL,
    "assetAddress" TEXT NOT NULL,
    "assetSymbol" TEXT NOT NULL,
    "assetDecimals" INTEGER NOT NULL,
    "deployBlock" TEXT NOT NULL,
    "demoStartTime" INTEGER,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "Wallet" (
    "address" TEXT NOT NULL PRIMARY KEY,
    "label" TEXT,
    "cachedRoles" TEXT NOT NULL,
    "rolesCheckedAt" DATETIME NOT NULL,
    "lastSeenAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AuthNonce" (
    "nonce" TEXT NOT NULL PRIMARY KEY,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME
);

-- CreateTable
CREATE TABLE "ObligationMetadata" (
    "treasuryId" TEXT NOT NULL,
    "obligationId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "notes" TEXT,
    "source" TEXT NOT NULL,
    "nlDraftId" TEXT,
    "metadataHash" TEXT NOT NULL,
    "createTxHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("treasuryId", "obligationId"),
    CONSTRAINT "ObligationMetadata_treasuryId_fkey" FOREIGN KEY ("treasuryId") REFERENCES "TreasuryConfig" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ObligationDraft" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "treasuryId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "recipient" TEXT,
    "amount" TEXT NOT NULL,
    "firstDueDate" INTEGER NOT NULL,
    "interval" INTEGER NOT NULL,
    "maxOccurrences" INTEGER NOT NULL,
    "warnings" TEXT NOT NULL,
    "sourceText" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ObligationDraft_treasuryId_fkey" FOREIGN KEY ("treasuryId") REFERENCES "TreasuryConfig" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Pool" (
    "adapterAddress" TEXT NOT NULL PRIMARY KEY,
    "poolAddress" TEXT NOT NULL,
    "treasuryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Pool_treasuryId_fkey" FOREIGN KEY ("treasuryId") REFERENCES "TreasuryConfig" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PoolMetricSample" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "adapterAddress" TEXT NOT NULL,
    "sampledAt" INTEGER NOT NULL,
    "blockNumber" TEXT NOT NULL,
    "apyBps" INTEGER NOT NULL,
    "utilizationBps" INTEGER NOT NULL,
    "tvl" TEXT NOT NULL,
    "availableLiquidity" TEXT NOT NULL,
    "paused" BOOLEAN NOT NULL,
    CONSTRAINT "PoolMetricSample_adapterAddress_fkey" FOREIGN KEY ("adapterAddress") REFERENCES "Pool" ("adapterAddress") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PoolRiskSnapshot" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "adapterAddress" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "band" TEXT NOT NULL,
    "components" TEXT NOT NULL,
    "computedAt" INTEGER NOT NULL,
    CONSTRAINT "PoolRiskSnapshot_adapterAddress_fkey" FOREIGN KEY ("adapterAddress") REFERENCES "Pool" ("adapterAddress") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChainSnapshotRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "treasuryId" TEXT NOT NULL,
    "blockNumber" TEXT NOT NULL,
    "chainTime" INTEGER NOT NULL,
    "data" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "LadderSnapshot" (
    "snapshotId" TEXT NOT NULL PRIMARY KEY,
    "result" TEXT NOT NULL,
    CONSTRAINT "LadderSnapshot_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ChainSnapshotRecord" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgentDecision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "treasuryId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "adapter" TEXT,
    "amount" TEXT,
    "reasonCode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "facts" TEXT NOT NULL,
    "explanation" TEXT,
    "explanationSource" TEXT,
    "approvedBy" TEXT,
    "approvedAt" DATETIME,
    "rejectedBy" TEXT,
    "rejectReason" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AgentDecision_treasuryId_fkey" FOREIGN KEY ("treasuryId") REFERENCES "TreasuryConfig" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgentAction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "decisionId" TEXT NOT NULL,
    "functionName" TEXT NOT NULL,
    "args" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "txHash" TEXT,
    "decodedError" TEXT,
    "gasUsed" TEXT,
    "blockNumber" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AgentAction_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "AgentDecision" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Transaction" (
    "hash" TEXT NOT NULL PRIMARY KEY,
    "treasuryId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fromAddress" TEXT NOT NULL,
    "initiator" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "blockNumber" TEXT,
    "decodedEvents" TEXT,
    "error" TEXT,
    "relatedId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" DATETIME
);

-- CreateTable
CREATE TABLE "IndexedEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "treasuryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "blockNumber" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "args" TEXT NOT NULL,
    "chainTime" INTEGER
);

-- CreateTable
CREATE TABLE "ChainEventCursor" (
    "treasuryId" TEXT NOT NULL PRIMARY KEY,
    "lastBlock" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "KeeperRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "treasuryId" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "chainTime" INTEGER NOT NULL,
    "shortfallBefore" TEXT NOT NULL,
    "enforced" BOOLEAN NOT NULL,
    "paidIds" TEXT NOT NULL,
    "txHashes" TEXT NOT NULL,
    "errors" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "StressTestRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "treasuryId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "scenarios" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "worstCase" TEXT NOT NULL,
    "overallClass" TEXT NOT NULL,
    "requestedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ExpectedInflow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "treasuryId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "expectedDate" INTEGER NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExpectedInflow_treasuryId_fkey" FOREIGN KEY ("treasuryId") REFERENCES "TreasuryConfig" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgentSettings" (
    "treasuryId" TEXT NOT NULL PRIMARY KEY,
    "mode" TEXT NOT NULL DEFAULT 'APPROVE',
    "minApyBps" INTEGER NOT NULL DEFAULT 300,
    "riskInvestThreshold" INTEGER NOT NULL DEFAULT 70,
    "riskWithdrawThreshold" INTEGER NOT NULL DEFAULT 40,
    "minActionAmount" TEXT NOT NULL DEFAULT '100000000',
    "preWithdrawLeadDays" INTEGER NOT NULL DEFAULT 2,
    "decisionTtlSec" INTEGER NOT NULL DEFAULT 600,
    "loopIntervalSec" INTEGER NOT NULL DEFAULT 30,
    "updatedBy" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AgentSettings_treasuryId_fkey" FOREIGN KEY ("treasuryId") REFERENCES "TreasuryConfig" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "treasuryId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "payload" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "TreasuryConfig_treasuryAddress_key" ON "TreasuryConfig"("treasuryAddress");

-- CreateIndex
CREATE UNIQUE INDEX "ObligationMetadata_nlDraftId_key" ON "ObligationMetadata"("nlDraftId");

-- CreateIndex
CREATE INDEX "ObligationDraft_treasuryId_status_idx" ON "ObligationDraft"("treasuryId", "status");

-- CreateIndex
CREATE INDEX "PoolMetricSample_adapterAddress_sampledAt_idx" ON "PoolMetricSample"("adapterAddress", "sampledAt");

-- CreateIndex
CREATE INDEX "PoolRiskSnapshot_adapterAddress_computedAt_idx" ON "PoolRiskSnapshot"("adapterAddress", "computedAt");

-- CreateIndex
CREATE INDEX "ChainSnapshotRecord_treasuryId_chainTime_idx" ON "ChainSnapshotRecord"("treasuryId", "chainTime");

-- CreateIndex
CREATE INDEX "AgentDecision_treasuryId_status_createdAt_idx" ON "AgentDecision"("treasuryId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentAction_txHash_key" ON "AgentAction"("txHash");

-- CreateIndex
CREATE INDEX "AgentAction_decisionId_idx" ON "AgentAction"("decisionId");

-- CreateIndex
CREATE INDEX "Transaction_treasuryId_createdAt_idx" ON "Transaction"("treasuryId", "createdAt");

-- CreateIndex
CREATE INDEX "Transaction_kind_status_idx" ON "Transaction"("kind", "status");

-- CreateIndex
CREATE INDEX "IndexedEvent_treasuryId_name_blockNumber_idx" ON "IndexedEvent"("treasuryId", "name", "blockNumber");

-- CreateIndex
CREATE INDEX "KeeperRun_treasuryId_startedAt_idx" ON "KeeperRun"("treasuryId", "startedAt");

-- CreateIndex
CREATE INDEX "StressTestRun_treasuryId_createdAt_idx" ON "StressTestRun"("treasuryId", "createdAt");

-- CreateIndex
CREATE INDEX "ExpectedInflow_treasuryId_expectedDate_idx" ON "ExpectedInflow"("treasuryId", "expectedDate");

-- CreateIndex
CREATE INDEX "AuditLog_treasuryId_createdAt_idx" ON "AuditLog"("treasuryId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");
