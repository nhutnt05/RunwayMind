// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {ObligationRegistry} from "../contracts/ObligationRegistry.sol";
import {Treasury} from "../contracts/Treasury.sol";
import {ObligationInput, Category} from "../contracts/interfaces/IObligationRegistry.sol";
import {DeploymentPaths} from "./DeploymentPaths.sol";

/// @notice docs/02 §H step 11: creates O1/O2/O3 (20,000 @ T0+7d, 20,000 @ T0+30d, 10,000 @ T0+45d) and records
///         demoStartTime = Treasury.currentTime() in deployment/<network>.json. Must be broadcast by ADMIN.
///         SEED_OBLIGATIONS=false records demoStartTime only.
contract SeedDemo is Script, DeploymentPaths {
    // Anvil default accounts #3..#5 (public test accounts) — defaults for chain 31337 only.
    address internal constant ANVIL_ACCOUNT_3 = 0x90F79bf6EB2c4f870365E785982E1f101E93b906;
    address internal constant ANVIL_ACCOUNT_4 = 0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65;
    address internal constant ANVIL_ACCOUNT_5 = 0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc;

    function _recipient(string memory key, address localDefault) internal view returns (address a) {
        a = vm.envOr(key, block.chainid == 31_337 ? localDefault : address(0));
        require(a != address(0), string.concat(key, " not set"));
    }

    function run() external {
        string memory path = deploymentPath();
        string memory json = vm.readFile(path);
        Treasury treasury = Treasury(vm.parseJsonAddress(json, ".contracts.Treasury"));
        ObligationRegistry registry = ObligationRegistry(vm.parseJsonAddress(json, ".contracts.ObligationRegistry"));
        bool seed = vm.envOr("SEED_OBLIGATIONS", true);

        uint64 t0 = treasury.currentTime();
        if (seed) {
            address payroll = _recipient("RECIPIENT_PAYROLL", ANVIL_ACCOUNT_3);
            address payroll2 = _recipient("RECIPIENT_PAYROLL_2", ANVIL_ACCOUNT_4);
            address grant = _recipient("RECIPIENT_GRANT", ANVIL_ACCOUNT_5);
            vm.startBroadcast();
            registry.createObligation(_one(payroll, 20_000e6, t0 + 7 days, Category.PAYROLL, "November payroll"));
            registry.createObligation(_one(payroll2, 20_000e6, t0 + 30 days, Category.PAYROLL, "December payroll"));
            registry.createObligation(_one(grant, 10_000e6, t0 + 45 days, Category.GRANT, "Q1 grant"));
            vm.stopBroadcast();
            require(treasury.requiredReserve() == 30_000e6, "requiredReserve != 30,000");
        }

        vm.writeJson(vm.toString(uint256(t0)), path, ".demoStartTime");
        console2.log("demoStartTime", uint256(t0));
        console2.log("requiredReserve", treasury.requiredReserve());
    }

    function _one(address recipient, uint256 amount, uint64 due, Category category, string memory label)
        internal
        pure
        returns (ObligationInput memory)
    {
        return ObligationInput({
            recipient: recipient,
            amount: amount,
            firstDueDate: due,
            interval: 0,
            maxOccurrences: 1,
            category: category,
            metadataHash: metadataHash(category, label)
        });
    }

    /// @dev docs/07 §5.1: keccak256(canonicalJson({ label, notes, category, source })) — keys sorted, no whitespace.
    ///      Must equal backend/prisma/seed.ts `metadataHash()` so the integrity check (docs/09 §8) passes.
    function metadataHash(Category category, string memory label) internal pure returns (bytes32) {
        string memory cat = category == Category.PAYROLL ? "PAYROLL" : category == Category.GRANT ? "GRANT" : "OTHER";
        return
            keccak256(
                bytes(string.concat('{"category":"', cat, '","label":"', label, '","notes":null,"source":"SEED"}'))
            );
    }
}
