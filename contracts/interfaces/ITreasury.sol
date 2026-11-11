// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IClock} from "./IClock.sol";

interface ITreasury is IClock {
    // ---- events ----
    event Invested(address indexed adapter, uint256 amount, address indexed caller, uint256 idleAfter);
    event Withdrawn(address indexed adapter, uint256 requested, uint256 received, address indexed caller);
    event DeadlineEnforced(address indexed caller, uint256 shortfallBefore, uint256 withdrawn);
    event ObligationPaid(
        uint256 indexed id, address indexed recipient, uint256 amount, uint32 occurrence, address indexed caller
    );
    event AdapterWithdrawFailed(address indexed adapter, uint256 amount, bytes reason);
    event CircuitBreakerTripped(address indexed by);
    event CircuitBreakerReset(address indexed by);
    event TimeOffsetUpdated(uint64 oldOffset, uint64 newOffset);

    // ---- AGENT / ADMIN ----
    function invest(address adapter, uint256 amount) external;
    function withdraw(address adapter, uint256 amount) external returns (uint256 received);
    function tripCircuitBreaker() external;

    // ---- ADMIN ----
    function resetCircuitBreaker() external;
    function setTimeOffset(uint64 newOffset) external; // DEMO MODE only
    function advanceTime(uint64 secondsToAdd) external; // DEMO MODE only

    // ---- anyone (keeper) ----
    function pay(uint256 obligationId) external;
    function enforceDeadlines() external returns (uint256 withdrawn);

    // ---- views ----
    function asset() external view returns (address);
    function registry() external view returns (address);
    function policy() external view returns (address);
    function demoMode() external view returns (bool);
    function timeOffset() external view returns (uint64);
    function circuitBreakerActive() external view returns (bool);
    function idleBalance() external view returns (uint256);
    function vaultBalance(address adapter) external view returns (uint256);
    function totalAssets() external view returns (uint256);
    function requiredReserve() external view returns (uint256);
    function shortfall() external view returns (uint256);
    function maxInvestable(address adapter) external view returns (uint256);
}
