// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IMockLendingPool {
    event Deposited(address indexed account, uint256 amount, uint256 scaledMinted);
    event Withdrawn(address indexed account, address indexed to, uint256 amount, uint256 scaledBurned);
    event ApyUpdated(uint256 oldBps, uint256 newBps);
    event PausedSet(bool paused);
    event UtilizationUpdated(uint256 bps);
    event LiquidityShortageSet(bool enabled);
    event InterestReserveFunded(address indexed from, uint256 amount);

    function asset() external view returns (address);
    function clock() external view returns (address);
    function deposit(uint256 amount) external; // whenNotPaused
    function withdraw(uint256 amount, address to) external returns (uint256); // whenNotPaused; max = full balance
    function balanceOf(address account) external view returns (uint256);
    function totalAssets() external view returns (uint256);
    function availableLiquidity() external view returns (uint256);
    function currentIndex() external view returns (uint256);
    function apyBps() external view returns (uint256);
    function paused() external view returns (bool);
    function utilizationBps() external view returns (uint256);

    // owner (demo operator)
    function setAPY(uint256 newApyBps) external; // <= 10_000, accrues first
    function setPaused(bool paused_) external;
    function setUtilization(uint256 bps) external; // <= 10_000, reported utilization
    function setLiquidityShortage(bool enabled) external; // utilization restricts withdrawals
    function liquidityShortage() external view returns (bool);
    // anyone
    function fundInterestReserve(uint256 amount) external;
}
