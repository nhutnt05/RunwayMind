// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {ITreasury} from "../../contracts/interfaces/ITreasury.sol";
import {ObligationInput, ObligationStatus, Category} from "../../contracts/interfaces/IObligationRegistry.sol";
import "../../contracts/libraries/Errors.sol";
import {Fixture} from "../utils/Fixture.sol";
import {RogueAdapter} from "../utils/RogueAdapter.sol";

/// @notice docs/10 §3 — the 8 mandatory security scenarios (SRC hacked-agent scene + Rule 3).
///         Fixture at Day 0: idle 100,000; required reserve 30,000.
contract MandatorySecurityTest is Fixture {
    bytes32 internal constant ADMIN_ROLE = 0x00;

    function _unauthorized(address who, bytes32 role) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, who, role);
    }

    function test_mandatory1_agentTransfer50kToUnauthorizedWallet_reverts() public {
        uint256 idleBefore = treasury.idleBalance();
        vm.startPrank(agent);
        // (a) pull via allowance — Treasury never approves EOAs
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, agent, 0, 50_000e6));
        usdc.transferFrom(address(treasury), attacker, 50_000e6);
        // (b) adapter withdraw directly
        vm.expectRevert(NotTreasury.selector);
        adapter.withdraw(50_000e6);
        // (c) unknown selector on Treasury — no such function, no fallback
        (bool ok,) = address(treasury).call(abi.encodeWithSignature("transfer(address,uint256)", attacker, 50_000e6));
        assertFalse(ok, "(c) must fail");
        // (d) pay a non-existent obligation
        vm.expectRevert(abi.encodeWithSelector(UnknownObligation.selector, 999));
        treasury.pay(999);
        vm.stopPrank();

        assertEq(usdc.balanceOf(attacker), 0);
        assertEq(treasury.idleBalance(), idleBefore);
        assertEq(treasury.idleBalance(), 100_000e6);
    }

    function test_mandatory2_agentInvestBeyondReserve_reverts() public {
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(ReserveViolation.selector, 10_000e6, 30_000e6));
        treasury.invest(address(adapter), 90_000e6);
        assertEq(treasury.idleBalance(), 100_000e6);
        assertEq(treasury.vaultBalance(address(adapter)), 0);
    }

    function test_mandatory3_agentNonWhitelistedPool_reverts() public {
        RogueAdapter rogue = new RogueAdapter(address(usdc), address(treasury));
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(AdapterNotWhitelisted.selector, address(rogue)));
        treasury.invest(address(rogue), 10_000e6);
        assertEq(rogue.calls(), 0, "rogue deposit never called");
        assertEq(usdc.balanceOf(address(rogue)), 0);
        assertEq(treasury.idleBalance(), 100_000e6);
    }

    function test_mandatory4_agentExceedsExposure_reverts() public {
        vm.prank(admin);
        policy.setMaxExposureBps(5000);
        // R1 would pass (idle after 40,000 >= 30,000); R3 cap = 50,000
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(ExposureLimitExceeded.selector, 60_000e6, 50_000e6));
        treasury.invest(address(adapter), 60_000e6);
        assertEq(treasury.idleBalance(), 100_000e6);
    }

    function test_mandatory5_agentInvestWhileBreakerActive_reverts() public {
        // a position taken before the incident, so the post-trip withdraw is meaningful
        _invest(20_000e6);

        vm.prank(agent);
        treasury.tripCircuitBreaker();
        assertTrue(treasury.circuitBreakerActive());

        vm.prank(agent);
        vm.expectRevert(CircuitBreakerActive.selector);
        treasury.invest(address(adapter), 10_000e6);

        vm.prank(agent);
        vm.expectRevert(_unauthorized(agent, ADMIN_ROLE));
        treasury.resetCircuitBreaker();
        assertTrue(treasury.circuitBreakerActive());

        // withdraw and pay still succeed
        vm.prank(agent);
        assertEq(treasury.withdraw(address(adapter), 10_000e6), 10_000e6);
        _warpToDay(7);
        vm.prank(keeper);
        treasury.pay(o1);
        assertEq(usdc.balanceOf(recipient1), 20_000e6);
        assertTrue(treasury.circuitBreakerActive());
    }

    function test_mandatory6_withdrawToUnregisteredRecipient_impossible() public {
        _invest(70_000e6);

        // (a) unregistered id
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(UnknownObligation.selector, 42));
        treasury.pay(42);

        // (b) register the attacker as recipient
        ObligationInput memory input = ObligationInput({
            recipient: attacker,
            amount: 50_000e6,
            firstDueDate: T0 + 1 days,
            interval: 0,
            maxOccurrences: 1,
            category: Category.OTHER,
            metadataHash: bytes32(0)
        });
        vm.prank(agent);
        vm.expectRevert(_unauthorized(agent, ADMIN_ROLE));
        registry.createObligation(input);

        // (c) redirect O1 to the attacker
        vm.prank(agent);
        vm.expectRevert(_unauthorized(agent, ADMIN_ROLE));
        registry.updateObligation(1, attacker, 20_000e6, T0 + 7 days);

        // (d) withdraw succeeds, but the tokens land in the Treasury only
        uint256 idleBefore = treasury.idleBalance();
        vm.prank(agent);
        uint256 received = treasury.withdraw(address(adapter), 10_000e6);
        assertEq(received, 10_000e6);
        assertEq(treasury.idleBalance(), idleBefore + 10_000e6);
        assertEq(usdc.balanceOf(attacker), 0);
        assertEq(usdc.balanceOf(agent), 0);
        assertEq(registry.obligationCount(), 3);
        assertEq(registry.getObligation(1).recipient, recipient1);
    }

    function test_mandatory7_keeperCallsEnforceDeadlines() public {
        _invest(70_000e6);
        _warpToDay(7);
        vm.prank(keeper);
        treasury.pay(o1);
        _warpToDay(16); // no agent action
        assertFalse(treasury.hasRole(treasury.AGENT_ROLE(), keeper));

        vm.expectEmit(true, false, false, true, address(treasury));
        emit ITreasury.DeadlineEnforced(keeper, 20_000e6, 20_000e6);
        vm.prank(keeper);
        assertEq(treasury.enforceDeadlines(), 20_000e6);
        assertEq(treasury.idleBalance(), 30_000e6);
        assertEq(treasury.shortfall(), 0);

        // second call is a no-op
        vm.recordLogs();
        vm.prank(keeper);
        assertEq(treasury.enforceDeadlines(), 0);
        assertEq(vm.getRecordedLogs().length, 0, "no-op emits nothing");
        assertEq(treasury.idleBalance(), 30_000e6);
    }

    function test_mandatory8_validPayrollPaymentSucceeds() public {
        _invest(70_000e6);
        _warpToDay(7);
        address caller = makeAddr("randomEOA");

        vm.expectEmit(true, true, true, true, address(treasury));
        emit ITreasury.ObligationPaid(1, recipient1, 20_000e6, 1, caller);
        vm.prank(caller);
        treasury.pay(1);

        assertEq(usdc.balanceOf(recipient1), 20_000e6);
        assertEq(uint8(registry.getObligation(1).status), uint8(ObligationStatus.COMPLETED));

        vm.prank(caller);
        vm.expectRevert(abi.encodeWithSelector(ObligationNotActive.selector, 1));
        treasury.pay(1);

        vm.prank(caller);
        vm.expectRevert(abi.encodeWithSelector(ObligationNotDue.selector, 2, T0 + 30 days, T0 + 7 days));
        treasury.pay(2);
        assertEq(usdc.balanceOf(recipient1), 20_000e6);
        assertEq(usdc.balanceOf(recipient2), 0);
    }
}
