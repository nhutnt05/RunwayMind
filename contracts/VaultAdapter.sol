// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IVaultAdapter} from "./interfaces/IVaultAdapter.sol";
import {IMockLendingPool} from "./interfaces/IMockLendingPool.sol";
import {ZeroAddress, ZeroAmount, NotTreasury} from "./libraries/Errors.sol";

/// @title VaultAdapter (docs/02 §D.3)
/// @notice IVaultAdapter for MockLendingPool. Holds the pool position for a single Treasury and sends withdrawals
///         ONLY to that Treasury. There is no function that can send tokens anywhere else.
contract VaultAdapter is IVaultAdapter {
    using SafeERC20 for IERC20;

    address public immutable asset;
    address public immutable treasury;
    address public immutable pool;
    string public name;

    modifier onlyTreasury() {
        if (msg.sender != treasury) revert NotTreasury();
        _;
    }

    /// @dev "Validate supported pools": the pool must be a contract with a non-zero asset. An EOA pool is rejected
    ///      with ZeroAddress (the catalog has no dedicated error).
    constructor(IMockLendingPool pool_, address treasury_, string memory name_) {
        if (address(pool_) == address(0) || treasury_ == address(0)) revert ZeroAddress();
        if (address(pool_).code.length == 0) revert ZeroAddress();
        address asset_ = pool_.asset();
        if (asset_ == address(0)) revert ZeroAddress();
        pool = address(pool_);
        treasury = treasury_;
        asset = asset_;
        name = name_;
    }

    function deposit(uint256 amount) external onlyTreasury {
        if (amount == 0) revert ZeroAmount();
        IERC20(asset).forceApprove(pool, amount);
        IMockLendingPool(pool).deposit(amount);
    }

    function withdraw(uint256 amount) external onlyTreasury returns (uint256) {
        return IMockLendingPool(pool).withdraw(amount, treasury);
    }

    function balance() external view returns (uint256) {
        return IMockLendingPool(pool).balanceOf(address(this));
    }

    function getAPY() external view returns (uint256 apyBps) {
        return IMockLendingPool(pool).apyBps();
    }

    function isPaused() external view returns (bool) {
        return IMockLendingPool(pool).paused();
    }

    function availableLiquidity() external view returns (uint256) {
        return IMockLendingPool(pool).availableLiquidity();
    }

    function utilizationBps() external view returns (uint256) {
        return IMockLendingPool(pool).utilizationBps();
    }

    /// @notice Cash held by the pool incl. interest reserve (the Mock has no external depositors).
    function tvl() external view returns (uint256) {
        return IERC20(asset).balanceOf(pool);
    }
}
