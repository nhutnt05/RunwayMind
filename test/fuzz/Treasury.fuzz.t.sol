// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Obligation, Category} from "../../contracts/interfaces/IObligationRegistry.sol";
import {Fixture} from "../utils/Fixture.sol";

/// @notice docs/10 §2.7 — full-system fuzz tests on the Treasury.
/// @dev The other three §2.7 properties live next to their unit suites (same names):
///      testFuzz_registry_occurrencesDueUntil (test/unit/ObligationRegistry.t.sol),
///      testFuzz_policy_checkInvest (test/unit/PolicyEngine.t.sol), testFuzz_pool_noValueCreation
///      (test/unit/MockLendingPool.t.sol).
contract TreasuryFuzzTest is Fixture {
    /// @dev Random sequence of invest attempts interleaved with time steps, keeper enforcement and payments.
    ///      After each successful invest: idle >= requiredReserve(now) (R1) and adapter balance <= cap (R3); and an
    ///      invest succeeds iff amount <= maxInvestable (no false rejects either).
    function testFuzz_investSequence_neverBreaksReserve(
        uint256[10] memory amounts,
        uint8[10] memory daySteps,
        bool[10] memory keeperActs,
        uint16 exposureBps
    ) public {
        vm.prank(admin);
        policy.setMaxExposureBps(uint16(bound(exposureBps, 1, 10_000)));
        uint256 day;
        for (uint256 i = 0; i < amounts.length; ++i) {
            day += bound(daySteps[i], 0, 6);
            _warpToDay(day);
            if (keeperActs[i]) {
                // keeper pays whatever is due and restores the reserve
                for (uint256 id = 1; id <= 3; ++id) {
                    try treasury.pay(id) {} catch {}
                }
                treasury.enforceDeadlines();
            }

            uint256 idle = treasury.idleBalance();
            if (idle == 0) continue;
            uint256 amount = bound(amounts[i], 1, idle);
            uint256 maxInv = treasury.maxInvestable(address(adapter));
            uint256 capBefore = (treasury.totalAssets() * policy.maxExposureBps()) / 10_000;

            vm.prank(agent);
            try treasury.invest(address(adapter), amount) {
                assertLe(amount, maxInv, "invest above maxInvestable succeeded");
                assertGe(treasury.idleBalance(), treasury.requiredReserve(), "R1 broken after invest");
                assertLe(treasury.vaultBalance(address(adapter)), capBefore, "R3 broken after invest");
            } catch {
                assertGt(amount, maxInv, "invest within policy was rejected");
            }
        }
    }

    /// @dev Random obligation set (one-time and recurring, random recipients/amounts/dates); a random caller pays
    ///      everything it can over 120 days. Tokens only ever leave the Treasury to registered recipients, each
    ///      receives exactly amount × paidOccurrences, and nothing else gains a balance.
    function testFuzz_pay_onlyRegisteredRecipient(
        uint256 seed,
        uint8 n,
        uint64[6] memory dueDays,
        uint256[6] memory amts,
        uint8[6] memory kinds,
        address caller,
        bool investFirst
    ) public {
        vm.assume(caller != address(0) && caller != address(treasury) && caller != address(pool));
        n = uint8(bound(n, 1, 6));
        uint256 firstNew = registry.obligationCount() + 1;
        for (uint256 i = 0; i < n; ++i) {
            address r = address(uint160(uint256(keccak256(abi.encode(seed, i)))));
            uint64 due = T0 + uint64(bound(dueDays[i], 1, 60)) * 1 days;
            uint256 amount = bound(amts[i], 1, 15_000e6);
            uint8 kind = kinds[i] % 3;
            if (kind == 0) {
                _create(r, amount, due, Category.VENDOR_INVOICE);
            } else {
                uint64 interval = uint64(bound(kinds[i], 1, 30)) * 1 days;
                _createRecurring(r, amount, due, interval, kind == 1 ? 0 : uint32(bound(kinds[i], 2, 5)));
            }
        }
        vm.assume(caller.code.length == 0);
        for (uint256 id = 1; id <= registry.obligationCount(); ++id) {
            vm.assume(caller != registry.getObligation(id).recipient);
        }

        if (investFirst) {
            uint256 m = treasury.maxInvestable(address(adapter));
            if (m > 0) _invest(m);
        }

        uint256 count = registry.obligationCount();
        uint256[] memory expected = new uint256[](count + 1);
        for (uint256 d = 1; d <= 120; d += 3) {
            _warpToDay(d);
            treasury.enforceDeadlines();
            for (uint256 id = 1; id <= count + 1; ++id) {
                // a few overdue recurring occurrences per step
                for (uint256 k = 0; k < 3; ++k) {
                    vm.prank(caller);
                    try treasury.pay(id) {
                        expected[id] += registry.getObligation(id).amount;
                    } catch {
                        break;
                    }
                }
            }
        }

        uint256 paidTotal;
        for (uint256 id = 1; id <= count; ++id) {
            Obligation memory ob = registry.getObligation(id);
            assertEq(expected[id], ob.amount * ob.paidOccurrences, "paid == amount x occurrences");
            assertEq(usdc.balanceOf(ob.recipient), expected[id], "recipient received only its payments");
            paidTotal += expected[id];
        }
        assertGe(count, firstNew);
        assertEq(usdc.balanceOf(caller), 0);
        assertEq(usdc.balanceOf(attacker), 0);
        assertEq(usdc.balanceOf(agent), 0);
        assertEq(usdc.balanceOf(keeper), 0);
        assertEq(usdc.balanceOf(admin), 0);
        assertEq(usdc.balanceOf(address(adapter)), 0);
        // conservation: every token is in Treasury, the pool, or with a registered recipient
        assertEq(usdc.balanceOf(address(treasury)) + usdc.balanceOf(address(pool)) + paidTotal, usdc.totalSupply());
    }
}
