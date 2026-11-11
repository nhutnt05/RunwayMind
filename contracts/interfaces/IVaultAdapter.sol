// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Shared by VaultAdapter and AaveV3Adapter (docs/02 §D.2).
interface IVaultAdapter {
    function asset() external view returns (address);
    function treasury() external view returns (address);
    function pool() external view returns (address);
    function name() external view returns (string memory);

    function deposit(uint256 amount) external; // onlyTreasury; tokens already transferred in
    function withdraw(uint256 amount) external returns (uint256); // onlyTreasury; sends to treasury()

    function balance() external view returns (uint256); // principal + accrued interest
    function getAPY() external view returns (uint256 apyBps);
    function isPaused() external view returns (bool);
    function availableLiquidity() external view returns (uint256); // withdrawable now from the pool
    function utilizationBps() external view returns (uint256);
    function tvl() external view returns (uint256);
}
