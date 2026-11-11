// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ITreasury} from "../../contracts/interfaces/ITreasury.sol";
import {ObligationInput, ObligationStatus, Category} from "../../contracts/interfaces/IObligationRegistry.sol";
import {AdapterStatus} from "../../contracts/interfaces/IPolicyEngine.sol";
import "../../contracts/libraries/Errors.sol";
import {Fixture} from "../utils/Fixture.sol";
import {AltAssetSystem, Sys} from "../utils/AltAssetSystem.sol";
import {MaliciousAdapter} from "../utils/MaliciousAdapter.sol";
import {ReentrantToken, ReentrantRecipient} from "../utils/ReentrantToken.sol";

/// @notice docs/10 §2.4, docs/03 §3.12 — re-entry from a whitelisted adapter and from a hook token.
contract ReentrancyTest is Fixture, AltAssetSystem {
    MaliciousAdapter internal mal;
    bytes internal REENTRANT = abi.encodeWithSelector(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);

    function setUp() public override {
        super.setUp();
        mal = new MaliciousAdapter(address(usdc), address(treasury));
        vm.prank(admin);
        policy.setAdapterStatus(address(mal), AdapterStatus.ACTIVE);
    }

    function _investMal(uint256 amount) internal {
        vm.prank(agent);
        treasury.invest(address(mal), amount);
    }

    // ---------------------------------------------------------------------------------------- MaliciousAdapter

    function test_security_reentrantAdapter_reverts() public {
        _investMal(20_000e6);
        _warpToDay(7); // O1 is due
        mal.arm(MaliciousAdapter.Attack.PAY, o1, false);

        vm.prank(agent);
        vm.expectRevert(REENTRANT);
        treasury.withdraw(address(mal), 10_000e6);

        assertEq(registry.getObligation(o1).paidOccurrences, 0);
        assertEq(usdc.balanceOf(recipient1), 0);
        assertEq(mal.balance(), 20_000e6);

        // the honest path still pays exactly once
        mal.arm(MaliciousAdapter.Attack.NONE, 0, false);
        vm.prank(keeper);
        treasury.pay(o1);
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(ObligationNotActive.selector, o1));
        treasury.pay(o1);
        assertEq(usdc.balanceOf(recipient1), 20_000e6);
    }

    /// @dev The adapter holds no role, so re-entering invest/withdraw is first stopped by access control. To prove the
    ///      reentrancy guard on its own, the worst case (adapter also holds AGENT_ROLE) is tested as well.
    function _unauthorizedAdapter() internal view returns (bytes memory) {
        return abi.encodeWithSignature(
            "AccessControlUnauthorizedAccount(address,bytes32)", address(mal), treasury.AGENT_ROLE()
        );
    }

    function _grantAdapterAgentRole() internal {
        bytes32 role = treasury.AGENT_ROLE();
        vm.prank(admin);
        treasury.grantRole(role, address(mal));
    }

    function test_security_reentrantAdapter_investFromDeposit_reverts() public {
        mal.arm(MaliciousAdapter.Attack.INVEST, 1e6, false);
        bytes memory unauthorized = _unauthorizedAdapter();
        vm.prank(agent);
        vm.expectRevert(unauthorized);
        treasury.invest(address(mal), 10_000e6);

        _grantAdapterAgentRole();
        vm.prank(agent);
        vm.expectRevert(REENTRANT);
        treasury.invest(address(mal), 10_000e6);
        assertEq(treasury.idleBalance(), 100_000e6);
        assertEq(mal.balance(), 0);
    }

    function test_security_reentrantAdapter_withdrawFromWithdraw_reverts() public {
        _investMal(20_000e6);
        mal.arm(MaliciousAdapter.Attack.WITHDRAW, 1e6, false);
        bytes memory unauthorized = _unauthorizedAdapter();
        vm.prank(agent);
        vm.expectRevert(unauthorized);
        treasury.withdraw(address(mal), 5000e6);

        _grantAdapterAgentRole();
        vm.prank(agent);
        vm.expectRevert(REENTRANT);
        treasury.withdraw(address(mal), 5000e6);
        assertEq(mal.balance(), 20_000e6);
    }

    /// @dev pay() → _pullLiquidity → malicious withdraw → re-enter pay(): the re-entry fails, the obligation is paid once.
    function test_security_reentrantAdapter_payDuringPullLiquidity_paidOnce() public {
        _investMal(70_000e6);
        _warpToDay(7);
        vm.prank(keeper);
        treasury.pay(o1); // idle 30k → 10k
        _warpToDay(30);
        assertEq(treasury.idleBalance(), 10_000e6);

        // (a) re-entry revert bubbles out of the adapter: try/catch skips it, nothing is pulled, payment fails cleanly
        mal.arm(MaliciousAdapter.Attack.PAY, o2, false);
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(InsufficientLiquidity.selector, 20_000e6, 10_000e6));
        treasury.pay(o2);

        // (b) adapter swallows the failed re-entry and returns funds: outer payment succeeds exactly once
        mal.arm(MaliciousAdapter.Attack.PAY, o2, true);
        vm.prank(keeper);
        treasury.pay(o2);
        assertEq(mal.lastRevert(), REENTRANT);
        assertEq(mal.reentrySuccesses(), 0);
        assertEq(usdc.balanceOf(recipient2), 20_000e6);
        assertEq(registry.getObligation(o2).paidOccurrences, 1);
        assertEq(uint8(registry.getObligation(o2).status), uint8(ObligationStatus.COMPLETED));
    }

    function test_security_reentrantAdapter_duringEnforceDeadlines_skipped() public {
        _investMal(70_000e6);
        _warpToDay(7);
        vm.prank(keeper);
        treasury.pay(o1);
        _warpToDay(16);
        mal.arm(MaliciousAdapter.Attack.ENFORCE, 0, false);
        vm.expectEmit(true, false, false, true, address(treasury));
        emit ITreasury.AdapterWithdrawFailed(address(mal), 20_000e6, REENTRANT);
        vm.prank(keeper);
        assertEq(treasury.enforceDeadlines(), 0);
        assertEq(treasury.shortfall(), 20_000e6);
        assertEq(mal.reentrySuccesses(), 0);
    }

    // ---------------------------------------------------------------------------------------- ReentrantToken

    function _reentrantSystem()
        internal
        returns (Sys memory s, ReentrantToken token, ReentrantRecipient evil, uint256 id)
    {
        token = new ReentrantToken();
        s = _deployAltSystem(IERC20(address(token)), admin, agent, 100_000e6, 0);
        evil = new ReentrantRecipient(ITreasury(address(s.treasury)), token);
        uint64 t0 = s.treasury.currentTime();
        // daily recurring: after 10 days many occurrences are overdue, so a successful re-entry WOULD pay again
        vm.prank(admin);
        id = s.registry
            .createObligation(
                ObligationInput({
                    recipient: address(evil),
                    amount: 1000e6,
                    firstDueDate: t0 + 1 days,
                    interval: 1 days,
                    maxOccurrences: 0,
                    category: Category.VENDOR_INVOICE,
                    metadataHash: bytes32(0)
                })
            );
        _warpToDay(10);
        assertEq(s.registry.occurrencesDueUntil(id, s.treasury.currentTime()), 10);
    }

    function test_security_reentrantToken_pay() public {
        (Sys memory s, ReentrantToken token, ReentrantRecipient evil, uint256 id) = _reentrantSystem();

        // hook re-enters and does not swallow: the whole payment reverts
        evil.arm(id, false);
        vm.prank(keeper);
        vm.expectRevert(REENTRANT);
        s.treasury.pay(id);
        assertEq(s.registry.getObligation(id).paidOccurrences, 0);
        assertEq(token.balanceOf(address(evil)), 0);

        // hook re-enters and swallows: exactly one occurrence is paid
        evil.arm(id, true);
        vm.prank(keeper);
        s.treasury.pay(id);
        assertEq(evil.lastRevert(), REENTRANT);
        assertEq(evil.hookCalls(), 1);
        assertEq(s.registry.getObligation(id).paidOccurrences, 1);
        assertEq(token.balanceOf(address(evil)), 1000e6);
        assertEq(token.balanceOf(address(s.treasury)), 99_000e6);
    }
}
