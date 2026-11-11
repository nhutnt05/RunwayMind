// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IClock {
    function currentTime() external view returns (uint64);
}
