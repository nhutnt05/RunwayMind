// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal Aave V3 types vendored from aave/aave-v3-core @ v1.19.3
///         (contracts/protocol/libraries/types/DataTypes.sol). Field order MUST match upstream: `getReserveData`
///         is ABI-decoded positionally. Aave v3.2+ keeps this exact layout for `getReserveData` (ReserveDataLegacy).
library AaveDataTypes {
    struct ReserveConfigurationMap {
        uint256 data;
    }

    struct ReserveData {
        ReserveConfigurationMap configuration;
        uint128 liquidityIndex; // ray
        uint128 currentLiquidityRate; // ray, supply APR
        uint128 variableBorrowIndex;
        uint128 currentVariableBorrowRate;
        uint128 currentStableBorrowRate;
        uint40 lastUpdateTimestamp;
        uint16 id;
        address aTokenAddress;
        address stableDebtTokenAddress;
        address variableDebtTokenAddress;
        address interestRateStrategyAddress;
        uint128 accruedToTreasury;
        uint128 unbacked;
        uint128 isolationModeTotalDebt;
    }
}

/// @notice Bit positions vendored from aave/aave-v3-core @ v1.19.3
///         (contracts/protocol/libraries/configuration/ReserveConfiguration.sol):
///         IS_ACTIVE_START_BIT_POSITION = 56, IS_FROZEN_START_BIT_POSITION = 57, IS_PAUSED_START_BIT_POSITION = 60.
library AaveReserveConfiguration {
    uint256 internal constant IS_ACTIVE_START_BIT_POSITION = 56;
    uint256 internal constant IS_PAUSED_START_BIT_POSITION = 60;

    function getActive(AaveDataTypes.ReserveConfigurationMap memory self) internal pure returns (bool) {
        return (self.data >> IS_ACTIVE_START_BIT_POSITION) & 1 != 0;
    }

    function getPaused(AaveDataTypes.ReserveConfigurationMap memory self) internal pure returns (bool) {
        return (self.data >> IS_PAUSED_START_BIT_POSITION) & 1 != 0;
    }
}

/// @notice Subset of Aave V3 `IPool` used by AaveV3Adapter (signatures from aave-v3-core v1.19.3 IPool.sol).
interface IAaveV3Pool {
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;

    function withdraw(address asset, uint256 amount, address to) external returns (uint256);

    function getReserveData(address asset) external view returns (AaveDataTypes.ReserveData memory);
}
