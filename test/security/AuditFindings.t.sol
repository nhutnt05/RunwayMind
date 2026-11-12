// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {stdError} from "forge-std/StdError.sol";
import {IVaultAdapter} from "../../contracts/interfaces/IVaultAdapter.sol";
import {AdapterStatus} from "../../contracts/interfaces/IPolicyEngine.sol";
import {MockLendingPool} from "../../contracts/mocks/MockLendingPool.sol";
import {VaultAdapter} from "../../contracts/VaultAdapter.sol";
import {IClock} from "../../contracts/interfaces/IClock.sol";
import {IMockLendingPool} from "../../contracts/interfaces/IMockLendingPool.sol";
import "../../contracts/libraries/Errors.sol";
import {Fixture} from "../utils/Fixture.sol";

/// @notice Wiring-correct adapter that holds funds as a plain token balance. Its VIEW functions can be made to revert,
///         modelling an underlying protocol whose read path breaks (upgrade, self-destructed dependency, bug).
contract BrickableAdapter is IVaultAdapter {
    address public immutable asset;
    address public immutable treasury;
    bool public bricked;

    constructor(address asset_, address treasury_) {
        asset = asset_;
        treasury = treasury_;
    }

    function brick(bool v) external {
        bricked = v;
    }

    function pool() external pure returns (address) {
        return address(0);
    }

    function name() external pure returns (string memory) {
        return "Brickable";
    }

    function deposit(uint256) external view {
        require(msg.sender == treasury, "not treasury");
    }

    function withdraw(uint256 amount) external returns (uint256) {
        require(msg.sender == treasury, "not treasury");
        require(!bricked, "bricked");
        require(IERC20(asset).transfer(treasury, amount), "transfer");
        return amount;
    }

    function balance() public view returns (uint256) {
        require(!bricked, "bricked");
        return IERC20(asset).balanceOf(address(this));
    }

    function getAPY() external pure returns (uint256) {
        return 0;
    }

    function isPaused() external view returns (bool) {
        return bricked;
    }

    function availableLiquidity() external view returns (uint256) {
        return balance();
    }

    function utilizationBps() external pure returns (uint256) {
        return 0;
    }

    function tvl() external view returns (uint256) {
        return balance();
    }
}

