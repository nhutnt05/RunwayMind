// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ITreasury} from "../../contracts/interfaces/ITreasury.sol";
import {Obligation, ObligationStatus} from "../../contracts/interfaces/IObligationRegistry.sol";
import "../../contracts/libraries/Errors.sol";
import {Fixture} from "../utils/Fixture.sol";
import {AltAssetSystem, Sys} from "../utils/AltAssetSystem.sol";

/// @notice Stand-in for native Circle USDC on Fuji: a plain, unowned 6-decimal ERC-20 (docs/10 §2.2 last row).
contract SixDecimalToken is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}

/// @notice docs/10 §2.2 — end-to-end Cash Ladder flows over the full system.
contract CashLadderFlowTest is Fixture, AltAssetSystem {
    function setUp() public override {
        super.setUp();
    }

    function _fixtureSys() internal view returns (Sys memory) {
        return Sys({
            token: IERC20(address(usdc)),
            registry: registry,
            policy: policy,
            treasury: treasury,
            pool: pool,
            adapter: adapter
        });
    }

    /// @dev SRC example (docs/04): D0 invest 70k → D7 pay O1 → D16 enforce (20k) → D30 pay O2 → D31 enforce (10k)
    ///      → D45 pay O3. Shared by the MockUSDC and the "real USDC shaped" runs.
    function _runSrcLifecycle(Sys memory s, uint256 id1, uint256 id2, uint256 id3) internal {
        ITreasury t = ITreasury(address(s.treasury));
        address a = address(s.adapter);

        // D0
        assertEq(t.idleBalance(), 100_000e6);
        assertEq(t.requiredReserve(), 30_000e6);
        assertEq(t.maxInvestable(a), 70_000e6);
        vm.prank(agent);
        t.invest(a, 70_000e6);
        assertEq(t.idleBalance(), 30_000e6);
        assertEq(t.shortfall(), 0);

        // D7 — pay O1 from idle
        _warpToDay(7);
        vm.prank(keeper);
        t.pay(id1);
        assertEq(s.token.balanceOf(recipient1), 20_000e6);
        assertEq(t.idleBalance(), 10_000e6);
        assertEq(t.requiredReserve(), 10_000e6, "only the buffer inside the D7..D21 window");
        vm.prank(keeper);
        assertEq(t.enforceDeadlines(), 0, "no shortfall at D7");

        // D15 — one day before the O2 deadline: still nothing to do
        _warpToDay(15);
        assertEq(t.shortfall(), 0);

        // D16 — O2 enters the 14-day window: withdraw exactly 20,000
        _warpToDay(16);
        assertEq(t.shortfall(), 20_000e6);
        vm.expectEmit(true, false, false, true, address(t));
        emit ITreasury.DeadlineEnforced(keeper, 20_000e6, 20_000e6);
        vm.prank(keeper);
        uint256 w16 = t.enforceDeadlines();
        assertEq(w16, 20_000e6, "withdrawal at D16");
        assertEq(t.idleBalance(), 30_000e6);
        assertEq(t.shortfall(), 0);

        // D30 — pay O2
        _warpToDay(30);
        vm.prank(keeper);
        t.pay(id2);
        assertEq(s.token.balanceOf(recipient2), 20_000e6);
        assertEq(t.idleBalance(), 10_000e6);

        // D31 — O3 enters the window: withdraw exactly 10,000
        _warpToDay(31);
        assertEq(t.shortfall(), 10_000e6);
        vm.prank(keeper);
        uint256 w31 = t.enforceDeadlines();
        assertEq(w31, 10_000e6, "withdrawal at D31");
        assertEq(t.idleBalance(), 20_000e6);
        assertEq(t.shortfall(), 0);

        // D45 — pay O3
        _warpToDay(45);
        vm.prank(keeper);
        t.pay(id3);
        assertEq(s.token.balanceOf(recipient3), 10_000e6);
        assertEq(t.idleBalance(), 10_000e6);
        assertEq(t.shortfall(), 0);

        // all obligations completed; the remaining position (40k principal) has earned interest
        assertEq(s.registry.activeObligationCount(), 0);
        assertEq(uint8(s.registry.getObligation(id1).status), uint8(ObligationStatus.COMPLETED));
        assertEq(uint8(s.registry.getObligation(id2).status), uint8(ObligationStatus.COMPLETED));
        assertEq(uint8(s.registry.getObligation(id3).status), uint8(ObligationStatus.COMPLETED));
        assertGt(t.vaultBalance(a), 40_000e6);
        assertGt(t.totalAssets(), 50_000e6);
    }

    function test_flow_srcExample_fullLifecycle() public {
        _runSrcLifecycle(_fixtureSys(), o1, o2, o3);
    }

    /// @dev REQ-071 / docs/12 §5.
    function test_flow_originalEightSteps() public {
        // 1. Treasury holds 100,000 mUSDC
        assertEq(treasury.idleBalance(), 100_000e6);
        // 2. three registered payments at day 7 / 30 / 45
        assertEq(registry.activeObligationCount(), 3);
        assertEq(registry.getObligation(o1).nextDueDate, T0 + 7 days);
        assertEq(registry.getObligation(o2).nextDueDate, T0 + 30 days);
        assertEq(registry.getObligation(o3).nextDueDate, T0 + 45 days);
        // 3. amount to keep
        assertEq(treasury.requiredReserve(), 30_000e6);
        uint256 surplus = treasury.maxInvestable(address(adapter));
        assertEq(surplus, 70_000e6);
        // 4. invest surplus
        _invest(surplus);
        assertEq(treasury.vaultBalance(address(adapter)), 70_000e6);
        // 5. sharp APY drop (pool operator)
        _warpToDay(2);
        vm.prank(admin);
        pool.setAPY(100);
        assertEq(adapter.getAPY(), 100);
        // 6. agent moves funds back to the Treasury
        vm.prank(agent);
        uint256 received = treasury.withdraw(address(adapter), 20_000e6);
        assertEq(received, 20_000e6);
        assertEq(treasury.idleBalance(), 50_000e6);
        // 7. contract rejects an investment that would violate the reserve
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(ReserveViolation.selector, 30_000e6 - 1, 30_000e6));
        treasury.invest(address(adapter), 20_000e6 + 1);
        assertEq(treasury.idleBalance(), 50_000e6);
        // 8. pay the registered amount on its due date
        _warpToDay(7);
        vm.prank(keeper);
        treasury.pay(o1);
        assertEq(usdc.balanceOf(recipient1), 20_000e6);
        assertEq(treasury.idleBalance(), 30_000e6);
    }

    function test_flow_recurringPayroll_threeMonths() public {
        // isolate the payroll stream: only O1 + payroll remain (110k of obligations would exceed the 100k treasury)
        vm.startPrank(admin);
        registry.cancelObligation(o2);
        registry.cancelObligation(o3);
        vm.stopPrank();
        address payroll = makeAddr("payrollRecipient");
        uint64 first = T0 + 10 days;
        uint256 id = _createRecurring(payroll, 20_000e6, first, 30 days, 0);
        // window D0..D14: O1 20k + payroll 20k + buffer 10k
        assertEq(treasury.requiredReserve(), 50_000e6);
        _invest(treasury.maxInvestable(address(adapter)));
        assertEq(treasury.idleBalance(), 50_000e6);

        // keeper: pay O1 on D7, payroll on D10 / D40 / D70, enforcing deadlines in between
        _warpToDay(7);
        vm.prank(keeper);
        treasury.pay(o1);

        uint256[3] memory days_ = [uint256(10), 40, 70];
        for (uint256 k = 0; k < 3; ++k) {
            if (days_[k] > 21) {
                _warpToDay(days_[k] - 14); // withdrawal deadline of this occurrence
                assertGt(treasury.shortfall(), 0);
                vm.prank(keeper);
                treasury.enforceDeadlines();
                assertEq(treasury.shortfall(), 0);
            }
            _warpToDay(days_[k]);
            vm.prank(keeper);
            treasury.enforceDeadlines();
            vm.prank(keeper);
            treasury.pay(id);
            Obligation memory ob = registry.getObligation(id);
            assertEq(ob.paidOccurrences, k + 1);
            assertEq(ob.nextDueDate, first + uint64(k + 1) * 30 days, "nextDueDate advanced");
            assertEq(uint8(ob.status), uint8(ObligationStatus.ACTIVE), "unlimited payroll stays active");
            // not due again until next month
            vm.prank(keeper);
            vm.expectRevert(
                abi.encodeWithSelector(ObligationNotDue.selector, id, ob.nextDueDate, treasury.currentTime())
            );
            treasury.pay(id);
        }
        assertEq(registry.getObligation(id).paidOccurrences, 3);
        assertEq(usdc.balanceOf(payroll), 60_000e6);
    }

    function test_flow_aprChangeInterest() public {
        _invest(70_000e6);
        _warpToDay(7);
        // 70,000 × 8% × 7/365 = 107.397…
        assertApproxEqAbs(treasury.vaultBalance(address(adapter)), 70_107_400_000, 10_000, "D7 = 70,107.40");
        vm.prank(admin);
        pool.setAPY(1200);
        _warpToDay(16);
        assertApproxEqAbs(treasury.vaultBalance(address(adapter)), 70_314_840_000, 10_000, "D16 = 70,314.84");
    }

    function test_flow_realUsdcTreasuryShape() public {
        SixDecimalToken token = new SixDecimalToken();
        Sys memory s = _deployAltSystem(IERC20(address(token)), admin, agent, 100_000e6, 10_000e6);
        assertEq(token.decimals(), 6);
        assertEq(s.treasury.asset(), address(token));
        assertEq(s.policy.asset(), address(token));
        assertEq(s.adapter.asset(), address(token));
        uint64 t0 = s.treasury.currentTime();
        uint256 id1 = _createOn(s, admin, recipient1, 20_000e6, t0 + 7 days);
        uint256 id2 = _createOn(s, admin, recipient2, 20_000e6, t0 + 30 days);
        uint256 id3 = _createOn(s, admin, recipient3, 10_000e6, t0 + 45 days);
        _runSrcLifecycle(s, id1, id2, id3);
        // the fixture's MockUSDC system is untouched by the alt-asset flow
        assertEq(usdc.balanceOf(address(treasury)), 100_000e6);
    }
}
