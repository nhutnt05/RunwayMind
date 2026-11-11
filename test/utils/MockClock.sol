// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IClock} from "../../contracts/interfaces/IClock.sol";

/// @notice IClock with a settable time, for unit tests that do not deploy a Treasury.
contract MockClock is IClock {
    uint64 public time;

    constructor(uint64 t) {
        time = t;
    }

    function set(uint64 t) external {
        time = t;
    }

    function advance(uint64 secondsToAdd) external {
        time += secondsToAdd;
    }

    function currentTime() external view returns (uint64) {
        return time;
    }
}
