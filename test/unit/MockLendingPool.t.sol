// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {MockUSDC} from "../../contracts/mocks/MockUSDC.sol";
import {MockLendingPool} from "../../contracts/mocks/MockLendingPool.sol";
import {IClock} from "../../contracts/interfaces/IClock.sol";
import {IMockLendingPool} from "../../contracts/interfaces/IMockLendingPool.sol";
import "../../contracts/libraries/Errors.sol";
import {MockClock} from "../utils/MockClock.sol";

contract MockLendingPoolTest is Test {
    MockUSDC internal usdc;
    MockLendingPool internal pool;
    MockClock internal clock;
    address internal owner = makeAddr("owner");
    address internal user = makeAddr("user");
    address internal other = makeAddr("other");
    uint64 internal constant T0 = 1_793_318_400;
    uint256 internal constant RAY = 1e27;

    function setUp() public {
        clock = new MockClock(T0);
        vm.startPrank(owner);
        usdc = new MockUSDC();
        pool = new MockLendingPool(usdc, IClock(address(clock)), owner, 800);
        usdc.mint(user, 1_000_000e6);
        usdc.mint(owner, 10_000e6);
        usdc.approve(address(pool), type(uint256).max);
        pool.fundInterestReserve(10_000e6);
        vm.stopPrank();
        vm.prank(user);
        usdc.approve(address(pool), type(uint256).max);
    }

    function _deposit(uint256 amount) internal {
        vm.prank(user);
        pool.deposit(amount);
    }

    function _expectedIndex(uint256 index, uint256 apy, uint256 dt) internal pure returns (uint256) {
        return index + (index * apy * dt) / (10_000 * 365 days);
    }

    // ---------------------------------------------------------------------------------------- constructor

    function test_constructor_state() public view {
        assertEq(pool.asset(), address(usdc));
        assertEq(pool.clock(), address(clock));
        assertEq(pool.owner(), owner);
        assertEq(pool.apyBps(), 800);
        assertEq(pool.currentIndex(), RAY);
        assertEq(pool.lastUpdate(), T0);
        assertFalse(pool.liquidityShortage());
    }

    function test_constructor_reverts() public {
        vm.expectRevert(ZeroAddress.selector);
        new MockLendingPool(usdc, IClock(address(0)), owner, 800);
        vm.expectRevert(abi.encodeWithSelector(InvalidBps.selector, 10_001));
        new MockLendingPool(usdc, IClock(address(clock)), owner, 10_001);
    }

    // ---------------------------------------------------------------------------------------- interest

    /// @dev docs/02 §E.3 worked example: 70,000 @ 8% for 7 days → 70,107.40; then 12% for 9 days → 70,314.84.
    function test_pool_interestVector() public {
        _deposit(70_000e6);

        clock.set(T0 + 7 days);
        uint256 idx7 = _expectedIndex(RAY, 800, 7 days);
        uint256 bal7 = pool.balanceOf(user);
        assertApproxEqAbs(bal7, (70_000e6 * idx7) / RAY, 1, "D7 exact formula");
        assertApproxEqAbs(bal7, 70_107_400_000, 5000, "D7 = 70,107.40 at cent precision");

        vm.prank(owner);
        pool.setAPY(1200); // accrues 800 bps up to D7 first

        clock.set(T0 + 16 days);
        uint256 idx16 = _expectedIndex(idx7, 1200, 9 days);
        uint256 bal16 = pool.balanceOf(user);
        assertApproxEqAbs(bal16, (70_000e6 * idx16) / RAY, 1, "D16 exact formula");
        assertApproxEqAbs(bal16, 70_314_840_000, 5000, "D16 = 70,314.84 at cent precision");
    }

    function test_setAPY_accruesBeforeSwitching() public {
        _deposit(70_000e6);
        clock.set(T0 + 7 days);
        uint256 before = pool.balanceOf(user);
        vm.expectEmit(false, false, false, true, address(pool));
        emit IMockLendingPool.ApyUpdated(800, 0);
        vm.prank(owner);
        pool.setAPY(0);
        assertEq(pool.lastUpdate(), T0 + 7 days);
        clock.set(T0 + 30 days);
        assertEq(pool.balanceOf(user), before); // 0% after the switch, earlier interest kept
    }

    function test_setAPY_bounds() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(InvalidBps.selector, 10_001));
        pool.setAPY(10_001);
    }

    function test_timeReadFromClock() public {
        _deposit(10_000e6);
        vm.warp(block.timestamp + 365 days); // block time moves, clock does not
        assertEq(pool.balanceOf(user), 10_000e6);
        clock.set(T0 + 365 days);
        assertApproxEqAbs(pool.balanceOf(user), 10_800e6, 1);
    }

    // ---------------------------------------------------------------------------------------- deposit / withdraw

    function test_deposit_withdraw_roundTrip() public {
        _deposit(1000e6);
        assertEq(pool.balanceOf(user), 1000e6);
        assertEq(pool.totalAssets(), 1000e6);
        vm.prank(user);
        uint256 got = pool.withdraw(400e6, other);
        assertEq(got, 400e6);
        assertEq(usdc.balanceOf(other), 400e6);
        assertEq(pool.balanceOf(user), 600e6);
    }

    function test_withdraw_maxIsFullBalance() public {
        _deposit(1000e6);
        clock.set(T0 + 30 days);
        uint256 bal = pool.balanceOf(user);
        vm.prank(user);
        uint256 got = pool.withdraw(type(uint256).max, user);
        assertEq(got, bal);
        assertEq(pool.scaledBalanceOf(user), 0);
        assertEq(pool.balanceOf(user), 0);
    }

    function test_zeroAmountReverts() public {
        vm.prank(user);
        vm.expectRevert(ZeroAmount.selector);
        pool.deposit(0);
        vm.prank(user);
        vm.expectRevert(ZeroAmount.selector);
        pool.withdraw(0, user);
        vm.expectRevert(ZeroAmount.selector);
        pool.fundInterestReserve(0);
    }

    function test_withdraw_moreThanBalanceReverts() public {
        _deposit(100e6);
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(InsufficientPoolLiquidity.selector, 100e6 + 1, 100e6));
        pool.withdraw(100e6 + 1, user);
    }

    function test_pause_blocksDepositAndWithdraw() public {
        _deposit(100e6);
        vm.prank(owner);
        pool.setPaused(true);
        vm.prank(user);
        vm.expectRevert(PoolPaused.selector);
        pool.deposit(1e6);
        vm.prank(user);
        vm.expectRevert(PoolPaused.selector);
        pool.withdraw(1e6, user);
        vm.prank(owner);
        pool.setPaused(false);
        vm.prank(user);
        pool.withdraw(1e6, user);
    }

    function test_utilization_capsWithdrawalsOnlyWithShortage() public {
        _deposit(10_000e6); // pool cash = 20,000 incl. reserve
        vm.prank(owner);
        pool.setUtilization(9800);
        assertEq(pool.availableLiquidity(), 20_000e6); // reported only
        vm.prank(user);
        pool.withdraw(5000e6, user);

        vm.prank(owner);
        pool.setLiquidityShortage(true);
        uint256 avail = pool.availableLiquidity(); // 15,000 × 2% = 300
        assertEq(avail, 300e6);
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(InsufficientPoolLiquidity.selector, 301e6, 300e6));
        pool.withdraw(301e6, user);
        vm.prank(user);
        pool.withdraw(300e6, user);

        vm.prank(owner);
        pool.setUtilization(10_000);
        assertEq(pool.availableLiquidity(), 0);
    }

    function test_ownerControls_onlyOwner() public {
        bytes memory err = abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, user);
        vm.startPrank(user);
        vm.expectRevert(err);
        pool.setAPY(1);
        vm.expectRevert(err);
        pool.setPaused(true);
        vm.expectRevert(err);
        pool.setUtilization(1);
        vm.expectRevert(err);
        pool.setLiquidityShortage(true);
        vm.stopPrank();
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(InvalidBps.selector, 10_001));
        pool.setUtilization(10_001);
    }

    function test_rounding_neverMoreThanDepositedPlusInterest() public {
        _deposit(3); // tiny amounts stress rounding
        clock.set(T0 + 1 days);
        uint256 bal = pool.balanceOf(user);
        uint256 beforeBal = usdc.balanceOf(user);
        vm.prank(user);
        pool.withdraw(type(uint256).max, user);
        assertLe(usdc.balanceOf(user) - beforeBal, bal);
        assertEq(pool.balanceOf(user), 0);
    }

    /// @dev Σ withdrawn ≤ Σ deposited + accrued interest; rounding favors the pool (docs/10 §2.7).
    function testFuzz_pool_noValueCreation(uint256[6] memory amounts, uint32[6] memory waits, uint16 apy) public {
        apy = uint16(bound(apy, 0, 10_000));
        vm.prank(owner);
        pool.setAPY(apy);
        uint256 deposited;
        uint256 withdrawn;
        for (uint256 i = 0; i < amounts.length; ++i) {
            clock.advance(uint64(bound(waits[i], 0, 30 days)));
            uint256 a = bound(amounts[i], 1, 50_000e6);
            if (i % 2 == 0) {
                _deposit(a);
                deposited += a;
            } else {
                uint256 bal = pool.balanceOf(user);
                if (bal == 0) continue;
                uint256 w = a > bal ? bal : a;
                vm.prank(user);
                withdrawn += pool.withdraw(w, user);
            }
            assertLe(pool.balanceOf(user), pool.totalAssets(), "user balance <= totalAssets");
        }
        uint256 rest = pool.balanceOf(user);
        if (rest > 0) {
            vm.prank(user);
            withdrawn += pool.withdraw(type(uint256).max, user);
        }
        // Upper bound: deposits compounding at the max index growth seen.
        uint256 maxGrowth = (deposited * pool.currentIndex()) / RAY + 1;
        assertLe(withdrawn, maxGrowth, "no value creation");
        if (apy == 0) assertLe(withdrawn, deposited, "0% APY returns at most principal");
    }
}
