// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CommonBase} from "forge-std/Base.sol";
import {StdCheats} from "forge-std/StdCheats.sol";
import {StdUtils} from "forge-std/StdUtils.sol";
import {MockUSDC} from "../../../contracts/mocks/MockUSDC.sol";
import {MockLendingPool} from "../../../contracts/mocks/MockLendingPool.sol";
import {ObligationRegistry} from "../../../contracts/ObligationRegistry.sol";
import {PolicyEngine} from "../../../contracts/PolicyEngine.sol";
import {Treasury} from "../../../contracts/Treasury.sol";
import {VaultAdapter} from "../../../contracts/VaultAdapter.sol";
import {GhostState} from "./GhostState.sol";

/// @notice Everything a handler needs to reach the system under test.
struct Ctx {
    MockUSDC usdc;
    ObligationRegistry registry;
    PolicyEngine policy;
    Treasury treasury;
    MockLendingPool pool0;
    MockLendingPool pool1;
    VaultAdapter adapter0;
    VaultAdapter adapter1;
    address admin;
    address agent;
    address keeper;
    GhostState ghost;
}

abstract contract HandlerBase is CommonBase, StdCheats, StdUtils {
    MockUSDC internal usdc;
    ObligationRegistry internal registry;
    PolicyEngine internal policy;
    Treasury internal treasury;
    MockLendingPool internal pool0;
    MockLendingPool internal pool1;
    VaultAdapter internal adapter0;
    VaultAdapter internal adapter1;
    address internal admin;
    address internal agent;
    address internal keeper;
    GhostState internal ghost;

    constructor(Ctx memory c) {
        usdc = c.usdc;
        registry = c.registry;
        policy = c.policy;
        treasury = c.treasury;
        pool0 = c.pool0;
        pool1 = c.pool1;
        adapter0 = c.adapter0;
        adapter1 = c.adapter1;
        admin = c.admin;
        agent = c.agent;
        keeper = c.keeper;
        ghost = c.ghost;
    }

    function _adapter(uint256 seed) internal view returns (VaultAdapter) {
        return seed % 2 == 0 ? adapter0 : adapter1;
    }

    function _pool(uint256 seed) internal view returns (MockLendingPool) {
        return seed % 2 == 0 ? pool0 : pool1;
    }

    /// @dev INV-4 precondition: every pool can pay out the adapter's whole claim right now.
    function _allPoolsLiquid() internal view returns (bool) {
        return _liquid(adapter0, pool0) && _liquid(adapter1, pool1);
    }

    function _liquid(VaultAdapter a, MockLendingPool p) private view returns (bool) {
        return !p.paused() && p.availableLiquidity() >= a.balance();
    }
}
