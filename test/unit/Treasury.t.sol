// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Treasury} from "../../contracts/Treasury.sol";
import {VaultAdapter} from "../../contracts/VaultAdapter.sol";
import {MockLendingPool} from "../../contracts/mocks/MockLendingPool.sol";
import {ITreasury} from "../../contracts/interfaces/ITreasury.sol";
import {IClock} from "../../contracts/interfaces/IClock.sol";
import {IObligationRegistry, Obligation, ObligationStatus} from "../../contracts/interfaces/IObligationRegistry.sol";
import {IPolicyEngine, AdapterStatus} from "../../contracts/interfaces/IPolicyEngine.sol";
import {IMockLendingPool} from "../../contracts/interfaces/IMockLendingPool.sol";
import "../../contracts/libraries/Errors.sol";
import {Fixture} from "../utils/Fixture.sol";
import {RogueAdapter} from "../utils/RogueAdapter.sol";

contract TreasuryTest is Fixture {
    bytes32 internal constant AGENT = keccak256("AGENT_ROLE");

    function _unauthorized(address who, bytes32 role) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, who, role);
    }

    // ---------------------------------------------------------------------------------------- setup sanity

    function test_fixture_state() public view {
        assertTrue(treasury.demoMode());
        assertEq(treasury.currentTime(), START_TIMESTAMP);
        assertEq(treasury.idleBalance(), 100_000e6);
        assertEq(treasury.totalAssets(), 100_000e6);
        assertEq(treasury.requiredReserve(), 30_000e6);
        assertEq(treasury.shortfall(), 0);
        assertEq(treasury.maxInvestable(address(adapter)), 70_000e6);
        assertTrue(treasury.hasRole(treasury.AGENT_ROLE(), agent));
        assertTrue(registry.hasRole(registry.TREASURY_ROLE(), address(treasury)));
        assertEq(treasury.asset(), address(usdc));
        assertEq(treasury.registry(), address(registry));
        assertEq(treasury.policy(), address(policy));
    }

    // ---------------------------------------------------------------------------------------- invest

    function test_invest_succeedsWithinPolicy() public {
        vm.expectEmit(true, true, false, true, address(treasury));
        emit ITreasury.Invested(address(adapter), 70_000e6, agent, 30_000e6);
        _invest(70_000e6);
        assertEq(treasury.idleBalance(), 30_000e6);
        assertEq(treasury.vaultBalance(address(adapter)), 70_000e6);
        assertEq(treasury.totalAssets(), 100_000e6);
        assertGe(treasury.idleBalance(), treasury.requiredReserve());
    }

    function test_invest_revertsWhenBreakerActive() public {
        vm.prank(agent);
        treasury.tripCircuitBreaker();
        vm.prank(agent);
        vm.expectRevert(CircuitBreakerActive.selector);
        treasury.invest(address(adapter), 1e6);
        assertEq(treasury.maxInvestable(address(adapter)), 0);
    }

    function test_invest_revertsZeroAmount() public {
        vm.prank(agent);
        vm.expectRevert(ZeroAmount.selector);
        treasury.invest(address(adapter), 0);
    }

    function test_invest_revertsInsufficientIdle() public {
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(InsufficientIdle.selector, 100_000e6 + 1, 100_000e6));
        treasury.invest(address(adapter), 100_000e6 + 1);
    }

    function test_invest_revertsNotWhitelisted() public {
        RogueAdapter rogue = new RogueAdapter(address(usdc), address(treasury));
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(AdapterNotWhitelisted.selector, address(rogue)));
        treasury.invest(address(rogue), 10_000e6);
        assertEq(rogue.calls(), 0, "non-whitelisted adapter code never executed");
    }

    function test_invest_revertsAdapterMismatch() public {
        RogueAdapter wrongTreasury = new RogueAdapter(address(usdc), attacker);
        vm.prank(admin);
        policy.setAdapterStatus(address(wrongTreasury), AdapterStatus.ACTIVE);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(AdapterMismatch.selector, address(wrongTreasury)));
        treasury.invest(address(wrongTreasury), 1e6);
    }

    function test_invest_revertsReserveViolation() public {
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(ReserveViolation.selector, 10_000e6, 30_000e6));
        treasury.invest(address(adapter), 90_000e6);
        assertEq(treasury.idleBalance(), 100_000e6);
    }

    function test_invest_revertsExposure() public {
        vm.prank(admin);
        policy.setMaxExposureBps(5000);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(ExposureLimitExceeded.selector, 60_000e6, 50_000e6));
        treasury.invest(address(adapter), 60_000e6);
    }

    function test_invest_revertsForRandomCaller() public {
        vm.prank(attacker);
        vm.expectRevert(_unauthorized(attacker, AGENT));
        treasury.invest(address(adapter), 1e6);
        vm.prank(keeper);
        vm.expectRevert(_unauthorized(keeper, AGENT));
        treasury.invest(address(adapter), 1e6);
    }

    function test_invest_adminAllowed() public {
        vm.prank(admin);
        treasury.invest(address(adapter), 10_000e6);
        assertEq(treasury.idleBalance(), 90_000e6);
    }

    // ---------------------------------------------------------------------------------------- withdraw

    function test_withdraw_worksWhenBreakerActive() public {
        _invest(70_000e6);
        vm.prank(agent);
        treasury.tripCircuitBreaker();
        vm.expectEmit(true, true, false, true, address(treasury));
        emit ITreasury.Withdrawn(address(adapter), 20_000e6, 20_000e6, agent);
        vm.prank(agent);
        uint256 received = treasury.withdraw(address(adapter), 20_000e6);
        assertEq(received, 20_000e6);
        assertEq(treasury.idleBalance(), 50_000e6);
    }

    function test_withdraw_max() public {
        _invest(70_000e6);
        _warpToDay(2);
        uint256 bal = adapter.balance();
        assertGt(bal, 70_000e6, "interest accrued");
        vm.prank(agent);
        uint256 received = treasury.withdraw(address(adapter), type(uint256).max);
        assertEq(received, bal);
        assertEq(adapter.balance(), 0);
    }

    function test_withdraw_unknownAdapter() public {
        RogueAdapter rogue = new RogueAdapter(address(usdc), address(treasury));
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(AdapterUnknown.selector, address(rogue)));
        treasury.withdraw(address(rogue), 1e6);
    }

    function test_withdraw_zeroAndRandomCaller() public {
        vm.prank(agent);
        vm.expectRevert(ZeroAmount.selector);
        treasury.withdraw(address(adapter), 0);
        vm.prank(attacker);
        vm.expectRevert(_unauthorized(attacker, AGENT));
        treasury.withdraw(address(adapter), 1);
    }

    // ---------------------------------------------------------------------------------------- pay

    function test_pay_beforeDue_reverts() public {
        _warpToDay(7);
        vm.warp(block.timestamp - 1);
        vm.expectRevert(abi.encodeWithSelector(ObligationNotDue.selector, o1, T0 + 7 days, T0 + 7 days - 1));
        treasury.pay(o1);
    }

    function test_pay_onDue_transfersToRecipient() public {
        _warpToDay(7);
        vm.expectEmit(true, true, true, true, address(treasury));
        emit ITreasury.ObligationPaid(o1, recipient1, 20_000e6, 1, keeper);
        vm.prank(keeper);
        treasury.pay(o1);
        assertEq(usdc.balanceOf(recipient1), 20_000e6);
        assertEq(treasury.idleBalance(), 80_000e6);
        assertEq(uint8(registry.getObligation(o1).status), uint8(ObligationStatus.COMPLETED));
        vm.expectRevert(abi.encodeWithSelector(ObligationNotActive.selector, o1));
        treasury.pay(o1);
    }

    function test_pay_byRandomEOA() public {
        _warpToDay(7);
        vm.prank(attacker);
        treasury.pay(o1);
        assertEq(usdc.balanceOf(recipient1), 20_000e6, "funds go to the registered recipient");
        assertEq(usdc.balanceOf(attacker), 0);
    }

    function test_pay_unknownObligation() public {
        vm.expectRevert(abi.encodeWithSelector(UnknownObligation.selector, 999));
        treasury.pay(999);
    }

    function test_pay_pullsFromVaultWhenIdleShort() public {
        _invest(70_000e6);
        _warpToDay(7);
        treasury.pay(o1); // idle 30k → 10k
        _warpToDay(30); // nobody enforced the D16 deadline
        treasury.pay(o2); // needs 20k, idle 10k → pulls 10k
        assertEq(usdc.balanceOf(recipient2), 20_000e6);
        assertEq(treasury.idleBalance(), 0);
    }

    function test_pay_revertsInsufficientLiquidityWhenPoolPaused() public {
        _invest(70_000e6);
        _warpToDay(7);
        treasury.pay(o1); // idle 10k
        vm.prank(admin);
        pool.setPaused(true);
        _warpToDay(30);
        vm.expectRevert(abi.encodeWithSelector(InsufficientLiquidity.selector, 20_000e6, 10_000e6));
        treasury.pay(o2);
    }

    function test_pay_recurringAdvancesDueDate() public {
        uint256 id = _createRecurring(recipient1, 1000e6, T0 + 1 days, 30 days, 0);
        _warpToDay(1);
        treasury.pay(id);
        Obligation memory ob = registry.getObligation(id);
        assertEq(ob.nextDueDate, T0 + 31 days);
        assertEq(ob.paidOccurrences, 1);
        assertEq(uint8(ob.status), uint8(ObligationStatus.ACTIVE));
        vm.expectRevert(abi.encodeWithSelector(ObligationNotDue.selector, id, T0 + 31 days, T0 + 1 days));
        treasury.pay(id);
    }

    function test_pay_worksWhenBreakerActive() public {
        vm.prank(agent);
        treasury.tripCircuitBreaker();
        _warpToDay(7);
        treasury.pay(o1);
        assertEq(usdc.balanceOf(recipient1), 20_000e6);
    }

    // ---------------------------------------------------------------------------------------- enforceDeadlines

    function test_enforceDeadlines_noShortfall_noop() public {
        _invest(70_000e6);
        vm.recordLogs();
        vm.prank(keeper);
        assertEq(treasury.enforceDeadlines(), 0);
        assertEq(vm.getRecordedLogs().length, 0, "no event on no-op");
    }

    function test_enforceDeadlines_pullsExactShortfall() public {
        _invest(70_000e6);
        _warpToDay(7);
        treasury.pay(o1);
        _warpToDay(16);
        assertEq(treasury.shortfall(), 20_000e6);
        vm.expectEmit(true, false, false, true, address(treasury));
        emit ITreasury.DeadlineEnforced(keeper, 20_000e6, 20_000e6);
        vm.prank(keeper);
        assertEq(treasury.enforceDeadlines(), 20_000e6);
        assertEq(treasury.idleBalance(), 30_000e6);
        assertEq(treasury.shortfall(), 0);
        vm.prank(keeper);
        assertEq(treasury.enforceDeadlines(), 0);
    }

    function test_enforceDeadlines_skipsFailingAdapter_emitsEvent() public {
        // Second pool + adapter as a healthy backup; the first pool will be paused (its withdraw reverts).
        vm.startPrank(admin);
        MockLendingPool pool2 = new MockLendingPool(usdc, IClock(address(treasury)), admin, 500);
        VaultAdapter adapter2 = new VaultAdapter(IMockLendingPool(address(pool2)), address(treasury), "Backup");
        policy.setAdapterStatus(address(adapter2), AdapterStatus.ACTIVE);
        usdc.mint(admin, 1000e6);
        usdc.approve(address(pool2), 1000e6);
        pool2.fundInterestReserve(1000e6);
        vm.stopPrank();

        vm.startPrank(agent);
        treasury.invest(address(adapter), 40_000e6);
        treasury.invest(address(adapter2), 30_000e6);
        vm.stopPrank();
        _warpToDay(7);
        treasury.pay(o1); // idle 10k
        vm.prank(admin);
        pool.setPaused(true);
        _warpToDay(16);

        vm.expectEmit(true, false, false, true, address(treasury));
        emit ITreasury.AdapterWithdrawFailed(address(adapter), 20_000e6, abi.encodeWithSelector(PoolPaused.selector));
        vm.prank(keeper);
        uint256 withdrawn = treasury.enforceDeadlines();
        assertEq(withdrawn, 20_000e6, "backup adapter covered the shortfall");
        assertEq(treasury.shortfall(), 0);
    }

    // ---------------------------------------------------------------------------------------- circuit breaker

    function test_breaker_agentCanTripNotReset() public {
        vm.expectEmit(true, false, false, false, address(treasury));
        emit ITreasury.CircuitBreakerTripped(agent);
        vm.prank(agent);
        treasury.tripCircuitBreaker();
        assertTrue(treasury.circuitBreakerActive());
        vm.prank(agent);
        treasury.tripCircuitBreaker(); // idempotent
        vm.prank(agent);
        vm.expectRevert(_unauthorized(agent, bytes32(0)));
        treasury.resetCircuitBreaker();
        vm.prank(attacker);
        vm.expectRevert(_unauthorized(attacker, AGENT));
        treasury.tripCircuitBreaker();

        vm.prank(admin);
        treasury.resetCircuitBreaker();
        assertFalse(treasury.circuitBreakerActive());
    }

    // ---------------------------------------------------------------------------------------- time offset

    function test_timeOffset_onlyAdminDemoMode_monotonic() public {
        vm.prank(agent);
        vm.expectRevert(_unauthorized(agent, bytes32(0)));
        treasury.advanceTime(1 days);

        vm.expectEmit(false, false, false, true, address(treasury));
        emit ITreasury.TimeOffsetUpdated(0, 7 days);
        vm.prank(admin);
        treasury.advanceTime(7 days);
        assertEq(treasury.timeOffset(), 7 days);
        assertEq(treasury.currentTime(), START_TIMESTAMP + 7 days);

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(InvalidTimeOffset.selector, uint64(7 days), uint64(1 days)));
        treasury.setTimeOffset(1 days); // decreasing

        vm.prank(admin);
        treasury.setTimeOffset(365 days); // MAX inclusive
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(InvalidTimeOffset.selector, uint64(365 days), uint64(365 days + 1)));
        treasury.advanceTime(1);

        // demo time travel drives payments: O1 is due at offset >= 7 days
        treasury.pay(o1);
    }

    function test_timeOffset_revertsInProduction() public {
        Treasury prod =
            new Treasury(usdc, IObligationRegistry(address(registry)), IPolicyEngine(address(policy)), admin, false);
        vm.startPrank(admin);
        vm.expectRevert(NotDemoMode.selector);
        prod.setTimeOffset(1);
        vm.expectRevert(NotDemoMode.selector);
        prod.advanceTime(1);
        vm.stopPrank();
        assertEq(prod.currentTime(), uint64(block.timestamp));
    }

    function test_constructor_revertsZeroAddress() public {
        vm.expectRevert(ZeroAddress.selector);
        new Treasury(usdc, IObligationRegistry(address(registry)), IPolicyEngine(address(policy)), address(0), true);
    }

    // ---------------------------------------------------------------------------------------- R5 structural

    function test_noReceiveNoFallback() public {
        vm.deal(attacker, 1 ether);
        vm.prank(attacker);
        (bool ok,) = address(treasury).call{value: 1 wei}("");
        assertFalse(ok, "no receive");
        vm.prank(agent);
        (ok,) = address(treasury).call(abi.encodeWithSignature("transfer(address,uint256)", attacker, 50_000e6));
        assertFalse(ok, "no fallback / transfer function");
        assertEq(usdc.balanceOf(attacker), 0);
    }
}
