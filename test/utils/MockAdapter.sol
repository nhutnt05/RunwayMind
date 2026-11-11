// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IVaultAdapter} from "../../contracts/interfaces/IVaultAdapter.sol";

/// @notice Minimal IVaultAdapter with a settable balance — for PolicyEngine whitelist tests.
contract MockAdapter is IVaultAdapter {
    address public asset;
    address public treasury;
    uint256 public balance;

    constructor(address asset_, address treasury_) {
        asset = asset_;
        treasury = treasury_;
    }

    function setBalance(uint256 b) external {
        balance = b;
    }

    function pool() external pure returns (address) {
        return address(0);
    }

    function name() external pure returns (string memory) {
        return "MockAdapter";
    }

    function deposit(uint256) external {}

    function withdraw(uint256) external pure returns (uint256) {
        return 0;
    }

    function getAPY() external pure returns (uint256) {
        return 0;
    }

    function isPaused() external pure returns (bool) {
        return false;
    }

    function availableLiquidity() external pure returns (uint256) {
        return 0;
    }

    function utilizationBps() external pure returns (uint256) {
        return 0;
    }

    function tvl() external pure returns (uint256) {
        return 0;
    }
}
