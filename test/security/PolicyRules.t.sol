// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {ITreasury} from "../../contracts/interfaces/ITreasury.sol";
import {AdapterStatus} from "../../contracts/interfaces/IPolicyEngine.sol";
import "../../contracts/libraries/Errors.sol";
import {Fixture} from "../utils/Fixture.sol";
import {RogueAdapter} from "../utils/RogueAdapter.sol";

/// @notice docs/10 §2.5 (one test per rule R1–R6, boundaries included) plus the policy/pool threats of docs/03 §3.
contract PolicyRulesTest is Fixture {
    // ======================================================================================== R1 reserve ratio

    function test_R1_exactBoundaryPasses() public {
        // idleAfter == requiredReserve is allowed
        _invest(70_000e6);
        assertEq(treasury.idleBalance(), treasury.requiredReserve());
    }

    function test_R1_oneUnitOverReverts() public {
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(ReserveViolation.selector, 30_000e6 - 1, 30_000e6));
        treasury.invest(address(adapter), 70_000e6 + 1);
        assertEq(treasury.idleBalance(), 100_000e6);
    }

    /// @dev docs/03 §3.1.
    function test_security_agentInvestBeyondReserve_reverts() public {
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(ReserveViolation.selector, 10_000e6, 30_000e6));
        treasury.invest(address(adapter), 90_000e6);
        assertEq(treasury.idleBalance(), 100_000e6);
    }

    /// @dev docs/03 §3.6 — splitting into small investments cannot bypass R1.
    function test_R1_sequenceOfSmallInvestsCannotBypass() public {
        for (uint256 i = 0; i < 7; ++i) {
            _invest(10_000e6);
        }
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(ReserveViolation.selector, 30_000e6 - 1, 30_000e6));
        treasury.invest(address(adapter), 1);
        assertEq(treasury.idleBalance(), 30_000e6);
    }

    // ======================================================================================== R2 deadlines

    function test_R2_shortfallAtDeadline() public {
        _invest(70_000e6);
        _warpToDay(7);
        vm.prank(keeper);
        treasury.pay(o1);
        assertEq(policy.withdrawalDeadline(T0 + 30 days), T0 + 16 days);

        _warpToDay(15);
        assertEq(treasury.shortfall(), 0, "before deadline");
        vm.warp(START_TIMESTAMP + 16 days - 1);
        assertEq(treasury.shortfall(), 0, "one second before deadline");
        _warpToDay(16);
        assertEq(treasury.shortfall(), 20_000e6, "at deadline (inclusive)");

        vm.prank(attacker); // anyone
        assertEq(treasury.enforceDeadlines(), 20_000e6);
        assertEq(treasury.shortfall(), 0);
        assertEq(treasury.idleBalance(), 30_000e6);
    }

    /// @dev R2 also holds when time moves via the DEMO offset instead of chain time.
    function test_R2_demoTimeOffsetMovesWindow() public {
        _invest(70_000e6);
        vm.prank(admin);
        treasury.advanceTime(16 days);
        // O1 (overdue, unpaid) + O2 + buffer
        assertEq(treasury.requiredReserve(), 50_000e6);
        assertEq(treasury.shortfall(), 20_000e6);
        treasury.enforceDeadlines();
        assertEq(treasury.shortfall(), 0);
    }

    // ======================================================================================== R3 exposure

    function test_R3_inclusiveCap() public {
        vm.prank(admin);
        policy.setMaxExposureBps(5000);
        _invest(50_000e6); // == cap, allowed
        assertEq(treasury.vaultBalance(address(adapter)), 50_000e6);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(ExposureLimitExceeded.selector, 50_000e6 + 1, 50_000e6));
        treasury.invest(address(adapter), 1);
    }

    /// @dev docs/03 §3.8.
    function test_security_exceedExposure_reverts() public {
        vm.startPrank(admin);
        policy.setMaxExposureBps(5000);
        policy.setEmergencyBuffer(0); // reserve low: only O1 (20k) in window → R1 allows up to 80k
        vm.stopPrank();
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(ExposureLimitExceeded.selector, 60_000e6, 50_000e6));
        treasury.invest(address(adapter), 60_000e6);
        assertEq(treasury.vaultBalance(address(adapter)), 0);
    }

    /// @dev docs/03 §3.15 — cap = floor(totalAssets × bps / 10_000).
    function test_policy_exposureCapRoundsDown() public {
        vm.prank(admin);
        usdc.mint(address(treasury), 1); // totalAssets = 100,000.000001
        vm.prank(admin);
        policy.setMaxExposureBps(3333);
        uint256 cap = (uint256(100_000e6 + 1) * 3333) / 10_000; // 33,330.000000333… → 33,330.000000
        assertEq(cap, 33_330e6);
        assertEq(treasury.maxInvestable(address(adapter)), cap);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(ExposureLimitExceeded.selector, cap + 1, cap));
        treasury.invest(address(adapter), cap + 1);
        _invest(cap);
    }

    // ======================================================================================== R4 whitelist

    function test_R4_withdrawOnlyBlocksInvest() public {
        _invest(70_000e6);
        vm.prank(admin);
        policy.setAdapterStatus(address(adapter), AdapterStatus.WITHDRAW_ONLY);

        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(AdapterNotWhitelisted.selector, address(adapter)));
        treasury.invest(address(adapter), 1e6);
        assertEq(treasury.maxInvestable(address(adapter)), 0);
        // still counted and still withdrawable
        assertEq(treasury.totalAssets(), 100_000e6);
        vm.prank(agent);
        assertEq(treasury.withdraw(address(adapter), 5000e6), 5000e6);
        // and enforceDeadlines still pulls from it
        _warpToDay(7);
        treasury.pay(o1);
        _warpToDay(16);
        assertEq(treasury.enforceDeadlines(), 15_000e6);
        assertEq(treasury.shortfall(), 0);
    }

    /// @dev docs/03 §3.7 / mandatory #3 variant: unknown adapter code is never executed.
    function test_security_nonWhitelistedPool_reverts() public {
        RogueAdapter rogue = new RogueAdapter(address(usdc), address(treasury));
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(AdapterNotWhitelisted.selector, address(rogue)));
        treasury.invest(address(rogue), 10_000e6);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(AdapterUnknown.selector, address(rogue)));
        treasury.withdraw(address(rogue), 10_000e6);
        assertEq(rogue.calls(), 0);
        assertEq(treasury.vaultBalance(address(rogue)), 0);
    }

    // ======================================================================================== R5 no external transfer

    /// @dev Extracts the external-function selectors from the dispatcher of `code`. solc emits one
    ///      `DUP1 PUSHn <sel> EQ PUSH2 <dest> JUMPI` per external function (n < 4 when the selector has leading zero
    ///      bytes, e.g. MAX_TIME_OFFSET() = 0x00173dfb).
    function _dispatcherSelectors(bytes memory code) internal pure returns (bytes4[] memory out) {
        bytes4[] memory tmp = new bytes4[](128);
        uint256 n;
        uint256 i;
        while (i < code.length) {
            uint8 op = uint8(code[i]);
            if (op == 0xfe) break; // INVALID: end of runtime code, metadata follows
            if (op >= 0x60 && op <= 0x63 && i > 0 && uint8(code[i - 1]) == 0x80) {
                uint256 len = op - 0x5f;
                uint256 j = i + 1 + len; // EQ, PUSH2 hi lo, JUMPI
                if (
                    j + 4 < code.length && uint8(code[j]) == 0x14 && uint8(code[j + 1]) == 0x61
                        && uint8(code[j + 4]) == 0x57
                ) {
                    uint32 v;
                    for (uint256 k = 0; k < len; ++k) {
                        v = (v << 8) | uint32(uint8(code[i + 1 + k]));
                    }
                    bytes4 sel = bytes4(v);
                    bool dup;
                    for (uint256 k = 0; k < n; ++k) {
                        if (tmp[k] == sel) dup = true;
                    }
                    if (!dup) tmp[n++] = sel;
                }
            }
            if (op >= 0x60 && op <= 0x7f) i += op - 0x5f; // skip PUSHn data
            ++i;
        }
        out = new bytes4[](n);
        for (uint256 k = 0; k < n; ++k) {
            out[k] = tmp[k];
        }
    }

    function _abiSelectors() internal pure returns (bytes4[] memory s) {
        // `forge inspect Treasury methodIdentifiers` (30 functions)
        s = new bytes4[](30);
        s[0] = 0x22459e18; // AGENT_ROLE()
        s[1] = 0xa217fddf; // DEFAULT_ADMIN_ROLE()
        s[2] = 0x00173dfb; // MAX_TIME_OFFSET()
        s[3] = 0xaa57c8df; // advanceTime(uint64)
        s[4] = 0x38d52e0f; // asset()
        s[5] = 0xf609844d; // circuitBreakerActive()
        s[6] = 0xd18e81b3; // currentTime()
        s[7] = 0x44ba06d5; // demoMode()
        s[8] = 0x7f645f35; // enforceDeadlines()
        s[9] = 0x248a9ca3; // getRoleAdmin(bytes32)
        s[10] = 0x2f2ff15d; // grantRole(bytes32,address)
        s[11] = 0x91d14854; // hasRole(bytes32,address)
        s[12] = 0xb1bbb310; // idleBalance()
        s[13] = 0xb9b8c246; // invest(address,uint256)
        s[14] = 0x9377577d; // maxInvestable(address)
        s[15] = 0xc290d691; // pay(uint256)
        s[16] = 0x0505c8c9; // policy()
        s[17] = 0x7b103999; // registry()
        s[18] = 0x36568abe; // renounceRole(bytes32,address)
        s[19] = 0x2a0e37c2; // requiredReserve()
        s[20] = 0xde5f8d93; // resetCircuitBreaker()
        s[21] = 0xd547741f; // revokeRole(bytes32,address)
        s[22] = 0x990fbfaa; // setTimeOffset(uint64)
        s[23] = 0x19b1faef; // shortfall()
        s[24] = 0x01ffc9a7; // supportsInterface(bytes4)
        s[25] = 0xa438b0e5; // timeOffset()
        s[26] = 0x01e1d114; // totalAssets()
        s[27] = 0x59ab0321; // tripCircuitBreaker()
        s[28] = 0xed0fe416; // vaultBalance(address)
        s[29] = 0xf3fef3a3; // withdraw(address,uint256)
    }

    function _contains(bytes4[] memory arr, bytes4 x) internal pure returns (bool) {
        for (uint256 i = 0; i < arr.length; ++i) {
            if (arr[i] == x) return true;
        }
        return false;
    }

    function _systemBalance() internal view returns (uint256) {
        return usdc.balanceOf(address(treasury)) + usdc.balanceOf(address(pool)) + usdc.balanceOf(recipient1)
            + usdc.balanceOf(recipient2) + usdc.balanceOf(recipient3);
    }

    function test_R5_noSelectorTransfersFunds() public {
        bytes4[] memory sels = _dispatcherSelectors(address(treasury).code);
        bytes4[] memory abiSels = _abiSelectors();
        // the scanned dispatcher and the ABI agree: every callable selector is exercised below
        for (uint256 i = 0; i < abiSels.length; ++i) {
            assertTrue(_contains(sels, abiSels[i]), "ABI selector missing from dispatcher scan");
        }
        for (uint256 i = 0; i < sels.length; ++i) {
            assertTrue(_contains(abiSels, sels[i]), "dispatcher exposes a selector not in the ABI");
        }
        assertEq(sels.length, 30);
        // no generic transfer / approve / execute / sweep entry point exists
        assertFalse(_contains(sels, bytes4(keccak256("transfer(address,uint256)"))));
        assertFalse(_contains(sels, bytes4(keccak256("transferFrom(address,address,uint256)"))));
        assertFalse(_contains(sels, bytes4(keccak256("approve(address,uint256)"))));
        assertFalse(_contains(sels, bytes4(keccak256("execute(address,uint256,bytes)"))));
        assertFalse(_contains(sels, bytes4(keccak256("sweep(address,address)"))));

        _invest(70_000e6);
        _warpToDay(60); // every seeded obligation is due, so pay() paths really move tokens (to recipients)
        uint256 supplyInSystem = _systemBalance();

        bytes[] memory args = new bytes[](7);
        args[0] = "";
        args[1] = abi.encode(attacker, 50_000e6);
        args[2] = abi.encode(address(adapter), 50_000e6);
        args[3] = abi.encode(uint256(uint160(attacker)));
        args[4] = abi.encode(uint256(1));
        args[5] = abi.encode(keccak256("AGENT_ROLE"), attacker);
        args[6] = abi.encode(address(adapter), type(uint256).max);
        address[4] memory callers = [attacker, agent, keeper, admin];

        for (uint256 c = 0; c < callers.length; ++c) {
            for (uint256 i = 0; i < sels.length; ++i) {
                for (uint256 a = 0; a < args.length; ++a) {
                    vm.prank(callers[c]);
                    (bool ok,) = address(treasury).call(abi.encodePacked(sels[i], args[a]));
                    ok; // success or failure is irrelevant; only token movement matters
                    assertEq(usdc.balanceOf(attacker), 0, "attacker received tokens");
                }
            }
            // also unknown selectors / plain value-less calls hit no fallback
            vm.prank(callers[c]);
            (bool ok2,) = address(treasury).call(abi.encodeWithSignature("transfer(address,uint256)", attacker, 1));
            assertFalse(ok2);
        }
        // every token is still in Treasury, pool, or with a registered recipient
        assertEq(_systemBalance(), supplyInSystem);
        assertEq(usdc.balanceOf(attacker) + usdc.balanceOf(agent) + usdc.balanceOf(keeper) + usdc.balanceOf(admin), 0);
        assertEq(usdc.totalSupply(), supplyInSystem);
    }

    /// @dev docs/03 §3.2.
    function test_security_agentTransferToAttacker_allVectorsRevert() public {
        _invest(50_000e6);
        uint256 idle = treasury.idleBalance();
        vm.startPrank(agent);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, agent, 0, 50_000e6));
        usdc.transferFrom(address(treasury), attacker, 50_000e6);
        vm.expectRevert(NotTreasury.selector);
        adapter.withdraw(50_000e6);
        (bool ok,) = address(treasury).call(abi.encodeWithSignature("transfer(address,uint256)", attacker, 50_000e6));
        assertFalse(ok);
        vm.expectRevert(abi.encodeWithSelector(UnknownObligation.selector, 999));
        treasury.pay(999);
        vm.stopPrank();
        assertEq(usdc.balanceOf(attacker), 0);
        assertEq(treasury.idleBalance(), idle);
        assertEq(treasury.vaultBalance(address(adapter)), 50_000e6);
    }

    /// @dev docs/03 §3.5.
    function test_security_payUnregisteredRecipient_reverts() public {
        uint256 fakeId = uint256(uint160(attacker));
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(UnknownObligation.selector, fakeId));
        treasury.pay(fakeId);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(UnknownObligation.selector, 0));
        treasury.pay(0);
        assertEq(usdc.balanceOf(attacker), 0);
    }

    // ======================================================================================== R6 circuit breaker

    function test_R6_breakerBlocksOnlyInvest() public {
        _invest(70_000e6);
        vm.prank(agent);
        treasury.tripCircuitBreaker();
        assertEq(treasury.maxInvestable(address(adapter)), 0);

        vm.prank(agent);
        vm.expectRevert(CircuitBreakerActive.selector);
        treasury.invest(address(adapter), 1);
        // admin is blocked too
        vm.prank(admin);
        vm.expectRevert(CircuitBreakerActive.selector);
        treasury.invest(address(adapter), 1);

        // withdraw, pay, enforceDeadlines still work
        vm.prank(agent);
        assertEq(treasury.withdraw(address(adapter), 5000e6), 5000e6);
        _warpToDay(7);
        treasury.pay(o1);
        _warpToDay(16);
        assertEq(treasury.enforceDeadlines(), 15_000e6);
        assertEq(treasury.shortfall(), 0);

        vm.prank(admin);
        treasury.resetCircuitBreaker();
        assertFalse(treasury.circuitBreakerActive());
    }

    function test_breaker_blocksInvest() public {
        vm.prank(admin);
        treasury.tripCircuitBreaker();
        vm.prank(agent);
        vm.expectRevert(CircuitBreakerActive.selector);
        treasury.invest(address(adapter), 10_000e6);
        // tripping is idempotent
        vm.prank(agent);
        treasury.tripCircuitBreaker();
        assertTrue(treasury.circuitBreakerActive());
    }

    function test_breaker_allowsWithdrawAndPay() public {
        _invest(70_000e6);
        vm.prank(agent);
        treasury.tripCircuitBreaker();
        vm.prank(agent);
        treasury.withdraw(address(adapter), type(uint256).max);
        assertEq(treasury.vaultBalance(address(adapter)), 0);
        _warpToDay(7);
        vm.prank(keeper);
        treasury.pay(o1);
        assertEq(usdc.balanceOf(recipient1), 20_000e6);
    }

    // ======================================================================================== pool failures (§3.9–§3.11)

    function test_security_poolInsolvent_payrollWithinHorizonStillPaid() public {
        _invest(70_000e6);
        deal(address(usdc), address(pool), 0); // third party drains the pool
        assertEq(adapter.availableLiquidity(), 0);
        _warpToDay(7);
        vm.prank(keeper);
        treasury.pay(o1); // due within H at investment time → was kept idle
        assertEq(usdc.balanceOf(recipient1), 20_000e6);
        // the loss is bounded to the invested portion; enforcement cannot pull anything but does not revert
        _warpToDay(16);
        assertEq(treasury.enforceDeadlines(), 0);
        assertEq(treasury.shortfall(), 20_000e6);
    }

    function test_security_poolPaused_paymentsWithinHorizonSucceed() public {
        _invest(70_000e6);
        vm.prank(admin);
        pool.setPaused(true);
        _warpToDay(7);
        vm.prank(keeper);
        treasury.pay(o1);
        assertEq(usdc.balanceOf(recipient1), 20_000e6);

        _warpToDay(16);
        vm.expectEmit(true, false, false, true, address(treasury));
        emit ITreasury.AdapterWithdrawFailed(address(adapter), 20_000e6, abi.encodeWithSelector(PoolPaused.selector));
        assertEq(treasury.enforceDeadlines(), 0);

        // pool resumes → enforcement catches up
        vm.prank(admin);
        pool.setPaused(false);
        assertEq(treasury.enforceDeadlines(), 20_000e6);
        assertEq(treasury.shortfall(), 0);
    }

    function test_security_fullUtilization_withdrawReverts_paymentsFromIdleSucceed() public {
        _invest(70_000e6);
        vm.startPrank(admin);
        pool.setLiquidityShortage(true);
        pool.setUtilization(10_000);
        vm.stopPrank();
        assertEq(adapter.availableLiquidity(), 0);

        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(InsufficientPoolLiquidity.selector, 1000e6, 0));
        treasury.withdraw(address(adapter), 1000e6);

        _warpToDay(7);
        vm.prank(keeper);
        treasury.pay(o1);
        assertEq(usdc.balanceOf(recipient1), 20_000e6);
    }
}
