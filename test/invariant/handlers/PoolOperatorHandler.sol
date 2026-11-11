// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MockLendingPool} from "../../../contracts/mocks/MockLendingPool.sol";
import {HandlerBase, Ctx} from "./HandlerBase.sol";

/// @notice Pool operator (MockLendingPool owner = admin): APY, pause, utilization, liquidity shortage.
contract PoolOperatorHandler is HandlerBase {
    constructor(Ctx memory c) HandlerBase(c) {}

    function setAPY(uint256 poolSeed, uint256 apySeed) external {
        MockLendingPool p = _pool(poolSeed);
        vm.prank(admin);
        p.setAPY(bound(apySeed, 0, 3000));
    }

    /// @dev Biased towards un-pausing so pools are not paused most of the time.
    function setPaused(uint256 poolSeed, uint256 seed) external {
        MockLendingPool p = _pool(poolSeed);
        vm.prank(admin);
        p.setPaused(seed % 3 == 0);
    }

    function setUtilization(uint256 poolSeed, uint256 bps) external {
        MockLendingPool p = _pool(poolSeed);
        vm.prank(admin);
        p.setUtilization(bound(bps, 0, 10_000));
    }

    function setLiquidityShortage(uint256 poolSeed, uint256 seed) external {
        MockLendingPool p = _pool(poolSeed);
        vm.prank(admin);
        p.setLiquidityShortage(seed % 3 == 0);
    }
}
