// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IClock} from "./interfaces/IClock.sol";
import {
    IObligationRegistry,
    Obligation,
    ObligationInput,
    ObligationStatus,
    Category
} from "./interfaces/IObligationRegistry.sol";
import {
    ZeroAddress,
    ClockAlreadySet,
    ClockNotSet,
    InvalidRecipient,
    InvalidAmount,
    DueDateInPast,
    InvalidInterval,
    InvalidOccurrences,
    TooManyActiveObligations,
    UnknownObligation,
    ObligationNotActive
} from "./libraries/Errors.sol";

/// @title ObligationRegistry (docs/02 §B)
/// @notice Stores obligations (amount, recipient, due date, recurrence, status) and computes amounts due before a
///         time, which PolicyEngine uses for R1/R2.
contract ObligationRegistry is AccessControl, IObligationRegistry {
    bytes32 public constant TREASURY_ROLE = keccak256("TREASURY_ROLE");
    uint256 public constant MAX_ACTIVE_OBLIGATIONS = 50;
    uint64 public constant MIN_INTERVAL = 1 days;
    uint64 public constant MAX_INTERVAL = 365 days;

    /// @notice Clock (the Treasury). Set once by ADMIN.
    address public clock;

    uint256 private _count;
    mapping(uint256 => Obligation) private _obligations;
    uint256[] private _activeIds;
    mapping(uint256 => uint256) private _activeIndexPlusOne; // id => index in _activeIds + 1 (0 = not active)

    constructor(address admin) {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ------------------------------------------------------------------------------------------------ ADMIN

    function setClock(address clock_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (clock != address(0)) revert ClockAlreadySet();
        if (clock_ == address(0)) revert ZeroAddress();
        clock = clock_;
        emit ClockSet(clock_);
    }

    function createObligation(ObligationInput calldata input)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        returns (uint256 id)
    {
        address clock_ = clock;
        if (clock_ == address(0)) revert ClockNotSet(); // V1
        if (input.recipient == address(0) || input.recipient == clock_) revert InvalidRecipient(); // V2
        if (input.amount == 0) revert InvalidAmount(); // V3
        uint64 nowTs = IClock(clock_).currentTime();
        if (input.firstDueDate <= nowTs) revert DueDateInPast(input.firstDueDate, nowTs); // V4
        if (input.interval != 0 && (input.interval < MIN_INTERVAL || input.interval > MAX_INTERVAL)) {
            revert InvalidInterval(input.interval); // V5
        }
        if (input.interval == 0 ? input.maxOccurrences != 1 : input.maxOccurrences == 1) {
            revert InvalidOccurrences(); // V6
        }
        if (_activeIds.length >= MAX_ACTIVE_OBLIGATIONS) revert TooManyActiveObligations(); // V7

        id = ++_count;
        _obligations[id] = Obligation({
            id: id,
            recipient: input.recipient,
            amount: input.amount,
            nextDueDate: input.firstDueDate,
            interval: input.interval,
            maxOccurrences: input.maxOccurrences,
            paidOccurrences: 0,
            category: input.category,
            status: ObligationStatus.ACTIVE,
            metadataHash: input.metadataHash,
            createdAt: nowTs
        });
        _activeIds.push(id);
        _activeIndexPlusOne[id] = _activeIds.length;

        emit ObligationCreated(
            id,
            input.recipient,
            input.amount,
            input.firstDueDate,
            input.interval,
            input.maxOccurrences,
            input.category,
            input.metadataHash
        );
    }

    /// @notice Interval and occurrences are immutable; cancel and recreate to change them.
    function updateObligation(uint256 id, address recipient, uint256 amount, uint64 nextDueDate)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        Obligation storage ob = _activeObligation(id);
        address clock_ = clock;
        if (recipient == address(0) || recipient == clock_) revert InvalidRecipient(); // V2
        if (amount == 0) revert InvalidAmount(); // V3
        uint64 nowTs = IClock(clock_).currentTime();
        if (nextDueDate <= nowTs) revert DueDateInPast(nextDueDate, nowTs); // V4

        ob.recipient = recipient;
        ob.amount = amount;
        ob.nextDueDate = nextDueDate;
        emit ObligationUpdated(id, recipient, amount, nextDueDate);
    }

    function cancelObligation(uint256 id) external onlyRole(DEFAULT_ADMIN_ROLE) {
        Obligation storage ob = _activeObligation(id);
        ob.status = ObligationStatus.CANCELLED;
        _removeActive(id);
        emit ObligationCancelled(id);
    }

    // ------------------------------------------------------------------------------------------------ TREASURY

    /// @dev docs/02 §B.5. Overdue recurring obligations are paid one occurrence per call.
    function markPaid(uint256 id)
        external
        onlyRole(TREASURY_ROLE)
        returns (address recipient, uint256 amount, uint32 occurrence)
    {
        Obligation storage ob = _activeObligation(id);
        ob.paidOccurrences += 1;
        occurrence = ob.paidOccurrences;
        if (ob.interval == 0 || (ob.maxOccurrences != 0 && ob.paidOccurrences == ob.maxOccurrences)) {
            ob.status = ObligationStatus.COMPLETED;
            _removeActive(id);
            emit ObligationCompleted(id);
        } else {
            ob.nextDueDate += ob.interval; // may still be <= now if overdue
        }
        emit ObligationOccurrencePaid(id, occurrence, ob.nextDueDate);
        return (ob.recipient, ob.amount, occurrence);
    }

    // ------------------------------------------------------------------------------------------------ views

    function getObligation(uint256 id) external view returns (Obligation memory) {
        if (id == 0 || id > _count) revert UnknownObligation(id);
        return _obligations[id];
    }

    function getActiveObligationIds() external view returns (uint256[] memory) {
        return _activeIds;
    }

    function getObligations(uint256[] calldata ids) external view returns (Obligation[] memory out) {
        out = new Obligation[](ids.length);
        for (uint256 i = 0; i < ids.length; ++i) {
            uint256 id = ids[i];
            if (id == 0 || id > _count) revert UnknownObligation(id);
            out[i] = _obligations[id];
        }
    }

    function obligationCount() external view returns (uint256) {
        return _count;
    }

    function activeObligationCount() external view returns (uint256) {
        return _activeIds.length;
    }

    /// @dev docs/02 §B.6. Boundary inclusive; includes overdue unpaid occurrences.
    function occurrencesDueUntil(uint256 id, uint64 until) public view returns (uint256 count) {
        if (id == 0 || id > _count) return 0;
        Obligation storage ob = _obligations[id];
        if (ob.status != ObligationStatus.ACTIVE || until < ob.nextDueDate) return 0;
        count = ob.interval == 0 ? 1 : uint256(until - ob.nextDueDate) / ob.interval + 1;
        if (ob.maxOccurrences != 0) {
            uint256 remaining = ob.maxOccurrences - ob.paidOccurrences;
            if (count > remaining) count = remaining;
        }
    }

    function amountDueUntil(uint64 until) external view returns (uint256 total) {
        uint256 n = _activeIds.length; // <= MAX_ACTIVE_OBLIGATIONS
        for (uint256 i = 0; i < n; ++i) {
            uint256 id = _activeIds[i];
            total += occurrencesDueUntil(id, until) * _obligations[id].amount;
        }
    }

    // ------------------------------------------------------------------------------------------------ internal

    function _activeObligation(uint256 id) private view returns (Obligation storage ob) {
        if (id == 0 || id > _count) revert UnknownObligation(id);
        ob = _obligations[id];
        if (ob.status != ObligationStatus.ACTIVE) revert ObligationNotActive(id);
    }

    /// @dev Swap-and-pop removal from the active set.
    function _removeActive(uint256 id) private {
        uint256 idx = _activeIndexPlusOne[id] - 1;
        uint256 lastIdx = _activeIds.length - 1;
        if (idx != lastIdx) {
            uint256 lastId = _activeIds[lastIdx];
            _activeIds[idx] = lastId;
            _activeIndexPlusOne[lastId] = idx + 1;
        }
        _activeIds.pop();
        delete _activeIndexPlusOne[id];
    }
}
