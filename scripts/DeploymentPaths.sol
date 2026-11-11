// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";

/// @notice deployment/<network>.json naming shared by the scripts (local = Anvil 31337, fuji = 43113).
abstract contract DeploymentPaths is Script {
    function networkName() internal view returns (string memory) {
        if (block.chainid == 31_337) return "local";
        if (block.chainid == 43_113) return "fuji";
        return vm.toString(block.chainid);
    }

    function deploymentPath() internal view returns (string memory) {
        return string.concat(vm.projectRoot(), "/deployment/", networkName(), ".json");
    }
}
