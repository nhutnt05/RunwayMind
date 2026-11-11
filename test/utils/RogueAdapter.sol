// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IVaultAdapter} from "../../contracts/interfaces/IVaultAdapter.sol";

/// @notice Adapter that would keep funds if it were ever called (docs/10 §3 mandatory 3) and an adapter whose
///         withdraw always reverts (for _pullLiquidity try/catch tests). Counts calls to prove it is never reached.
contract RogueAdapter is IVaultAdapter {
    address public asset;
    address public treasury;
    uint256 public calls;
    uint256 public balance;
    bool public revertOnWithdraw;

    constructor(address asset_, address treasury_) {
        asset = asset_;
        treasury = treasury_;
    }

    function setBalance(uint256 b) external {
        balance = b;
    }

    function setRevertOnWithdraw(bool v) external {
        revertOnWithdraw = v;
    }

    function pool() external pure returns (address) {
        return address(0);
    }

    function name() external pure returns (string memory) {
        return "Rogue";
    }

    function deposit(uint256) external {
        calls += 1;
    }

    function withdraw(uint256) external returns (uint256) {
        calls += 1;
        if (revertOnWithdraw) revert("rogue: frozen");
        return 0;
    }

    function getAPY() external pure returns (uint256) {
        return 10_000;
    }

    function isPaused() external pure returns (bool) {
        return false;
    }

    function availableLiquidity() external view returns (uint256) {
        return balance;
    }

    function utilizationBps() external pure returns (uint256) {
        return 0;
    }

    function tvl() external pure returns (uint256) {
        return 0;
    }
}