/// @notice Pre-release audit PoCs (2026-11-12). Each test asserts the CURRENT (frozen, deployed) behaviour so the
///         finding is documented and any future fix shows up as a deliberate test change. See the audit report.
contract AuditFindingsTest is Fixture {
    BrickableAdapter internal brick;

    function setUp() public override {
        super.setUp();
        brick = new BrickableAdapter(address(usdc), address(treasury));
        // pull order [brick, adapter]: _pullLiquidity reaches the broken adapter before the healthy one
        vm.startPrank(admin);
        policy.setAdapterStatus(address(adapter), AdapterStatus.NONE);
        policy.setAdapterStatus(address(brick), AdapterStatus.ACTIVE);
        policy.setAdapterStatus(address(adapter), AdapterStatus.ACTIVE);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------------------------------------ AUD-01

    /// @dev One whitelisted adapter whose balance()/availableLiquidity() view reverts takes down invest (every adapter),
    ///      enforceDeadlines (R2 keeper path) and pay-with-pull, although a healthy adapter holds ample liquidity.
    ///      The try/catch in _pullLiquidity only wraps withdraw(), and the adapter can never be delisted because
    ///      setAdapterStatus(NONE) itself calls balance(). Only pay-from-idle and manual per-adapter withdraw survive.
    ///      _pullLiquidity is only affected when it reaches the broken adapter (it breaks early once `needed` is met),
    ///      so the pull-path impact depends on getAdapters() order; invest/totalAssets are affected regardless.
    function test_finding_AUD01_adapterViewRevert_bricksInvestEnforcePull_andCannotBeDelisted() public {
        _invest(60_000e6); // healthy VaultAdapter
        vm.prank(agent);
        treasury.invest(address(brick), 10_000e6);
        assertEq(treasury.idleBalance(), 30_000e6);

        _warpToDay(7);
        vm.prank(keeper);
        treasury.pay(o1); // from idle, before the brick -> idle 10k

        brick.brick(true);

        // invest into the HEALTHY adapter is blocked (totalAssets() loops over the bricked adapter)
        vm.prank(admin);
        policy.setEmergencyBuffer(0);
        vm.prank(agent);
        vm.expectRevert(bytes("bricked"));
        treasury.invest(address(adapter), 1e6);

        // R2: shortfall exists at day 16 and the healthy pool is liquid, yet enforceDeadlines reverts
        _warpToDay(16);
        vm.prank(admin);
        policy.setEmergencyBuffer(BUFFER);
        assertGt(treasury.shortfall(), 0);
        assertGe(adapter.availableLiquidity(), 60_000e6);
        vm.prank(keeper);
        vm.expectRevert(bytes("bricked"));
        treasury.enforceDeadlines();

        // pay that needs a pull reverts although the healthy adapter alone could fund it
        _warpToDay(30);
        vm.prank(keeper);
        vm.expectRevert(bytes("bricked"));
        treasury.pay(o2);

        // no recovery through the whitelist: NONE needs balance() (reverts); WITHDRAW_ONLY keeps it in the loops
        vm.startPrank(admin);
        vm.expectRevert(bytes("bricked"));
        policy.setAdapterStatus(address(brick), AdapterStatus.NONE);
        policy.setAdapterStatus(address(brick), AdapterStatus.WITHDRAW_ONLY);
        vm.stopPrank();
        vm.prank(keeper);
        vm.expectRevert(bytes("bricked"));
        treasury.pay(o2);
        vm.expectRevert(bytes("bricked"));
        treasury.totalAssets();

        // the only workaround: AGENT/ADMIN manually withdraws a specific amount from the healthy adapter, then pay
        vm.prank(agent);
        treasury.withdraw(address(adapter), 20_000e6);
        vm.prank(keeper);
        treasury.pay(o2);
        assertEq(usdc.balanceOf(recipient2), 20_000e6);
    }

    // ------------------------------------------------------------------------------------------------ AUD-02

    /// @dev After a pool loss the adapter keeps reporting its claim. It can never be delisted (AdapterHasBalance), it
    ///      stays in totalAssets() as phantom value, and the R3 cap of every OTHER adapter is computed on that phantom.
    function test_finding_AUD02_lostPoolClaim_cannotBeWrittenOff_inflatesExposureCap() public {
        // second, healthy pool
        vm.startPrank(admin);
        MockLendingPool pool2 = new MockLendingPool(usdc, IClock(address(treasury)), admin, 800);
        VaultAdapter adapter2 = new VaultAdapter(IMockLendingPool(address(pool2)), address(treasury), "P2");
        policy.setAdapterStatus(address(adapter2), AdapterStatus.ACTIVE);
        policy.setMaxExposureBps(5000);
        vm.stopPrank();

        _invest(50_000e6);
        deal(address(usdc), address(pool), 0); // pool exploited / drained by a third party

        assertEq(adapter.balance(), 50_000e6, "claim still reported");
        assertEq(adapter.availableLiquidity(), 0);
        assertEq(treasury.totalAssets(), 100_000e6, "phantom 50k counted");

        vm.startPrank(admin);
        policy.setAdapterStatus(address(adapter), AdapterStatus.WITHDRAW_ONLY);
        vm.expectRevert(abi.encodeWithSelector(AdapterHasBalance.selector, address(adapter), 50_000e6));
        policy.setAdapterStatus(address(adapter), AdapterStatus.NONE);
        vm.stopPrank();

        // isolate R3: no obligations, no buffer (so R1 does not bind)
        vm.startPrank(admin);
        registry.cancelObligation(o1);
        registry.cancelObligation(o2);
        registry.cancelObligation(o3);
        policy.setEmergencyBuffer(0);
        vm.stopPrank();

        // real assets are 50k idle; a 50% cap on REAL assets would be 25k, but the phantom lifts it to 50k
        assertEq(treasury.maxInvestable(address(adapter2)), 50_000e6);
        vm.prank(agent);
        treasury.invest(address(adapter2), 50_000e6);
        assertEq(adapter2.balance(), 50_000e6, "100% of real assets concentrated in one pool under a 50% cap");
        assertEq(treasury.idleBalance(), 0);
    }

    // ------------------------------------------------------------------------------------------------ AUD-03

    /// @dev MockLendingPool is permissionless and pays interest from shared cash. A third party that deposits before a
    ///      DEMO advanceTime (or simply waits) withdraws principal + interest beyond the interest reserve, leaving the
    ///      Treasury's claim under-collateralised (here: its principal too). Relevant to the real-USDC Fuji instance
    ///      (anyone can obtain faucet USDC); the mUSDC instance needs mUSDC, which only recipients/owner hold.
    function test_finding_AUD03_mockPool_thirdPartyDepositorDrainsReserveAndTreasuryPrincipal() public {
        _invest(70_000e6);
        address outsider = makeAddr("outsider");
        deal(address(usdc), outsider, 200_000e6);
        vm.startPrank(outsider);
        usdc.approve(address(pool), type(uint256).max);
        pool.deposit(200_000e6);
        vm.stopPrank();

        vm.prank(admin);
        treasury.advanceTime(365 days); // DEMO time travel: 8% accrues instantly

        vm.prank(outsider);
        uint256 got = pool.withdraw(type(uint256).max, outsider);
        assertEq(got, 216_000e6, "outsider takes 16k interest; reserve was only 10k");

        uint256 claim = adapter.balance();
        assertEq(claim, 75_600e6);
        uint256 cash = usdc.balanceOf(address(pool));
        assertEq(cash, 64_000e6, "pool cash below Treasury principal (70k)");

        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(InsufficientPoolLiquidity.selector, claim, cash));
        treasury.withdraw(address(adapter), type(uint256).max);
    }

    // ------------------------------------------------------------------------------------------------ AUD-04

    /// @dev No upper bound on obligation amount: ADMIN can (by mistake) register an amount whose window sum overflows.
    ///      requiredReserve() then panics, so invest / enforceDeadlines / shortfall / maxInvestable revert until the
    ///      obligation is cancelled. pay() is unaffected (it never computes the reserve).
    function test_finding_AUD04_hugeObligationAmount_overflowsReserve() public {
        _createRecurring(recipient1, type(uint256).max / 2 + 1, T0 + 1 days, 1 days, 0);
        vm.expectRevert(stdError.arithmeticError);
        treasury.requiredReserve();
        vm.prank(agent);
        vm.expectRevert(stdError.arithmeticError);
        treasury.invest(address(adapter), 1e6);
        vm.prank(keeper);
        vm.expectRevert(stdError.arithmeticError);
        treasury.enforceDeadlines();
    }
}
