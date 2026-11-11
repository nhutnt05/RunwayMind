// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {MockUSDC} from "../contracts/mocks/MockUSDC.sol";
import {MockLendingPool} from "../contracts/mocks/MockLendingPool.sol";
import {ObligationRegistry} from "../contracts/ObligationRegistry.sol";
import {PolicyEngine} from "../contracts/PolicyEngine.sol";
import {Treasury} from "../contracts/Treasury.sol";
import {VaultAdapter} from "../contracts/VaultAdapter.sol";
import {IClock} from "../contracts/interfaces/IClock.sol";
import {IObligationRegistry} from "../contracts/interfaces/IObligationRegistry.sol";
import {IPolicyEngine, AdapterStatus} from "../contracts/interfaces/IPolicyEngine.sol";
import {IMockLendingPool} from "../contracts/interfaces/IMockLendingPool.sol";
import {DeploymentPaths} from "./DeploymentPaths.sol";

/// @notice docs/02 §H steps 1–10 and 12. The broadcaster (deployer) is the ADMIN EOA (A-02).
///   Anvil: forge script scripts/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast --private-key <anvil key 0>
///   Fuji:  see docs/11 §7 (keys come from .env only).
/// Parameters come from env (docs/11 §4) with the documented demo defaults. Writes deployment/<network>.json.
contract Deploy is Script, DeploymentPaths {
    struct Params {
        address agent;
        bool demoMode;
        uint64 safetyHorizon;
        uint256 emergencyBuffer;
        uint16 maxExposureBps;
        uint256 poolApyBps;
        uint256 poolUtilizationBps;
        uint256 treasurySeed;
        uint256 interestReserve;
    }

    struct Deployed {
        MockUSDC usdc;
        ObligationRegistry registry;
        PolicyEngine policy;
        Treasury treasury;
        MockLendingPool pool;
        VaultAdapter adapter;
        uint256 deployBlock;
    }

    // Anvil default account #1 (public test account) — only used when AGENT_ADDRESS is unset on chain 31337.
    address internal constant ANVIL_ACCOUNT_1 = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;

    function _params() internal view returns (Params memory p) {
        address defaultAgent = block.chainid == 31_337 ? ANVIL_ACCOUNT_1 : address(0);
        p.agent = vm.envOr("AGENT_ADDRESS", defaultAgent);
        require(p.agent != address(0), "AGENT_ADDRESS not set");
        p.demoMode = vm.envOr("DEMO_MODE", true);
        p.safetyHorizon = uint64(vm.envOr("SAFETY_HORIZON_SEC", uint256(14 days)));
        p.emergencyBuffer = vm.envOr("EMERGENCY_BUFFER", uint256(10_000e6));
        p.maxExposureBps = uint16(vm.envOr("MAX_EXPOSURE_BPS", uint256(7000)));
        p.poolApyBps = vm.envOr("POOL_INITIAL_APY_BPS", uint256(800));
        p.poolUtilizationBps = vm.envOr("POOL_INITIAL_UTILIZATION_BPS", uint256(5000));
        p.treasurySeed = vm.envOr("TREASURY_SEED_AMOUNT", uint256(100_000e6));
        p.interestReserve = vm.envOr("POOL_INTEREST_RESERVE", uint256(10_000e6));
    }

    function run() external returns (Deployed memory d) {
        Params memory p = _params();
        vm.startBroadcast();
        (, address admin,) = vm.readCallers();
        d = _deploy(admin, p);
        vm.stopBroadcast();

        _checks(d, admin, p);
        _write(d, admin, p);
    }

    function _deploy(address admin, Params memory p) internal returns (Deployed memory d) {
        d.deployBlock = block.number;
        d.usdc = new MockUSDC(); // 1
        d.registry = new ObligationRegistry(admin); // 2
        d.policy = new PolicyEngine(
            admin,
            address(d.usdc),
            IObligationRegistry(address(d.registry)),
            p.safetyHorizon,
            p.emergencyBuffer,
            p.maxExposureBps
        ); // 3
        d.treasury = new Treasury(
            d.usdc, IObligationRegistry(address(d.registry)), IPolicyEngine(address(d.policy)), admin, p.demoMode
        ); // 4
        d.registry.setClock(address(d.treasury)); // 5
        d.registry.grantRole(d.registry.TREASURY_ROLE(), address(d.treasury));
        d.pool = new MockLendingPool(d.usdc, IClock(address(d.treasury)), admin, p.poolApyBps); // 6
        d.pool.setUtilization(p.poolUtilizationBps);
        d.adapter =
            new VaultAdapter(IMockLendingPool(address(d.pool)), address(d.treasury), "Mock Lending Pool (mUSDC)"); // 7
        d.policy.setAdapterStatus(address(d.adapter), AdapterStatus.ACTIVE); // 8
        d.treasury.grantRole(d.treasury.AGENT_ROLE(), p.agent); // 9
        d.usdc.mint(address(d.treasury), p.treasurySeed); // 10
        d.usdc.mint(admin, p.interestReserve);
        d.usdc.approve(address(d.pool), p.interestReserve);
        d.pool.fundInterestReserve(p.interestReserve);
    }

    function _checks(Deployed memory d, address admin, Params memory p) internal view {
        require(d.usdc.decimals() == 6, "decimals");
        require(d.policy.asset() == address(d.usdc) && d.policy.registry() == address(d.registry), "policy wiring");
        require(d.treasury.currentTime() > 0, "clock");
        require(!d.pool.liquidityShortage(), "shortage off");
        require(d.policy.adapterStatus(address(d.adapter)) == AdapterStatus.ACTIVE, "R4");
        require(d.treasury.hasRole(d.treasury.AGENT_ROLE(), p.agent), "agent role");
        require(d.treasury.hasRole(0x00, admin), "admin role");
        require(d.usdc.balanceOf(address(d.treasury)) == p.treasurySeed, "seed");
    }

    /// Step 12 — deployment/<network>.json (docs/11 §7 shape). demoStartTime = 0 until SeedDemo runs.
    function _write(Deployed memory d, address admin, Params memory p) internal {
        string memory c = "contracts";
        vm.serializeAddress(c, "MockUSDC", address(d.usdc));
        vm.serializeAddress(c, "ObligationRegistry", address(d.registry));
        vm.serializeAddress(c, "PolicyEngine", address(d.policy));
        vm.serializeAddress(c, "Treasury", address(d.treasury));
        vm.serializeAddress(c, "MockLendingPool", address(d.pool));
        string memory contractsJson = vm.serializeAddress(c, "VaultAdapter", address(d.adapter));

        string memory r = "roles";
        vm.serializeAddress(r, "admin", admin);
        string memory rolesJson = vm.serializeAddress(r, "agent", p.agent);

        string memory root = "root";
        vm.serializeUint(root, "chainId", block.chainid);
        vm.serializeString(root, "deployBlock", vm.toString(d.deployBlock));
        vm.serializeBool(root, "demoMode", p.demoMode);
        vm.serializeUint(root, "demoStartTime", 0);
        vm.serializeString(root, "contracts", contractsJson);
        string memory json = vm.serializeString(root, "roles", rolesJson);

        string memory path = deploymentPath();
        vm.writeJson(json, path);
        console2.log("Deployment written to", path);
        console2.log("Treasury", address(d.treasury));
    }
}
