// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Global custom-error catalog (docs/02 §0.3). Names are part of the API: the backend decodes them.
// Declared at file level so every contract reverts with the identical selector.

error ZeroAmount();
error ZeroAddress();
error CircuitBreakerActive();
error AdapterNotWhitelisted(address adapter);
error AdapterUnknown(address adapter);
error AdapterMismatch(address adapter);
error ReserveViolation(uint256 idleAfter, uint256 requiredReserve);
error ExposureLimitExceeded(uint256 adapterBalanceAfter, uint256 cap);
error InsufficientIdle(uint256 requested, uint256 idle);
error InsufficientLiquidity(uint256 needed, uint256 available);
error ObligationNotDue(uint256 id, uint64 dueDate, uint64 nowTs);
error UnknownObligation(uint256 id);
error ObligationNotActive(uint256 id);
error InvalidRecipient();
error InvalidAmount();
error DueDateInPast(uint64 dueDate, uint64 nowTs);
error InvalidInterval(uint64 interval);
error InvalidOccurrences();
error TooManyActiveObligations();
error ClockAlreadySet();
error ClockNotSet();
error InvalidParameter(bytes32 name);
error TooManyAdapters();
error AdapterHasBalance(address adapter, uint256 balance);
error NotDemoMode();
error InvalidTimeOffset(uint64 current, uint64 requested);
error NotTreasury();
error PoolPaused();
error InsufficientPoolLiquidity(uint256 requested, uint256 available);
error InvalidBps(uint256 value);
