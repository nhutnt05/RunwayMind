// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
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

/// @notice Real-USDC treasury (COULD, REQ-031; docs/02 §H "Real-USDC treasury", docs/11 §7.2): steps 2–9 of
///         Deploy.s.sol with asset = Circle USDC on Fuji, emergencyBuffer = 2 USDC and a second MockLendingPool on the
///         same asset. The Treasury is funded afterwards with 10–20 USDC from the Circle faucet (no mint on real USDC).
///         The pool's 1 USDC interest reserve is funded here only if the ADMIN already holds it; otherwise
///         `scripts/demo/usdcSmoke.ts` funds it before investing.
///   forge script scripts/DeployUsdcTreasury.s.sol --rpc-url $env:FUJI_RPC_URL --broadcast --private-key $env:DEPLOYER_PRIVATE_KEY
///   Writes deployment/<network>-usdc.json (fuji-usdc.json on Fuji).
contract DeployUsdcTreasury is Script, DeploymentPaths {
    address internal constant CIRCLE_USDC_FUJI = 0x5425890298aed601595a70AB815c96711a31Bc65;
    uint256 internal constant EMERGENCY_BUFFER = 2e6;
    uint256 internal constant INTEREST_RESERVE = 1e6;

    struct Deployed {
        ObligationRegistry registry;
        PolicyEngine policy;
        Treasury treasury;
        MockLendingPool pool;
        VaultAdapter adapter;
        uint256 deployBlock;
        bool reserveFunded;
    }

    function run() external returns (Deployed memory d) {
        IERC20 usdc = IERC20(vm.envOr("CIRCLE_USDC_FUJI", CIRCLE_USDC_FUJI));
        require(address(usdc).code.length > 0, "USDC has no code on this chain");
        require(IERC20Metadata(address(usdc)).decimals() == 6, "USDC decimals != 6");
        address agent = vm.envAddress("AGENT_ADDRESS");
        bool demoMode = vm.envOr("DEMO_MODE", true);
        uint64 horizon = uint64(vm.envOr("SAFETY_HORIZON_SEC", uint256(14 days)));
        uint16 maxExposure = uint16(vm.envOr("MAX_EXPOSURE_BPS", uint256(7000)));
        uint256 apy = vm.envOr("POOL_INITIAL_APY_BPS", uint256(800));
        uint256 util = vm.envOr("POOL_INITIAL_UTILIZATION_BPS", uint256(5000));

        vm.startBroadcast();
        (, address admin,) = vm.readCallers();
        d.deployBlock = block.number;
        d.registry = new ObligationRegistry(admin); // 2
        d.policy = new PolicyEngine(
            admin, address(usdc), IObligationRegistry(address(d.registry)), horizon, EMERGENCY_BUFFER, maxExposure
        ); // 3
        d.treasury = new Treasury(
            usdc, IObligationRegistry(address(d.registry)), IPolicyEngine(address(d.policy)), admin, demoMode
        ); // 4
        d.registry.setClock(address(d.treasury)); // 5
        d.registry.grantRole(d.registry.TREASURY_ROLE(), address(d.treasury));
        d.pool = new MockLendingPool(usdc, IClock(address(d.treasury)), admin, apy); // 6
        d.pool.setUtilization(util);
        d.adapter = new VaultAdapter(IMockLendingPool(address(d.pool)), address(d.treasury), "Mock Lending Pool (USDC)"); // 7
        d.policy.setAdapterStatus(address(d.adapter), AdapterStatus.ACTIVE); // 8
        d.treasury.grantRole(d.treasury.AGENT_ROLE(), agent); // 9
        if (usdc.balanceOf(admin) >= INTEREST_RESERVE) {
            usdc.approve(address(d.pool), INTEREST_RESERVE);
            d.pool.fundInterestReserve(INTEREST_RESERVE);
            d.reserveFunded = true;
        }
        vm.stopBroadcast();

        require(d.policy.asset() == address(usdc) && d.treasury.asset() == address(usdc), "asset wiring");
        require(d.policy.emergencyBuffer() == EMERGENCY_BUFFER, "buffer");
        require(d.policy.adapterStatus(address(d.adapter)) == AdapterStatus.ACTIVE, "R4");
        require(d.treasury.hasRole(d.treasury.AGENT_ROLE(), agent), "agent role");
        require(d.treasury.hasRole(0x00, admin), "admin role");
        _write(d, admin, agent, demoMode);
        if (!d.reserveFunded) {
            console2.log("Pool interest reserve NOT funded (ADMIN has < 1 USDC) - usdcSmoke.ts funds it");
        }
    }

    function _write(Deployed memory d, address admin, address agent, bool demoMode) internal {
        string memory c = "contracts";
        vm.serializeAddress(c, "ObligationRegistry", address(d.registry));
        vm.serializeAddress(c, "PolicyEngine", address(d.policy));
        vm.serializeAddress(c, "Treasury", address(d.treasury));
        vm.serializeAddress(c, "MockLendingPool", address(d.pool));
        string memory contractsJson = vm.serializeAddress(c, "VaultAdapter", address(d.adapter));

        string memory r = "roles";
        vm.serializeAddress(r, "admin", admin);
        string memory rolesJson = vm.serializeAddress(r, "agent", agent);

        string memory root = "root";
        vm.serializeUint(root, "chainId", block.chainid);
        vm.serializeString(root, "deployBlock", vm.toString(d.deployBlock));
        vm.serializeBool(root, "demoMode", demoMode);
        vm.serializeUint(root, "demoStartTime", d.treasury.currentTime());
        vm.serializeString(root, "contracts", contractsJson);
        string memory json = vm.serializeString(root, "roles", rolesJson);

        string memory path = string.concat(vm.projectRoot(), "/deployment/", networkName(), "-usdc.json");
        vm.writeJson(json, path);
        console2.log("Deployment written to", path);
        console2.log("USDC Treasury", address(d.treasury));
    }
}
