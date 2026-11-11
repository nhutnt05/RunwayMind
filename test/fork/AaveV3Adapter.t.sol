// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {ObligationRegistry} from "../../contracts/ObligationRegistry.sol";
import {PolicyEngine} from "../../contracts/PolicyEngine.sol";
import {Treasury} from "../../contracts/Treasury.sol";
import {AaveV3Adapter} from "../../contracts/adapters/AaveV3Adapter.sol";
import {IAaveV3Pool} from "../../contracts/adapters/aave/IAaveV3Pool.sol";
import {IObligationRegistry, ObligationInput, Category} from "../../contracts/interfaces/IObligationRegistry.sol";
import {IPolicyEngine, AdapterStatus} from "../../contracts/interfaces/IPolicyEngine.sol";
import {ReserveViolation} from "../../contracts/libraries/Errors.sol";

/// @notice docs/10 §2.6 — run with:
///         forge test --match-path "test/fork/*" --fork-url $env:AVALANCHE_MAINNET_RPC_URL -vv
///         Skipped (not failed) when not running on an Avalanche C-Chain mainnet fork, so default CI stays green.
contract AaveV3AdapterForkTest is Test {
    uint256 internal constant AVALANCHE_CHAIN_ID = 43_114;
    // docs/02 §G fork constants — verified on-chain in setUp (code size > 0, USDC decimals == 6, reserve listed).
    IAaveV3Pool internal constant AAVE_POOL = IAaveV3Pool(0x794a61358D6845594F94dc1DB02A252b5b4814aD);
    IERC20 internal constant USDC = IERC20(0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E);

    uint256 internal constant SEED = 10_000e6;

    address internal admin = makeAddr("admin");
    address internal agent = makeAddr("agent");
    address internal payee = makeAddr("payee");

    ObligationRegistry internal registry;
    PolicyEngine internal policy;
    Treasury internal treasury;
    AaveV3Adapter internal adapter;

    function setUp() public {
        if (block.chainid != AVALANCHE_CHAIN_ID) {
            vm.skip(true);
            return;
        }
        assertGt(address(AAVE_POOL).code.length, 0, "Aave V3 Pool has no code");
        assertGt(address(USDC).code.length, 0, "USDC has no code");
        assertEq(IERC20Metadata(address(USDC)).decimals(), 6, "USDC decimals");

        vm.startPrank(admin);
        registry = new ObligationRegistry(admin);
        // buffer 0 and 100% exposure so the whole 10,000 seed can be invested (docs/10 §2.6 "balance ≈ 10,000").
        policy = new PolicyEngine(admin, address(USDC), IObligationRegistry(address(registry)), 14 days, 0, 10_000);
        treasury =
            new Treasury(USDC, IObligationRegistry(address(registry)), IPolicyEngine(address(policy)), admin, false);
        registry.setClock(address(treasury));
        registry.grantRole(registry.TREASURY_ROLE(), address(treasury));
        adapter = new AaveV3Adapter(AAVE_POOL, USDC, address(treasury));
        policy.setAdapterStatus(address(adapter), AdapterStatus.ACTIVE);
        treasury.grantRole(treasury.AGENT_ROLE(), agent);
        vm.stopPrank();

        assertTrue(adapter.aToken() != address(0), "aToken resolved");
        assertFalse(adapter.isPaused(), "USDC reserve paused/inactive");
        deal(address(USDC), address(treasury), SEED);
    }

    function test_fork_depositToAave() public {
        vm.prank(agent);
        treasury.invest(address(adapter), SEED);

        assertEq(treasury.idleBalance(), 0);
        assertApproxEqAbs(adapter.balance(), SEED, 1, "aToken balance ~= 10,000");
        assertApproxEqAbs(treasury.totalAssets(), SEED, 1);
        assertGt(adapter.tvl(), 0);
        assertLe(adapter.utilizationBps(), 10_000);
    }

    function test_fork_interestAccrues30Days() public {
        vm.prank(agent);
        treasury.invest(address(adapter), SEED);
        uint256 apyBps = adapter.getAPY();

        vm.warp(block.timestamp + 30 days);

        uint256 bal = adapter.balance();
        assertGt(bal, SEED, "interest accrued");
        emit log_named_uint("apyBps", apyBps);
        emit log_named_uint("balance after 30d", bal);
    }

    function test_fork_withdrawBeforeDeadline_policyStillEnforced() public {
        uint64 due = uint64(block.timestamp + 30 days);
        vm.prank(admin);
        registry.createObligation(
            ObligationInput({
                recipient: payee,
                amount: 5000e6,
                firstDueDate: due,
                interval: 0,
                maxOccurrences: 1,
                category: Category.PAYROLL,
                metadataHash: bytes32(0)
            })
        );

        // Outside the horizon at T0: reserve = buffer = 0, the full seed can go to Aave.
        assertEq(treasury.requiredReserve(), 0);
        vm.prank(agent);
        treasury.invest(address(adapter), SEED);

        // Withdrawal deadline = dueDate - H (R2).
        vm.warp(due - 14 days);
        assertEq(treasury.shortfall(), 5000e6);
        uint256 withdrawn = treasury.enforceDeadlines();

        assertGe(withdrawn, 5000e6, "funds returned from Aave");
        assertGe(treasury.idleBalance(), 5000e6);
        assertEq(treasury.shortfall(), 0);

        // R1 still enforced by the unchanged PolicyEngine against a real protocol.
        uint256 idle = treasury.idleBalance();
        uint256 overReserve = idle - 5000e6 + 1;
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(ReserveViolation.selector, 5000e6 - 1, 5000e6));
        treasury.invest(address(adapter), overReserve);

        // ...and the obligation is payable at the due date from returned funds.
        vm.warp(due);
        treasury.pay(1);
        assertEq(USDC.balanceOf(payee), 5000e6);
    }
}
