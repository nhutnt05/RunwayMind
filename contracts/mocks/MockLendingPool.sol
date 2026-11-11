// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IClock} from "../interfaces/IClock.sol";
import {IMockLendingPool} from "../interfaces/IMockLendingPool.sol";
import {ZeroAmount, ZeroAddress, PoolPaused, InsufficientPoolLiquidity, InvalidBps} from "../libraries/Errors.sol";

/// @title MockLendingPool — MOCK lending pool for the demo (docs/02 §E)
/// @notice Aave-style liquidity index (RAY), configurable APY / pause / reported utilization / liquidity shortage.
///         Reads time from IClock (the Treasury) so DEMO time travel accrues interest consistently (A-04).
contract MockLendingPool is Ownable, IMockLendingPool {
    using SafeERC20 for IERC20;

    uint256 public constant RAY = 1e27;
    uint256 public constant SECONDS_PER_YEAR = 365 days;
    uint256 private constant BPS = 10_000;

    IERC20 private immutable _asset;
    IClock private immutable _clock;

    uint256 public liquidityIndex;
    uint64 public lastUpdate;
    uint256 public apyBps;
    bool public paused;
    uint256 public utilizationBps;
    bool public liquidityShortage;
    mapping(address => uint256) public scaledBalanceOf;
    uint256 public totalScaled;

    modifier whenNotPaused() {
        if (paused) revert PoolPaused();
        _;
    }

    constructor(IERC20 asset_, IClock clock_, address owner_, uint256 initialApyBps) Ownable(owner_) {
        if (address(asset_) == address(0) || address(clock_) == address(0)) revert ZeroAddress();
        if (initialApyBps > BPS) revert InvalidBps(initialApyBps);
        _asset = asset_;
        _clock = clock_;
        apyBps = initialApyBps;
        liquidityIndex = RAY;
        lastUpdate = clock_.currentTime();
    }

    // ------------------------------------------------------------------------------------------------ core

    function deposit(uint256 amount) external whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        uint256 index = _accrue();
        uint256 scaled = (amount * RAY) / index; // round down
        _asset.safeTransferFrom(msg.sender, address(this), amount);
        scaledBalanceOf[msg.sender] += scaled;
        totalScaled += scaled;
        emit Deposited(msg.sender, amount, scaled);
    }

    /// @notice `amount == type(uint256).max` withdraws the full balance.
    function withdraw(uint256 amount, address to) external whenNotPaused returns (uint256) {
        if (to == address(0)) revert ZeroAddress();
        uint256 index = _accrue();
        uint256 bal = (scaledBalanceOf[msg.sender] * index) / RAY;
        if (amount == type(uint256).max) amount = bal;
        if (amount == 0) revert ZeroAmount();
        if (amount > bal) revert InsufficientPoolLiquidity(amount, bal);
        uint256 available = availableLiquidity();
        if (amount > available) revert InsufficientPoolLiquidity(amount, available);

        uint256 burn = Math.mulDiv(amount, RAY, index, Math.Rounding.Ceil); // round up (pool-favoring)
        uint256 scaledBal = scaledBalanceOf[msg.sender];
        if (burn > scaledBal) burn = scaledBal; // only reachable when withdrawing the exact full balance
        scaledBalanceOf[msg.sender] = scaledBal - burn;
        totalScaled -= burn;
        _asset.safeTransfer(to, amount);
        emit Withdrawn(msg.sender, to, amount, burn);
        return amount;
    }

    function fundInterestReserve(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        _asset.safeTransferFrom(msg.sender, address(this), amount);
        emit InterestReserveFunded(msg.sender, amount);
    }

    // ------------------------------------------------------------------------------------------------ owner

    function setAPY(uint256 newApyBps) external onlyOwner {
        if (newApyBps > BPS) revert InvalidBps(newApyBps);
        _accrue();
        uint256 old = apyBps;
        apyBps = newApyBps;
        emit ApyUpdated(old, newApyBps);
    }

    function setPaused(bool paused_) external onlyOwner {
        paused = paused_;
        emit PausedSet(paused_);
    }

    function setUtilization(uint256 bps) external onlyOwner {
        if (bps > BPS) revert InvalidBps(bps);
        utilizationBps = bps;
        emit UtilizationUpdated(bps);
    }

    function setLiquidityShortage(bool enabled) external onlyOwner {
        liquidityShortage = enabled;
        emit LiquidityShortageSet(enabled);
    }

    // ------------------------------------------------------------------------------------------------ views

    function asset() external view returns (address) {
        return address(_asset);
    }

    function clock() external view returns (address) {
        return address(_clock);
    }

    function currentIndex() public view returns (uint256) {
        uint64 nowTs = _clock.currentTime();
        if (nowTs <= lastUpdate) return liquidityIndex;
        return liquidityIndex + (liquidityIndex * apyBps * (nowTs - lastUpdate)) / (BPS * SECONDS_PER_YEAR);
    }

    function balanceOf(address account) external view returns (uint256) {
        return (scaledBalanceOf[account] * currentIndex()) / RAY; // round down
    }

    function totalAssets() external view returns (uint256) {
        return (totalScaled * currentIndex()) / RAY;
    }

    function availableLiquidity() public view returns (uint256) {
        uint256 cash = _asset.balanceOf(address(this));
        return liquidityShortage ? (cash * (BPS - utilizationBps)) / BPS : cash;
    }

    // ------------------------------------------------------------------------------------------------ internal

    function _accrue() private returns (uint256 index) {
        index = currentIndex();
        liquidityIndex = index;
        uint64 nowTs = _clock.currentTime();
        if (nowTs > lastUpdate) lastUpdate = nowTs;
    }
}
