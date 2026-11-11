// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {ObligationRegistry} from "../../contracts/ObligationRegistry.sol";
import {PolicyEngine} from "../../contracts/PolicyEngine.sol";
import {IObligationRegistry, ObligationInput, Category} from "../../contracts/interfaces/IObligationRegistry.sol";
import {IPolicyEngine, AdapterStatus} from "../../contracts/interfaces/IPolicyEngine.sol";
import "../../contracts/libraries/Errors.sol";
import {MockClock} from "../utils/MockClock.sol";
import {MockAdapter} from "../utils/MockAdapter.sol";

contract PolicyEngineTest is Test {
    ObligationRegistry internal registry;
    PolicyEngine internal policy;
    MockClock internal clock;
    address internal asset = makeAddr("asset");
    address internal admin = makeAddr("admin");
    address internal treasuryRole = makeAddr("treasury");
    address internal stranger = makeAddr("stranger");
    address internal recipient = makeAddr("recipient");
    uint64 internal constant T0 = 1_793_318_400;
    uint64 internal constant H = 14 days;
    uint256 internal constant BUFFER = 10_000e6;

    function setUp() public {
        clock = new MockClock(T0);
        registry = new ObligationRegistry(admin);
        policy = new PolicyEngine(admin, asset, IObligationRegistry(address(registry)), H, BUFFER, 7000);
        vm.startPrank(admin);
        registry.setClock(address(clock));
        registry.grantRole(registry.TREASURY_ROLE(), treasuryRole);
        vm.stopPrank();
    }

    function _create(uint256 amount, uint64 due) internal returns (uint256) {
        vm.prank(admin);
        return registry.createObligation(
            ObligationInput({
                recipient: recipient,
                amount: amount,
                firstDueDate: due,
                interval: 0,
                maxOccurrences: 1,
                category: Category.PAYROLL,
                metadataHash: bytes32(0)
            })
        );
    }

    function _pay(uint256 id) internal {
        vm.prank(treasuryRole);
        registry.markPaid(id);
    }

    function _whitelist() internal returns (MockAdapter a) {
        a = new MockAdapter(asset, treasuryRole);
        vm.prank(admin);
        policy.setAdapterStatus(address(a), AdapterStatus.ACTIVE);
    }

    function _unauthorized(address who) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, who, bytes32(0));
    }

    // ---------------------------------------------------------------------------------------- constructor & setters

    function test_constructor_defaults() public view {
        assertEq(policy.asset(), asset);
        assertEq(policy.registry(), address(registry));
        assertEq(policy.safetyHorizon(), H);
        assertEq(policy.emergencyBuffer(), BUFFER);
        assertEq(policy.maxExposureBps(), 7000);
    }

    function test_constructor_validatesBounds() public {
        vm.expectRevert(abi.encodeWithSelector(InvalidParameter.selector, bytes32("safetyHorizon")));
        new PolicyEngine(admin, asset, IObligationRegistry(address(registry)), 0, BUFFER, 7000);
        vm.expectRevert(abi.encodeWithSelector(InvalidParameter.selector, bytes32("maxExposureBps")));
        new PolicyEngine(admin, asset, IObligationRegistry(address(registry)), H, BUFFER, 0);
        vm.expectRevert(ZeroAddress.selector);
        new PolicyEngine(address(0), asset, IObligationRegistry(address(registry)), H, BUFFER, 7000);
    }

    function test_setSafetyHorizon_bounds() public {
        vm.startPrank(admin);
        vm.expectRevert(abi.encodeWithSelector(InvalidParameter.selector, bytes32("safetyHorizon")));
        policy.setSafetyHorizon(1 days - 1);
        vm.expectRevert(abi.encodeWithSelector(InvalidParameter.selector, bytes32("safetyHorizon")));
        policy.setSafetyHorizon(90 days + 1);
        policy.setSafetyHorizon(1 days);
        policy.setSafetyHorizon(90 days);
        vm.expectEmit(false, false, false, true, address(policy));
        emit IPolicyEngine.PolicyParametersUpdated(30 days, BUFFER, 7000);
        policy.setSafetyHorizon(30 days);
        vm.stopPrank();
        assertEq(policy.safetyHorizon(), 30 days);
    }

    function test_setMaxExposureBps_bounds() public {
        vm.startPrank(admin);
        vm.expectRevert(abi.encodeWithSelector(InvalidParameter.selector, bytes32("maxExposureBps")));
        policy.setMaxExposureBps(0);
        vm.expectRevert(abi.encodeWithSelector(InvalidParameter.selector, bytes32("maxExposureBps")));
        policy.setMaxExposureBps(10_001);
        policy.setMaxExposureBps(1);
        policy.setMaxExposureBps(10_000);
        vm.stopPrank();
        assertEq(policy.maxExposureBps(), 10_000);
    }

    function test_setEmergencyBuffer_anyValue() public {
        vm.startPrank(admin);
        policy.setEmergencyBuffer(0);
        assertEq(policy.emergencyBuffer(), 0);
        policy.setEmergencyBuffer(type(uint256).max / 2);
        vm.stopPrank();
    }

    function test_setters_revertForNonAdmin() public {
        vm.startPrank(stranger);
        vm.expectRevert(_unauthorized(stranger));
        policy.setSafetyHorizon(2 days);
        vm.expectRevert(_unauthorized(stranger));
        policy.setEmergencyBuffer(1);
        vm.expectRevert(_unauthorized(stranger));
        policy.setMaxExposureBps(5000);
        vm.expectRevert(_unauthorized(stranger));
        policy.setAdapterStatus(address(1), AdapterStatus.ACTIVE);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------------------------------- whitelist

    function test_setAdapterStatus_lifecycle() public {
        MockAdapter a = _whitelist();
        assertEq(uint8(policy.adapterStatus(address(a))), uint8(AdapterStatus.ACTIVE));
        assertEq(policy.getAdapters().length, 1);

        vm.prank(admin);
        policy.setAdapterStatus(address(a), AdapterStatus.WITHDRAW_ONLY);
        assertEq(policy.getAdapters().length, 1); // not duplicated

        vm.prank(admin);
        policy.setAdapterStatus(address(a), AdapterStatus.NONE);
        assertEq(policy.getAdapters().length, 0);
    }

    function test_setAdapterStatus_assetMismatch() public {
        MockAdapter wrong = new MockAdapter(makeAddr("otherAsset"), treasuryRole);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(AdapterMismatch.selector, address(wrong)));
        policy.setAdapterStatus(address(wrong), AdapterStatus.ACTIVE);
    }

    function test_setAdapterStatus_zeroAddress() public {
        vm.prank(admin);
        vm.expectRevert(ZeroAddress.selector);
        policy.setAdapterStatus(address(0), AdapterStatus.ACTIVE);
    }

    function test_setAdapterStatus_maxAdapters() public {
        for (uint256 i = 0; i < policy.MAX_ADAPTERS(); ++i) {
            _whitelist();
        }
        MockAdapter extra = new MockAdapter(asset, treasuryRole);
        vm.prank(admin);
        vm.expectRevert(TooManyAdapters.selector);
        policy.setAdapterStatus(address(extra), AdapterStatus.ACTIVE);
    }

    function test_setAdapterStatus_removalWithBalanceReverts() public {
        MockAdapter a = _whitelist();
        a.setBalance(5);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(AdapterHasBalance.selector, address(a), 5));
        policy.setAdapterStatus(address(a), AdapterStatus.NONE);
    }

    function test_setAdapterStatus_removalSwapAndPop() public {
        MockAdapter a = _whitelist();
        MockAdapter b = _whitelist();
        MockAdapter c = _whitelist();
        vm.prank(admin);
        policy.setAdapterStatus(address(a), AdapterStatus.NONE);
        address[] memory list = policy.getAdapters();
        assertEq(list.length, 2);
        assertEq(list[0], address(c));
        assertEq(list[1], address(b));
    }

    // ---------------------------------------------------------------------------------------- reserve math

    /// @dev docs/04 §5 normative vector.
    function test_policy_srcExampleVector() public {
        uint256 o1 = _create(20_000e6, T0 + 7 days);
        uint256 o2 = _create(20_000e6, T0 + 30 days);
        uint256 o3 = _create(10_000e6, T0 + 45 days);

        assertEq(policy.requiredReserve(T0), 30_000e6, "day 0");

        clock.set(T0 + 7 days);
        _pay(o1);
        assertEq(policy.requiredReserve(T0 + 7 days), 10_000e6, "day 7 after O1 paid");

        assertEq(policy.requiredReserve(T0 + 16 days - 1), 10_000e6, "just before day 16");
        assertEq(policy.requiredReserve(T0 + 16 days), 30_000e6, "day 16");

        clock.set(T0 + 30 days);
        _pay(o2);
        assertEq(policy.requiredReserve(T0 + 30 days), 10_000e6, "day 30 after O2 paid");
        assertEq(policy.requiredReserve(T0 + 31 days), 20_000e6, "day 31");

        clock.set(T0 + 45 days);
        _pay(o3);
        assertEq(policy.requiredReserve(T0 + 45 days), 10_000e6, "day 45 after O3 paid");
    }

    function test_withdrawalDeadline_saturates() public view {
        assertEq(policy.withdrawalDeadline(T0 + 30 days), T0 + 16 days);
        assertEq(policy.withdrawalDeadline(H), 0);
        assertEq(policy.withdrawalDeadline(1), 0);
    }

    function test_liquidityShortfall() public {
        _create(20_000e6, T0 + 7 days);
        assertEq(policy.liquidityShortfall(30_000e6, T0), 0);
        assertEq(policy.liquidityShortfall(10_000e6, T0), 20_000e6);
    }

    function test_changingH_rederivesShortfall() public {
        _create(20_000e6, T0 + 30 days);
        assertEq(policy.liquidityShortfall(10_000e6, T0), 0); // outside 14-day window
        vm.prank(admin);
        policy.setSafetyHorizon(30 days);
        assertEq(policy.liquidityShortfall(10_000e6, T0), 20_000e6);
        assertEq(policy.withdrawalDeadline(T0 + 30 days), T0);
    }

    // ---------------------------------------------------------------------------------------- checkInvest

    function test_R1_boundary() public {
        MockAdapter a = _whitelist();
        _create(20_000e6, T0 + 7 days); // required 30,000
        // idleAfter == req passes
        policy.checkInvest(address(a), 70_000e6, 100_000e6, 0, 100_000e6, T0);
        // req − 1 fails
        vm.expectRevert(abi.encodeWithSelector(ReserveViolation.selector, 30_000e6 - 1, 30_000e6));
        policy.checkInvest(address(a), 70_000e6 + 1, 100_000e6, 0, 100_000e6, T0);
    }

    function test_R3_boundaryInclusive() public {
        MockAdapter a = _whitelist();
        vm.prank(admin);
        policy.setMaxExposureBps(5000);
        policy.checkInvest(address(a), 50_000e6, 100_000e6, 0, 100_000e6, T0); // == cap passes
        vm.expectRevert(abi.encodeWithSelector(ExposureLimitExceeded.selector, 50_000e6 + 1, 50_000e6));
        policy.checkInvest(address(a), 50_000e6 + 1, 100_000e6, 0, 100_000e6, T0);
        vm.expectRevert(abi.encodeWithSelector(ExposureLimitExceeded.selector, 50_000e6 + 1, 50_000e6));
        policy.checkInvest(address(a), 1, 100_000e6, 50_000e6, 100_000e6, T0);
    }

    function test_R4_noneAndWithdrawOnly() public {
        MockAdapter unknown = new MockAdapter(asset, treasuryRole);
        vm.expectRevert(abi.encodeWithSelector(AdapterNotWhitelisted.selector, address(unknown)));
        policy.checkInvest(address(unknown), 1, 100_000e6, 0, 100_000e6, T0);

        MockAdapter a = _whitelist();
        vm.prank(admin);
        policy.setAdapterStatus(address(a), AdapterStatus.WITHDRAW_ONLY);
        vm.expectRevert(abi.encodeWithSelector(AdapterNotWhitelisted.selector, address(a)));
        policy.checkInvest(address(a), 1, 100_000e6, 0, 100_000e6, T0);
    }

    function test_checkInvest_orderR4BeforeR1() public {
        MockAdapter unknown = new MockAdapter(asset, treasuryRole);
        _create(20_000e6, T0 + 7 days);
        // violates R1 too, but R4 must be reported first
        vm.expectRevert(abi.encodeWithSelector(AdapterNotWhitelisted.selector, address(unknown)));
        policy.checkInvest(address(unknown), 90_000e6, 100_000e6, 0, 100_000e6, T0);
    }

    function test_maxInvestable_isMinOfR1R3() public {
        MockAdapter a = _whitelist();
        _create(20_000e6, T0 + 7 days); // req 30,000 → R1 = 70,000
        assertEq(policy.maxInvestable(address(a), 100_000e6, 0, 100_000e6, T0), 70_000e6);
        vm.prank(admin);
        policy.setMaxExposureBps(5000); // R3 = 50,000
        assertEq(policy.maxInvestable(address(a), 100_000e6, 0, 100_000e6, T0), 50_000e6);
        assertEq(policy.maxInvestable(address(a), 100_000e6, 60_000e6, 100_000e6, T0), 0); // R3 exhausted
        assertEq(policy.maxInvestable(address(a), 20_000e6, 0, 100_000e6, T0), 0); // R1 exhausted
        assertEq(policy.maxInvestable(address(0xdead), 100_000e6, 0, 100_000e6, T0), 0); // not ACTIVE
    }

    function testFuzz_policy_checkInvest(uint256 idle, uint256 amount, uint256 adapterBal, uint16 exposure) public {
        MockAdapter a = _whitelist();
        _create(20_000e6, T0 + 7 days); // req = 30,000e6
        idle = bound(idle, 0, 1e15);
        amount = bound(amount, 0, idle);
        adapterBal = bound(adapterBal, 0, 1e15);
        exposure = uint16(bound(exposure, 1, 10_000));
        vm.prank(admin);
        policy.setMaxExposureBps(exposure);
        uint256 total = idle + adapterBal;
        uint256 req = 30_000e6;
        uint256 cap = (total * exposure) / 10_000;
        bool r1 = idle - amount < req;
        bool r3 = adapterBal + amount > cap;
        if (r1 || r3) vm.expectRevert();
        policy.checkInvest(address(a), amount, idle, adapterBal, total, T0);
    }
}
