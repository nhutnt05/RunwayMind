// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MockLendingPool} from "../../contracts/mocks/MockLendingPool.sol";
import {VaultAdapter} from "../../contracts/VaultAdapter.sol";
import {IClock} from "../../contracts/interfaces/IClock.sol";
import {Obligation} from "../../contracts/interfaces/IObligationRegistry.sol";
import {AdapterStatus} from "../../contracts/interfaces/IPolicyEngine.sol";
import {IMockLendingPool} from "../../contracts/interfaces/IMockLendingPool.sol";
import {Fixture} from "../utils/Fixture.sol";
import {GhostState} from "./handlers/GhostState.sol";
import {Ctx} from "./handlers/HandlerBase.sol";
import {AgentHandler} from "./handlers/AgentHandler.sol";
import {KeeperHandler} from "./handlers/KeeperHandler.sol";
import {AdminHandler} from "./handlers/AdminHandler.sol";
import {PoolOperatorHandler} from "./handlers/PoolOperatorHandler.sol";

/// @notice docs/03 §4 INV-1 … INV-7, driven by agent / keeper / admin / pool-operator handlers (docs/10 §2.8).
///         System: fixture (O1/O2/O3) plus a second whitelisted pool, so ordering and per-pool failures matter.
contract TreasuryInvariantsTest is Fixture {
    uint256 internal constant RAY = 1e27;

    GhostState internal ghost;
    AgentHandler internal agentHandler;
    KeeperHandler internal keeperHandler;
    AdminHandler internal adminHandler;
    PoolOperatorHandler internal poolHandler;

    MockLendingPool internal pool1;
    VaultAdapter internal adapter1;
    address[] internal recipients;
    address[] internal nonRecipients;

    function setUp() public override {
        super.setUp();

        vm.startPrank(admin);
        pool1 = new MockLendingPool(usdc, IClock(address(treasury)), admin, 1200);
        adapter1 = new VaultAdapter(IMockLendingPool(address(pool1)), address(treasury), "Second Pool");
        policy.setAdapterStatus(address(adapter1), AdapterStatus.ACTIVE);
        usdc.mint(admin, INTEREST_RESERVE);
        usdc.approve(address(pool1), INTEREST_RESERVE);
        pool1.fundInterestReserve(INTEREST_RESERVE);
        vm.stopPrank();

        recipients.push(recipient1);
        recipients.push(recipient2);
        recipients.push(recipient3);
        recipients.push(makeAddr("recipient4"));
        recipients.push(makeAddr("recipient5"));

        ghost = new GhostState();
        Ctx memory c = Ctx({
            usdc: usdc,
            registry: registry,
            policy: policy,
            treasury: treasury,
            pool0: pool,
            pool1: pool1,
            adapter0: adapter,
            adapter1: adapter1,
            admin: admin,
            agent: agent,
            keeper: keeper,
            ghost: ghost
        });
        agentHandler = new AgentHandler(c);
        keeperHandler = new KeeperHandler(c);
        adminHandler = new AdminHandler(c, recipients);
        poolHandler = new PoolOperatorHandler(c);

        nonRecipients.push(admin);
        nonRecipients.push(agent);
        nonRecipients.push(keeper);
        nonRecipients.push(attacker);
        nonRecipients.push(address(adapter));
        nonRecipients.push(address(adapter1));
        nonRecipients.push(address(agentHandler));
        nonRecipients.push(address(keeperHandler));
        nonRecipients.push(address(adminHandler));
        nonRecipients.push(address(poolHandler));
        nonRecipients.push(address(this));

        targetContract(address(agentHandler));
        targetContract(address(keeperHandler));
        targetContract(address(adminHandler));
        targetContract(address(poolHandler));
    }

    function _vaults() internal view returns (uint256) {
        return adapter.balance() + adapter1.balance();
    }

    // ---------------------------------------------------------------------------------------- INV-1

    /// @dev Value (idle + pool claims + paid to recipients) only changes by interest, minus pool-favoring dust.
    ///      Lower bound: nothing leaks. Upper bound: no unit can grow faster than the highest pool index.
    function invariant_INV1_valueConservedExceptInterest() public view {
        uint256 value = treasury.idleBalance() + _vaults() + ghost.totalPaid();
        assertGe(value + 2 * ghost.poolOps() + 2, SEED, "INV-1: value leaked");
        uint256 idx0 = pool.currentIndex();
        uint256 idx1 = pool1.currentIndex();
        uint256 maxIdx = idx0 > idx1 ? idx0 : idx1;
        assertLe(value, (SEED * maxIdx) / RAY + 2, "INV-1: value created beyond interest");

        // token-level conservation: every token is in the Treasury, a pool, or with a registered recipient
        uint256 held =
            usdc.balanceOf(address(treasury)) + usdc.balanceOf(address(pool)) + usdc.balanceOf(address(pool1));
        for (uint256 i = 0; i < recipients.length; ++i) {
            held += usdc.balanceOf(recipients[i]);
        }
        assertEq(held, usdc.totalSupply(), "INV-1: tokens outside treasury/pools/recipients");
    }

    // ---------------------------------------------------------------------------------------- INV-2

    function invariant_INV2_onlyRegisteredRecipientsReceive() public view {
        assertEq(ghost.violations(2), 0, "INV-2: pay sent wrong amount/recipient");
        for (uint256 i = 0; i < nonRecipients.length; ++i) {
            assertEq(usdc.balanceOf(nonRecipients[i]), 0, "INV-2: non-recipient holds tokens");
        }
        for (uint256 i = 0; i < recipients.length; ++i) {
            assertEq(usdc.balanceOf(recipients[i]), ghost.paidTo(recipients[i]), "INV-2: recipient got unpaid tokens");
        }
    }

    // ---------------------------------------------------------------------------------------- INV-3

    /// @dev docs/03 §3.6 name. After any successful invest: idle ≥ requiredReserve(now).
    function invariant_idleCoversReserveAfterAgentActions() public view {
        assertEq(ghost.violations(3), 0, "INV-3: invest left idle below required reserve");
    }

    // ---------------------------------------------------------------------------------------- INV-4

    function invariant_INV4_enforceClearsShortfallWhenLiquid() public view {
        assertEq(ghost.violations(4), 0, "INV-4: shortfall left after enforceDeadlines with liquid pools");
    }

    // ---------------------------------------------------------------------------------------- INV-5

    function invariant_INV5_exposureCapAfterInvest() public view {
        assertEq(ghost.violations(5), 0, "INV-5: vault balance above exposure cap after invest");
    }

    // ---------------------------------------------------------------------------------------- INV-6

    function invariant_INV6_noInvestWhileBreakerActive() public view {
        assertEq(ghost.violations(6), 0, "INV-6: Invested emitted while breaker active");
    }

    // ---------------------------------------------------------------------------------------- INV-7

    function invariant_INV7_occurrencePaidAtMostOnce() public view {
        assertLe(ghost.maxPaysPerOccurrence(), 1, "INV-7: occurrence paid twice");
        uint256 count = registry.obligationCount();
        for (uint256 id = 1; id <= count; ++id) {
            Obligation memory ob = registry.getObligation(id);
            assertEq(ob.paidOccurrences, ghost.paysPerId(id), "INV-7: registry/ghost pay count mismatch");
            if (ob.maxOccurrences != 0) assertLe(ob.paidOccurrences, ob.maxOccurrences, "INV-7: over max occurrences");
        }
    }

    // ---------------------------------------------------------------------------------------- summary

    function afterInvariant() public {
        emit log_named_uint("invest successes", ghost.investSuccesses());
        emit log_named_uint("invest attempts while breaker", ghost.investAttemptsWhileBreaker());
        emit log_named_uint("withdraw successes", ghost.withdrawSuccesses());
        emit log_named_uint("pay successes", ghost.paySuccesses());
        emit log_named_uint("enforce checks (liquid)", ghost.enforceLiquidChecks());
        emit log_named_uint("obligations created", ghost.obligationsCreated());
    }
}
