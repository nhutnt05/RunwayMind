// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {ObligationRegistry} from "../../contracts/ObligationRegistry.sol";
import {
    IObligationRegistry,
    Obligation,
    ObligationInput,
    ObligationStatus,
    Category
} from "../../contracts/interfaces/IObligationRegistry.sol";
import "../../contracts/libraries/Errors.sol";
import {MockClock} from "../utils/MockClock.sol";

contract ObligationRegistryTest is Test {
    ObligationRegistry internal registry;
    MockClock internal clock;
    address internal admin = makeAddr("admin");
    address internal treasuryRole = makeAddr("treasury");
    address internal stranger = makeAddr("stranger");
    address internal recipient = makeAddr("recipient");
    uint64 internal constant T0 = 1_793_318_400;

    function setUp() public {
        clock = new MockClock(T0);
        registry = new ObligationRegistry(admin);
        vm.startPrank(admin);
        registry.setClock(address(clock));
        registry.grantRole(registry.TREASURY_ROLE(), treasuryRole);
        vm.stopPrank();
    }

    function _input(uint256 amount, uint64 due, uint64 interval, uint32 maxOcc)
        internal
        view
        returns (ObligationInput memory)
    {
        return ObligationInput({
            recipient: recipient,
            amount: amount,
            firstDueDate: due,
            interval: interval,
            maxOccurrences: maxOcc,
            category: Category.PAYROLL,
            metadataHash: keccak256("meta")
        });
    }

    function _create(uint256 amount, uint64 due, uint64 interval, uint32 maxOcc) internal returns (uint256) {
        vm.prank(admin);
        return registry.createObligation(_input(amount, due, interval, maxOcc));
    }

    function _pay(uint256 id) internal returns (address r, uint256 a, uint32 occ) {
        vm.prank(treasuryRole);
        return registry.markPaid(id);
    }

    // ---------------------------------------------------------------------------------------- constructor / clock

    function test_constructor_revertsZeroAdmin() public {
        vm.expectRevert(ZeroAddress.selector);
        new ObligationRegistry(address(0));
    }

    function test_setClock_onlyOnce() public {
        vm.prank(admin);
        vm.expectRevert(ClockAlreadySet.selector);
        registry.setClock(address(clock));
    }

    function test_setClock_onlyAdmin() public {
        ObligationRegistry fresh = new ObligationRegistry(admin);
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, bytes32(0))
        );
        fresh.setClock(address(clock));
    }

    // ---------------------------------------------------------------------------------------- create

    function test_create_oneTime() public {
        vm.expectEmit(true, true, false, true, address(registry));
        emit IObligationRegistry.ObligationCreated(
            1, recipient, 20_000e6, T0 + 7 days, 0, 1, Category.PAYROLL, keccak256("meta")
        );
        uint256 id = _create(20_000e6, T0 + 7 days, 0, 1);
        assertEq(id, 1);
        Obligation memory ob = registry.getObligation(id);
        assertEq(ob.id, 1);
        assertEq(ob.recipient, recipient);
        assertEq(ob.amount, 20_000e6);
        assertEq(ob.nextDueDate, T0 + 7 days);
        assertEq(ob.maxOccurrences, 1);
        assertEq(uint8(ob.status), uint8(ObligationStatus.ACTIVE));
        assertEq(ob.createdAt, T0);
        assertEq(registry.obligationCount(), 1);
        assertEq(registry.activeObligationCount(), 1);
    }

    function test_create_recurring() public {
        uint256 id = _create(20_000e6, T0 + 7 days, 30 days, 0);
        Obligation memory ob = registry.getObligation(id);
        assertEq(ob.interval, 30 days);
        assertEq(ob.maxOccurrences, 0);
    }

    function test_create_V1_clockNotSet() public {
        ObligationRegistry fresh = new ObligationRegistry(admin);
        vm.prank(admin);
        vm.expectRevert(ClockNotSet.selector);
        fresh.createObligation(_input(1, T0 + 1, 0, 1));
    }

    function test_create_V2_invalidRecipient() public {
        ObligationInput memory inp = _input(1, T0 + 1, 0, 1);
        inp.recipient = address(0);
        vm.prank(admin);
        vm.expectRevert(InvalidRecipient.selector);
        registry.createObligation(inp);

        inp.recipient = address(clock); // clock = Treasury
        vm.prank(admin);
        vm.expectRevert(InvalidRecipient.selector);
        registry.createObligation(inp);
    }

    function test_create_V3_invalidAmount() public {
        vm.prank(admin);
        vm.expectRevert(InvalidAmount.selector);
        registry.createObligation(_input(0, T0 + 1, 0, 1));
    }

    function test_create_V4_dueDateInPast() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(DueDateInPast.selector, T0, T0));
        registry.createObligation(_input(1, T0, 0, 1));
    }

    function test_create_V5_invalidInterval() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(InvalidInterval.selector, uint64(1 days - 1)));
        registry.createObligation(_input(1, T0 + 1, 1 days - 1, 0));

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(InvalidInterval.selector, uint64(365 days + 1)));
        registry.createObligation(_input(1, T0 + 1, 365 days + 1, 0));

        // bounds inclusive
        _create(1, T0 + 1, 1 days, 0);
        _create(1, T0 + 1, 365 days, 0);
    }

    function test_create_V6_invalidOccurrences() public {
        vm.prank(admin);
        vm.expectRevert(InvalidOccurrences.selector);
        registry.createObligation(_input(1, T0 + 1, 0, 0)); // one-time must be 1

        vm.prank(admin);
        vm.expectRevert(InvalidOccurrences.selector);
        registry.createObligation(_input(1, T0 + 1, 0, 2));

        vm.prank(admin);
        vm.expectRevert(InvalidOccurrences.selector);
        registry.createObligation(_input(1, T0 + 1, 1 days, 1)); // recurring must be 0 or >= 2

        _create(1, T0 + 1, 1 days, 2);
    }

    function test_create_V7_tooManyActive() public {
        for (uint256 i = 0; i < registry.MAX_ACTIVE_OBLIGATIONS(); ++i) {
            _create(1, T0 + 1, 0, 1);
        }
        vm.prank(admin);
        vm.expectRevert(TooManyActiveObligations.selector);
        registry.createObligation(_input(1, T0 + 1, 0, 1));
    }

    function test_create_revertsForNonAdmin() public {
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, bytes32(0))
        );
        registry.createObligation(_input(1, T0 + 1, 0, 1));
    }

    // ---------------------------------------------------------------------------------------- update / cancel

    function test_update_byAdmin() public {
        uint256 id = _create(20_000e6, T0 + 7 days, 0, 1);
        address other = makeAddr("other");
        vm.expectEmit(true, false, false, true, address(registry));
        emit IObligationRegistry.ObligationUpdated(id, other, 25_000e6, T0 + 8 days);
        vm.prank(admin);
        registry.updateObligation(id, other, 25_000e6, T0 + 8 days);
        Obligation memory ob = registry.getObligation(id);
        assertEq(ob.recipient, other);
        assertEq(ob.amount, 25_000e6);
        assertEq(ob.nextDueDate, T0 + 8 days);
    }

    function test_update_validations() public {
        uint256 id = _create(20_000e6, T0 + 7 days, 0, 1);
        vm.startPrank(admin);
        vm.expectRevert(InvalidRecipient.selector);
        registry.updateObligation(id, address(0), 1, T0 + 1);
        vm.expectRevert(InvalidAmount.selector);
        registry.updateObligation(id, recipient, 0, T0 + 1);
        vm.expectRevert(abi.encodeWithSelector(DueDateInPast.selector, T0, T0));
        registry.updateObligation(id, recipient, 1, T0);
        vm.expectRevert(abi.encodeWithSelector(UnknownObligation.selector, 99));
        registry.updateObligation(99, recipient, 1, T0 + 1);
        vm.stopPrank();
    }

    function test_update_revertsForNonAdmin() public {
        uint256 id = _create(20_000e6, T0 + 7 days, 0, 1);
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, bytes32(0))
        );
        registry.updateObligation(id, stranger, 1, T0 + 1);
    }

    function test_cancel_byAdmin_excludedFromAmountDue() public {
        uint256 id = _create(20_000e6, T0 + 7 days, 0, 1);
        vm.expectEmit(true, false, false, false, address(registry));
        emit IObligationRegistry.ObligationCancelled(id);
        vm.prank(admin);
        registry.cancelObligation(id);
        assertEq(uint8(registry.getObligation(id).status), uint8(ObligationStatus.CANCELLED));
        assertEq(registry.activeObligationCount(), 0);
        assertEq(registry.amountDueUntil(T0 + 365 days), 0);
        assertEq(registry.occurrencesDueUntil(id, T0 + 365 days), 0);

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ObligationNotActive.selector, id));
        registry.cancelObligation(id);
    }

    function test_cancel_revertsForNonAdmin() public {
        uint256 id = _create(20_000e6, T0 + 7 days, 0, 1);
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, bytes32(0))
        );
        registry.cancelObligation(id);
    }

    // ---------------------------------------------------------------------------------------- markPaid

    function test_markPaid_onlyTreasuryRole() public {
        uint256 id = _create(20_000e6, T0 + 7 days, 0, 1);
        bytes32 role = registry.TREASURY_ROLE();
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, admin, role));
        registry.markPaid(id);
    }

    function test_markPaid_oneTimeCompletes() public {
        uint256 id = _create(20_000e6, T0 + 7 days, 0, 1);
        vm.expectEmit(true, false, false, false, address(registry));
        emit IObligationRegistry.ObligationCompleted(id);
        (address r, uint256 a, uint32 occ) = _pay(id);
        assertEq(r, recipient);
        assertEq(a, 20_000e6);
        assertEq(occ, 1);
        Obligation memory ob = registry.getObligation(id);
        assertEq(uint8(ob.status), uint8(ObligationStatus.COMPLETED));
        assertEq(ob.paidOccurrences, 1);
        assertEq(registry.activeObligationCount(), 0);

        vm.prank(treasuryRole);
        vm.expectRevert(abi.encodeWithSelector(ObligationNotActive.selector, id));
        registry.markPaid(id);
    }

    function test_markPaid_recurringAdvancesAndCompletesAtMax() public {
        uint256 id = _create(20_000e6, T0 + 7 days, 30 days, 3);
        _pay(id);
        assertEq(registry.getObligation(id).nextDueDate, T0 + 37 days);
        (,, uint32 occ2) = _pay(id);
        assertEq(occ2, 2);
        assertEq(registry.getObligation(id).nextDueDate, T0 + 67 days);
        assertEq(uint8(registry.getObligation(id).status), uint8(ObligationStatus.ACTIVE));
        (,, uint32 occ3) = _pay(id);
        assertEq(occ3, 3);
        Obligation memory ob = registry.getObligation(id);
        assertEq(uint8(ob.status), uint8(ObligationStatus.COMPLETED));
        assertEq(ob.paidOccurrences, 3);
        assertEq(registry.activeObligationCount(), 0);
    }

    function test_markPaid_unlimitedNeverCompletes() public {
        uint256 id = _create(1e6, T0 + 1 days, 1 days, 0);
        for (uint256 i = 0; i < 100; ++i) {
            _pay(id);
        }
        Obligation memory ob = registry.getObligation(id);
        assertEq(uint8(ob.status), uint8(ObligationStatus.ACTIVE));
        assertEq(ob.paidOccurrences, 100);
        assertEq(ob.nextDueDate, T0 + 101 days);
    }

    // ---------------------------------------------------------------------------------------- amounts due

    function test_amountDueUntil_boundaryInclusive() public {
        _create(20_000e6, T0 + 7 days, 0, 1);
        assertEq(registry.amountDueUntil(T0 + 7 days - 1), 0);
        assertEq(registry.amountDueUntil(T0 + 7 days), 20_000e6); // until == dueDate counts
    }

    function test_amountDueUntil_overdueCounted() public {
        _create(20_000e6, T0 + 7 days, 0, 1);
        clock.set(T0 + 10 days); // now past due, unpaid
        assertEq(registry.amountDueUntil(T0 + 10 days), 20_000e6);
    }

    function test_amountDueUntil_recurringMultipleInWindow() public {
        uint256 id = _create(5000e6, T0 + 1 days, 7 days, 0);
        // due T0+1, +8, +15 within T0+15 → 3 occurrences
        assertEq(registry.occurrencesDueUntil(id, T0 + 15 days), 3);
        assertEq(registry.amountDueUntil(T0 + 15 days), 15_000e6);
    }

    function test_occurrencesDueUntil_cappedByRemaining() public {
        uint256 id = _create(1e6, T0 + 1 days, 1 days, 3);
        assertEq(registry.occurrencesDueUntil(id, T0 + 100 days), 3);
        _pay(id);
        assertEq(registry.occurrencesDueUntil(id, T0 + 100 days), 2);
        assertEq(registry.occurrencesDueUntil(999, T0 + 100 days), 0); // unknown id
    }

    function test_activeSet_swapAndPop() public {
        uint256 a = _create(1, T0 + 1 days, 0, 1);
        uint256 b = _create(2, T0 + 1 days, 0, 1);
        uint256 c = _create(4, T0 + 1 days, 0, 1);
        uint256 d = _create(8, T0 + 1 days, 0, 1);

        vm.prank(admin);
        registry.cancelObligation(b); // middle: d moves into b's slot
        uint256[] memory ids = registry.getActiveObligationIds();
        assertEq(ids.length, 3);
        assertEq(ids[0], a);
        assertEq(ids[1], d);
        assertEq(ids[2], c);

        _pay(d); // moved element can still be removed correctly
        ids = registry.getActiveObligationIds();
        assertEq(ids.length, 2);
        assertEq(ids[0], a);
        assertEq(ids[1], c);

        vm.prank(admin);
        registry.cancelObligation(c); // last element
        ids = registry.getActiveObligationIds();
        assertEq(ids.length, 1);
        assertEq(ids[0], a);
        assertEq(registry.amountDueUntil(T0 + 1 days), 1);
    }

    function test_getObligations_batchAndUnknown() public {
        _create(1, T0 + 1 days, 0, 1);
        _create(2, T0 + 2 days, 0, 1);
        uint256[] memory ids = new uint256[](2);
        ids[0] = 2;
        ids[1] = 1;
        Obligation[] memory obs = registry.getObligations(ids);
        assertEq(obs[0].amount, 2);
        assertEq(obs[1].amount, 1);

        vm.expectRevert(abi.encodeWithSelector(UnknownObligation.selector, 0));
        registry.getObligation(0);
    }

    // ---------------------------------------------------------------------------------------- fuzz

    /// @dev Reference implementation: walk occurrences one by one.
    function _reference(uint64 next, uint64 interval, uint32 maxOcc, uint32 paid, uint64 until)
        internal
        pure
        returns (uint256 count)
    {
        uint256 remaining = interval == 0 ? 1 : (maxOcc == 0 ? type(uint256).max : maxOcc - paid);
        uint256 due = next;
        while (count < remaining && due <= until) {
            count += 1;
            if (interval == 0) break;
            due += interval;
        }
    }

    function testFuzz_registry_occurrencesDueUntil(
        uint64 dueOffset,
        uint64 interval,
        uint32 maxOcc,
        uint8 paid,
        uint64 untilOffset
    ) public {
        dueOffset = uint64(bound(dueOffset, 1, 400 days));
        bool recurring = interval % 2 == 1;
        interval = recurring ? uint64(bound(interval, 1 days, 365 days)) : 0;
        if (recurring) {
            maxOcc = maxOcc % 3 == 0 ? 0 : uint32(bound(maxOcc, 2, 60));
        } else {
            maxOcc = 1;
        }
        untilOffset = uint64(bound(untilOffset, 0, 3 * 365 days));

        uint256 id = _create(1e6, T0 + dueOffset, interval, maxOcc);
        uint256 maxPays = maxOcc == 0 ? 20 : maxOcc - 1;
        if (!recurring) maxPays = 0;
        uint256 pays = bound(paid, 0, maxPays);
        for (uint256 i = 0; i < pays; ++i) {
            _pay(id);
        }

        Obligation memory ob = registry.getObligation(id);
        uint64 until = T0 + untilOffset;
        uint256 expected = _reference(ob.nextDueDate, ob.interval, ob.maxOccurrences, ob.paidOccurrences, until);
        assertEq(registry.occurrencesDueUntil(id, until), expected);
        assertEq(registry.amountDueUntil(until), expected * 1e6);
    }
}
