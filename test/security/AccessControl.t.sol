// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ObligationInput, Category} from "../../contracts/interfaces/IObligationRegistry.sol";
import {AdapterStatus} from "../../contracts/interfaces/IPolicyEngine.sol";
import "../../contracts/libraries/Errors.sol";
import {Fixture} from "../utils/Fixture.sol";

/// @notice docs/10 §2.3 and docs/03 §3.3–§3.5, §3.13, §3.16: role matrix (docs/01 §7) enforcement.
contract AccessControlTest is Fixture {
    bytes32 internal constant ADMIN_ROLE = 0x00;
    bytes32 internal constant AGENT = keccak256("AGENT_ROLE");
    bytes32 internal constant TREASURY = keccak256("TREASURY_ROLE");

    address[] internal nonAdmins;
    address[] internal nonAgents;

    function setUp() public override {
        super.setUp();
        nonAdmins.push(agent);
        nonAdmins.push(keeper);
        nonAdmins.push(attacker);
        nonAgents.push(keeper);
        nonAgents.push(attacker);
        // give the adapter a position so withdraw paths are meaningful
        _invest(50_000e6);
    }

    function _unauthorized(address who, bytes32 role) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, who, role);
    }

    function _input(address recipient) internal view returns (ObligationInput memory) {
        return ObligationInput({
            recipient: recipient,
            amount: 1e6,
            firstDueDate: T0 + 1 days,
            interval: 0,
            maxOccurrences: 1,
            category: Category.OTHER,
            metadataHash: bytes32(0)
        });
    }

    /// @dev Calls `target` with `data` as `who` and asserts the exact AccessControl revert.
    function _expectUnauthorized(address who, address target, bytes memory data, bytes32 role) internal {
        vm.prank(who);
        (bool ok, bytes memory ret) = target.call(data);
        assertFalse(ok, "call should revert");
        assertEq(ret, _unauthorized(who, role));
    }

    // ---------------------------------------------------------------------------------------- ADMIN functions

    function test_access_adminFunctions_revertForNonAdmins() public {
        for (uint256 i = 0; i < nonAdmins.length; ++i) {
            address who = nonAdmins[i];
            // Treasury
            _expectUnauthorized(
                who, address(treasury), abi.encodeCall(treasury.grantRole, (AGENT, attacker)), ADMIN_ROLE
            );
            _expectUnauthorized(who, address(treasury), abi.encodeCall(treasury.revokeRole, (AGENT, agent)), ADMIN_ROLE);
            _expectUnauthorized(who, address(treasury), abi.encodeCall(treasury.resetCircuitBreaker, ()), ADMIN_ROLE);
            _expectUnauthorized(who, address(treasury), abi.encodeCall(treasury.setTimeOffset, (1 days)), ADMIN_ROLE);
            _expectUnauthorized(who, address(treasury), abi.encodeCall(treasury.advanceTime, (1 days)), ADMIN_ROLE);
            // PolicyEngine
            _expectUnauthorized(who, address(policy), abi.encodeCall(policy.grantRole, (ADMIN_ROLE, who)), ADMIN_ROLE);
            _expectUnauthorized(who, address(policy), abi.encodeCall(policy.setSafetyHorizon, (1 days)), ADMIN_ROLE);
            _expectUnauthorized(who, address(policy), abi.encodeCall(policy.setEmergencyBuffer, (0)), ADMIN_ROLE);
            _expectUnauthorized(who, address(policy), abi.encodeCall(policy.setMaxExposureBps, (10_000)), ADMIN_ROLE);
            _expectUnauthorized(
                who,
                address(policy),
                abi.encodeCall(policy.setAdapterStatus, (address(adapter), AdapterStatus.NONE)),
                ADMIN_ROLE
            );
            // ObligationRegistry
            _expectUnauthorized(who, address(registry), abi.encodeCall(registry.grantRole, (TREASURY, who)), ADMIN_ROLE);
            _expectUnauthorized(who, address(registry), abi.encodeCall(registry.setClock, (who)), ADMIN_ROLE);
            _expectUnauthorized(
                who, address(registry), abi.encodeCall(registry.createObligation, (_input(attacker))), ADMIN_ROLE
            );
            _expectUnauthorized(
                who,
                address(registry),
                abi.encodeCall(registry.updateObligation, (o1, attacker, 20_000e6, T0 + 7 days)),
                ADMIN_ROLE
            );
            _expectUnauthorized(who, address(registry), abi.encodeCall(registry.cancelObligation, (o1)), ADMIN_ROLE);
        }
        // nothing changed
        assertFalse(treasury.hasRole(AGENT, attacker));
        assertEq(treasury.timeOffset(), 0);
        assertEq(policy.maxExposureBps(), MAX_EXPOSURE_BPS);
        assertEq(registry.getObligation(o1).recipient, recipient1);
        assertEq(registry.activeObligationCount(), 3);
    }

    /// @dev docs/03 §3.3 — named list of ADMIN functions an AGENT key must not reach.
    function test_security_agentCannotCallAdminFunctions() public {
        _expectUnauthorized(agent, address(treasury), abi.encodeCall(treasury.grantRole, (AGENT, attacker)), ADMIN_ROLE);
        _expectUnauthorized(
            agent,
            address(policy),
            abi.encodeCall(policy.setAdapterStatus, (makeAddr("evilPool"), AdapterStatus.ACTIVE)),
            ADMIN_ROLE
        );
        _expectUnauthorized(agent, address(policy), abi.encodeCall(policy.setMaxExposureBps, (10_000)), ADMIN_ROLE);
        _expectUnauthorized(
            agent, address(registry), abi.encodeCall(registry.createObligation, (_input(attacker))), ADMIN_ROLE
        );
        _expectUnauthorized(agent, address(registry), abi.encodeCall(registry.cancelObligation, (o1)), ADMIN_ROLE);
        _expectUnauthorized(agent, address(treasury), abi.encodeCall(treasury.resetCircuitBreaker, ()), ADMIN_ROLE);
        _expectUnauthorized(agent, address(treasury), abi.encodeCall(treasury.setTimeOffset, (1 days)), ADMIN_ROLE);
    }

    function test_security_agentUpdateObligation_reverts() public {
        _expectUnauthorized(
            agent,
            address(registry),
            abi.encodeCall(registry.updateObligation, (o1, attacker, 20_000e6, T0 + 7 days)),
            ADMIN_ROLE
        );
        assertEq(registry.getObligation(o1).recipient, recipient1);
    }

    function test_access_roleRevocation_runbook() public {
        // docs/03 §3.3 incident runbook: trip → revoke → grant new → reset
        address newAgent = makeAddr("newAgent");
        vm.startPrank(admin);
        treasury.tripCircuitBreaker();
        treasury.revokeRole(AGENT, agent);
        treasury.grantRole(AGENT, newAgent);
        treasury.resetCircuitBreaker();
        vm.stopPrank();
        vm.prank(agent);
        vm.expectRevert(_unauthorized(agent, AGENT));
        treasury.invest(address(adapter), 1e6);
        vm.prank(newAgent);
        treasury.invest(address(adapter), 1e6);
    }

    // ---------------------------------------------------------------------------------------- AGENT functions

    function test_access_agentFunctions_revertForKeeperAndAttacker() public {
        for (uint256 i = 0; i < nonAgents.length; ++i) {
            address who = nonAgents[i];
            _expectUnauthorized(who, address(treasury), abi.encodeCall(treasury.invest, (address(adapter), 1e6)), AGENT);
            _expectUnauthorized(
                who, address(treasury), abi.encodeCall(treasury.withdraw, (address(adapter), 1e6)), AGENT
            );
            _expectUnauthorized(
                who, address(treasury), abi.encodeCall(treasury.withdraw, (address(adapter), type(uint256).max)), AGENT
            );
            _expectUnauthorized(who, address(treasury), abi.encodeCall(treasury.tripCircuitBreaker, ()), AGENT);
        }
        assertFalse(treasury.circuitBreakerActive());
        assertEq(treasury.idleBalance(), 50_000e6);
    }

    /// @dev docs/03 §3.4.
    function test_security_randomWithdraw_reverts() public {
        vm.prank(attacker);
        vm.expectRevert(_unauthorized(attacker, AGENT));
        treasury.withdraw(address(adapter), 10_000e6);
        vm.prank(attacker);
        vm.expectRevert(NotTreasury.selector);
        adapter.withdraw(10_000e6);
        assertEq(usdc.balanceOf(attacker), 0);
        assertEq(treasury.vaultBalance(address(adapter)), 50_000e6);
    }

    // ---------------------------------------------------------------------------------------- Treasury-only paths

    function test_access_markPaid_onlyTreasury() public {
        _warpToDay(7);
        address[4] memory callers = [admin, agent, keeper, attacker];
        for (uint256 i = 0; i < callers.length; ++i) {
            _expectUnauthorized(callers[i], address(registry), abi.encodeCall(registry.markPaid, (o1)), TREASURY);
        }
        assertEq(registry.getObligation(o1).paidOccurrences, 0);
    }

    function test_access_adapterDepositWithdraw_onlyTreasury() public {
        address[4] memory callers = [admin, agent, keeper, attacker];
        for (uint256 i = 0; i < callers.length; ++i) {
            vm.prank(callers[i]);
            vm.expectRevert(NotTreasury.selector);
            adapter.deposit(1e6);
            vm.prank(callers[i]);
            vm.expectRevert(NotTreasury.selector);
            adapter.withdraw(1e6);
        }
    }

    function test_access_poolControls_onlyOwner() public {
        address[3] memory callers = [agent, keeper, attacker];
        for (uint256 i = 0; i < callers.length; ++i) {
            address who = callers[i];
            bytes memory err = abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, who);
            vm.startPrank(who);
            vm.expectRevert(err);
            pool.setAPY(0);
            vm.expectRevert(err);
            pool.setPaused(true);
            vm.expectRevert(err);
            pool.setUtilization(10_000);
            vm.expectRevert(err);
            pool.setLiquidityShortage(true);
            vm.expectRevert(err);
            usdc.mint(who, 1e6);
            vm.stopPrank();
        }
        assertEq(pool.apyBps(), 800);
        assertFalse(pool.paused());
    }

    // ---------------------------------------------------------------------------------------- breaker & time

    function test_breaker_agentCannotReset() public {
        vm.prank(agent);
        treasury.tripCircuitBreaker();
        _expectUnauthorized(agent, address(treasury), abi.encodeCall(treasury.resetCircuitBreaker, ()), ADMIN_ROLE);
        _expectUnauthorized(keeper, address(treasury), abi.encodeCall(treasury.resetCircuitBreaker, ()), ADMIN_ROLE);
        assertTrue(treasury.circuitBreakerActive());
        vm.prank(admin);
        treasury.resetCircuitBreaker();
        assertFalse(treasury.circuitBreakerActive());
    }

    function test_timeOffset_onlyAdmin() public {
        for (uint256 i = 0; i < nonAdmins.length; ++i) {
            _expectUnauthorized(
                nonAdmins[i], address(treasury), abi.encodeCall(treasury.setTimeOffset, (30 days)), ADMIN_ROLE
            );
            _expectUnauthorized(
                nonAdmins[i], address(treasury), abi.encodeCall(treasury.advanceTime, (30 days)), ADMIN_ROLE
            );
        }
        assertEq(treasury.timeOffset(), 0);
        vm.prank(admin);
        treasury.advanceTime(30 days);
        assertEq(treasury.currentTime(), T0 + 30 days);
    }

    function test_timeOffset_cannotDecrease() public {
        vm.startPrank(admin);
        treasury.setTimeOffset(10 days);
        vm.expectRevert(abi.encodeWithSelector(InvalidTimeOffset.selector, uint64(10 days), uint64(9 days)));
        treasury.setTimeOffset(9 days);
        vm.expectRevert(abi.encodeWithSelector(InvalidTimeOffset.selector, uint64(10 days), uint64(365 days + 1)));
        treasury.setTimeOffset(365 days + 1);
        // advanceTime saturates instead of overflowing, then reports the bound
        vm.expectRevert(abi.encodeWithSelector(InvalidTimeOffset.selector, uint64(10 days), type(uint64).max));
        treasury.advanceTime(type(uint64).max);
        vm.stopPrank();
        assertEq(treasury.timeOffset(), 10 days);
    }
}
