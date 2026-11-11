// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IVaultAdapter} from "../interfaces/IVaultAdapter.sol";
import {ZeroAddress, ZeroAmount, NotTreasury} from "../libraries/Errors.sol";
import {IAaveV3Pool, AaveDataTypes, AaveReserveConfiguration} from "./aave/IAaveV3Pool.sol";

/// @title AaveV3Adapter (docs/02 §G, SHOULD — REQ-091, fork-test only)
/// @notice IVaultAdapter over a real Aave V3 reserve. Holds the aToken position for a single Treasury and sends
///         withdrawals ONLY to that Treasury (R5). Proves the Treasury/PolicyEngine work unchanged with a real protocol.
contract AaveV3Adapter is IVaultAdapter {
    using SafeERC20 for IERC20;
    using AaveReserveConfiguration for AaveDataTypes.ReserveConfigurationMap;

    uint256 private constant RAY = 1e27;

    address public immutable asset;
    address public immutable treasury;
    address public immutable pool;
    /// @notice Resolved from `getReserveData(asset).aTokenAddress` at construction (no hard-coded aToken).
    address public immutable aToken;

    modifier onlyTreasury() {
        if (msg.sender != treasury) revert NotTreasury();
        _;
    }

    constructor(IAaveV3Pool aavePool, IERC20 asset_, address treasury_) {
        if (address(aavePool) == address(0) || address(asset_) == address(0) || treasury_ == address(0)) {
            revert ZeroAddress();
        }
        if (address(aavePool).code.length == 0) revert ZeroAddress();
        address aToken_ = aavePool.getReserveData(address(asset_)).aTokenAddress;
        if (aToken_ == address(0)) revert ZeroAddress(); // asset is not an Aave reserve
        pool = address(aavePool);
        asset = address(asset_);
        treasury = treasury_;
        aToken = aToken_;
    }

    function name() external pure returns (string memory) {
        return "Aave V3";
    }

    function deposit(uint256 amount) external onlyTreasury {
        if (amount == 0) revert ZeroAmount();
        IERC20(asset).forceApprove(pool, amount);
        IAaveV3Pool(pool).supply(asset, amount, address(this), 0);
    }

    function withdraw(uint256 amount) external onlyTreasury returns (uint256) {
        return IAaveV3Pool(pool).withdraw(asset, amount, treasury);
    }

    function balance() external view returns (uint256) {
        return IERC20(aToken).balanceOf(address(this));
    }

    /// @notice Supply APR from `currentLiquidityRate` (RAY) converted to bps.
    function getAPY() external view returns (uint256 apyBps) {
        return (uint256(_reserve().currentLiquidityRate) * 10_000) / RAY;
    }

    /// @notice True when the reserve is paused or not active (bits 60 / 56 of the configuration map).
    function isPaused() external view returns (bool) {
        AaveDataTypes.ReserveConfigurationMap memory cfg = _reserve().configuration;
        return cfg.getPaused() || !cfg.getActive();
    }

    function availableLiquidity() external view returns (uint256) {
        return IERC20(asset).balanceOf(aToken);
    }

    /// @notice Total debt / total aToken supply, in bps.
    function utilizationBps() external view returns (uint256) {
        AaveDataTypes.ReserveData memory r = _reserve();
        uint256 supplied = IERC20(aToken).totalSupply();
        if (supplied == 0) return 0;
        uint256 debt = _supply(r.variableDebtTokenAddress) + _supply(r.stableDebtTokenAddress);
        uint256 u = (debt * 10_000) / supplied;
        return u > 10_000 ? 10_000 : u;
    }

    /// @notice Total aToken supply (all depositors' claims on the reserve).
    function tvl() external view returns (uint256) {
        return IERC20(aToken).totalSupply();
    }

    function _reserve() private view returns (AaveDataTypes.ReserveData memory) {
        return IAaveV3Pool(pool).getReserveData(asset);
    }

    /// @dev Aave v3.2+ removed stable debt; its token address may be zero.
    function _supply(address token) private view returns (uint256) {
        return token == address(0) ? 0 : IERC20(token).totalSupply();
    }
}
