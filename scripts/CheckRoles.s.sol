// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {ObligationRegistry} from "../contracts/ObligationRegistry.sol";
import {PolicyEngine} from "../contracts/PolicyEngine.sol";
import {Treasury} from "../contracts/Treasury.sol";
import {MockLendingPool} from "../contracts/mocks/MockLendingPool.sol";
import {AdapterStatus} from "../contracts/interfaces/IPolicyEngine.sol";
import {DeploymentPaths} from "./DeploymentPaths.sol";

/// @notice Prints and asserts every role holder and the adapter status (docs/11 §8 checklist). Read-only.
contract CheckRoles is Script, DeploymentPaths {
    struct Loaded {
        Treasury treasury;
        ObligationRegistry registry;
        PolicyEngine policy;
        MockLendingPool pool;
        address adapter;
        address admin;
        address agent;
    }

    function run() external view {
        Loaded memory d = _load();
        _checkAdmin(d);
        _checkAgent(d);
        _checkWiring(d);
        console2.log("demoMode:", d.treasury.demoMode());
        console2.log("requiredReserve:", d.treasury.requiredReserve());
        console2.log("CheckRoles: OK");
    }

    function _load() internal view returns (Loaded memory d) {
        string memory json = vm.readFile(deploymentPath());
        d.treasury = Treasury(vm.parseJsonAddress(json, ".contracts.Treasury"));
        d.registry = ObligationRegistry(vm.parseJsonAddress(json, ".contracts.ObligationRegistry"));
        d.policy = PolicyEngine(vm.parseJsonAddress(json, ".contracts.PolicyEngine"));
        d.pool = MockLendingPool(vm.parseJsonAddress(json, ".contracts.MockLendingPool"));
        d.adapter = vm.parseJsonAddress(json, ".contracts.VaultAdapter");
        d.admin = vm.parseJsonAddress(json, ".roles.admin");
        d.agent = vm.parseJsonAddress(json, ".roles.agent");
    }

    function _checkAdmin(Loaded memory d) internal view {
        bool t = d.treasury.hasRole(0x00, d.admin);
        bool r = d.registry.hasRole(0x00, d.admin);
        bool p = d.policy.hasRole(0x00, d.admin);
        console2.log("ADMIN", d.admin);
        console2.log("  DEFAULT_ADMIN_ROLE on Treasury / Registry / Policy:", t, r, p);
        require(t && r && p, "ADMIN role missing");
        bool owner = d.pool.owner() == d.admin;
        console2.log("  MockLendingPool owner is ADMIN:", owner);
        require(owner, "pool owner mismatch");
    }

    function _checkAgent(Loaded memory d) internal view {
        bool hasAgent = d.treasury.hasRole(d.treasury.AGENT_ROLE(), d.agent);
        bool notAdmin = !d.treasury.hasRole(0x00, d.agent);
        console2.log("AGENT", d.agent);
        console2.log("  AGENT_ROLE on Treasury:", hasAgent);
        console2.log("  AGENT is not ADMIN:", notAdmin);
        require(hasAgent, "AGENT_ROLE missing");
        require(notAdmin, "AGENT must not be ADMIN");
    }

    function _checkWiring(Loaded memory d) internal view {
        bool treasuryRole = d.registry.hasRole(d.registry.TREASURY_ROLE(), address(d.treasury));
        bool active = d.policy.adapterStatus(d.adapter) == AdapterStatus.ACTIVE;
        bool clock = d.registry.clock() == address(d.treasury) && d.pool.clock() == address(d.treasury);
        console2.log("TREASURY_ROLE on Registry held by Treasury:", treasuryRole);
        console2.log("VaultAdapter ACTIVE:", active);
        console2.log("Clock wired (registry + pool -> Treasury):", clock);
        require(treasuryRole, "TREASURY_ROLE missing");
        require(active, "adapter not ACTIVE");
        require(clock, "clock not wired");
    }
}
