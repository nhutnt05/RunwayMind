// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

enum Category {
    PAYROLL,
    GRANT,
    VENDOR_INVOICE,
    OTHER
}

enum ObligationStatus {
    ACTIVE,
    COMPLETED,
    CANCELLED
}

struct Obligation {
    uint256 id; // 1-based, sequential
    address recipient;
    uint256 amount; // per occurrence, token base units
    uint64 nextDueDate; // due date of the next unpaid occurrence
    uint64 interval; // 0 = one-time; else seconds between occurrences
    uint32 maxOccurrences; // one-time: 1; recurring: 0 = unlimited, else >= 2
    uint32 paidOccurrences;
    Category category;
    ObligationStatus status;
    bytes32 metadataHash; // keccak256 of canonical off-chain metadata JSON (label, notes)
    uint64 createdAt; // clock time at creation
}

struct ObligationInput {
    address recipient;
    uint256 amount;
    uint64 firstDueDate;
    uint64 interval;
    uint32 maxOccurrences;
    Category category;
    bytes32 metadataHash;
}

interface IObligationRegistry {
    event ObligationCreated(
        uint256 indexed id,
        address indexed recipient,
        uint256 amount,
        uint64 firstDueDate,
        uint64 interval,
        uint32 maxOccurrences,
        Category category,
        bytes32 metadataHash
    );
    event ObligationUpdated(uint256 indexed id, address recipient, uint256 amount, uint64 nextDueDate);
    event ObligationCancelled(uint256 indexed id);
    event ObligationOccurrencePaid(uint256 indexed id, uint32 occurrence, uint64 nextDueDate);
    event ObligationCompleted(uint256 indexed id);
    event ClockSet(address clock);

    function setClock(address clock) external; // ADMIN, once
    function createObligation(ObligationInput calldata input) external returns (uint256 id); // ADMIN
    function updateObligation(uint256 id, address recipient, uint256 amount, uint64 nextDueDate) external; // ADMIN
    function cancelObligation(uint256 id) external; // ADMIN
    function markPaid(uint256 id) external returns (address recipient, uint256 amount, uint32 occurrence); // TREASURY_ROLE

    function getObligation(uint256 id) external view returns (Obligation memory);
    function getActiveObligationIds() external view returns (uint256[] memory);
    function getObligations(uint256[] calldata ids) external view returns (Obligation[] memory);
    function obligationCount() external view returns (uint256);
    function activeObligationCount() external view returns (uint256);
    function occurrencesDueUntil(uint256 id, uint64 until) external view returns (uint256 count);
    function amountDueUntil(uint64 until) external view returns (uint256 total);
}
