// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Ghost variables shared by the invariant handlers (docs/03 §4). Test-only: no access control.
contract GhostState {
    // ---- INV-1 / INV-2 bookkeeping
    uint256 public totalPaid;
    uint256 public poolOps; // deposits / withdrawals; each may lose ≤ 2 base units to pool-favoring rounding
    mapping(address => uint256) public paidTo;

    // ---- INV-7
    mapping(uint256 => uint256) public paysPerId;
    mapping(uint256 => mapping(uint32 => uint256)) public occurrencePays;
    uint256 public maxPaysPerOccurrence;

    // ---- violations recorded by handlers right after the action (INV-2..INV-6)
    mapping(uint8 => uint256) public violations;

    // ---- call statistics (to show the handlers really exercise the paths)
    uint256 public investSuccesses;
    uint256 public investAttemptsWhileBreaker;
    uint256 public withdrawSuccesses;
    uint256 public paySuccesses;
    uint256 public enforceLiquidChecks;
    uint256 public obligationsCreated;

    function recordPay(uint256 id, uint32 occurrence, address recipient, uint256 amount) external {
        totalPaid += amount;
        paidTo[recipient] += amount;
        paysPerId[id] += 1;
        uint256 c = ++occurrencePays[id][occurrence];
        if (c > maxPaysPerOccurrence) maxPaysPerOccurrence = c;
        paySuccesses += 1;
    }

    function addPoolOps(uint256 n) external {
        poolOps += n;
    }

    function flag(uint8 inv) external {
        violations[inv] += 1;
    }

    function incInvestSuccess() external {
        investSuccesses += 1;
    }

    function incInvestWhileBreaker() external {
        investAttemptsWhileBreaker += 1;
    }

    function incWithdrawSuccess() external {
        withdrawSuccesses += 1;
    }

    function incEnforceLiquidCheck() external {
        enforceLiquidChecks += 1;
    }

    function incObligationsCreated() external {
        obligationsCreated += 1;
    }
}
