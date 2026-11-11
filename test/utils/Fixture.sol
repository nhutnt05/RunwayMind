// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "../../contracts/mocks/MockUSDC.sol";
import {MockLendingPool} from "../../contracts/mocks/MockLendingPool.sol";
import {ObligationRegistry} from "../../contracts/ObligationRegistry.sol";
import {PolicyEngine} from "../../contracts/PolicyEngine.sol";
import {Treasury} from "../../contracts/Treasury.sol";
import {VaultAdapter} from "../../contracts/VaultAdapter.sol";
import {IClock} from "../../contracts/interfaces/IClock.sol";
import {IObligationRegistry, ObligationInput, Category} from "../../contracts/interfaces/IObligationRegistry.sol";
import {IPolicyEngine, AdapterStatus} from "../../contracts/interfaces/IPolicyEngine.sol";
import {IMockLendingPool} from "../../contracts/interfaces/IMockLendingPool.sol";

/// @notice Full-system fixture (docs/10 §1): deploys exactly as docs/02 §H with demoMode = true, mints 100,000 mUSDC
///         to the Treasury, funds a 10,000 interest reserve and seeds O1/O2/O3 (20k @ +7d, 20k @ +30d, 10k @ +45d).
abstract contract Fixture is Test {
    uint64 internal constant START_TIMESTAMP = 1_793_318_400; // docs/11 §7 example demoStartTime
    uint64 internal constant H = 14 days;
    uint256 internal constant BUFFER = 10_000e6;
    uint16 internal constant MAX_EXPOSURE_BPS = 7000;
    uint256 internal constant SEED = 100_000e6;
    uint256 internal constant INTEREST_RESERVE = 10_000e6;

    address internal admin = makeAddr("admin");
    address internal agent = makeAddr("agent");
    address internal keeper = makeAddr("keeper");
    address internal attacker = makeAddr("attacker");
    address internal recipient1 = makeAddr("recipient1");
    address internal recipient2 = makeAddr("recipient2");
    address internal recipient3 = makeAddr("recipient3");

    MockUSDC internal usdc;
    ObligationRegistry internal registry;
    PolicyEngine internal policy;
    Treasury internal treasury;
    MockLendingPool internal pool;
    VaultAdapter internal adapter;

    uint64 internal T0;
    uint256 internal o1;
    uint256 internal o2;
    uint256 internal o3;

    function setUp() public virtual {
        vm.warp(START_TIMESTAMP);
        _deploySystem(true);
        _seedObligations();
    }

    function _deploySystem(bool demoMode) internal {
        vm.startPrank(admin);
        usdc = new MockUSDC(); // 1
        registry = new ObligationRegistry(admin); // 2
        policy =
            new PolicyEngine(admin, address(usdc), IObligationRegistry(address(registry)), H, BUFFER, MAX_EXPOSURE_BPS); // 3
        treasury =
            new Treasury(usdc, IObligationRegistry(address(registry)), IPolicyEngine(address(policy)), admin, demoMode); // 4
        registry.setClock(address(treasury)); // 5
        registry.grantRole(registry.TREASURY_ROLE(), address(treasury));
        pool = new MockLendingPool(usdc, IClock(address(treasury)), admin, 800); // 6
        pool.setUtilization(5000);
        adapter = new VaultAdapter(IMockLendingPool(address(pool)), address(treasury), "Mock Lending Pool (mUSDC)"); // 7
        policy.setAdapterStatus(address(adapter), AdapterStatus.ACTIVE); // 8
        treasury.grantRole(treasury.AGENT_ROLE(), agent); // 9
        usdc.mint(address(treasury), SEED); // 10
        usdc.mint(admin, INTEREST_RESERVE);
        usdc.approve(address(pool), INTEREST_RESERVE);
        pool.fundInterestReserve(INTEREST_RESERVE);
        vm.stopPrank();
    }

    function _seedObligations() internal {
        T0 = treasury.currentTime();
        o1 = _create(recipient1, 20_000e6, T0 + 7 days, Category.PAYROLL);
        o2 = _create(recipient2, 20_000e6, T0 + 30 days, Category.PAYROLL);
        o3 = _create(recipient3, 10_000e6, T0 + 45 days, Category.GRANT);
    }

    function _create(address recipient, uint256 amount, uint64 due, Category category) internal returns (uint256 id) {
        vm.prank(admin);
        id = registry.createObligation(
            ObligationInput({
                recipient: recipient,
                amount: amount,
                firstDueDate: due,
                interval: 0,
                maxOccurrences: 1,
                category: category,
                metadataHash: keccak256(abi.encode(recipient, amount, due))
            })
        );
    }

    function _createRecurring(address recipient, uint256 amount, uint64 due, uint64 interval, uint32 maxOcc)
        internal
        returns (uint256 id)
    {
        vm.prank(admin);
        id = registry.createObligation(
            ObligationInput({
                recipient: recipient,
                amount: amount,
                firstDueDate: due,
                interval: interval,
                maxOccurrences: maxOcc,
                category: Category.PAYROLL,
                metadataHash: bytes32(0)
            })
        );
    }

    /// @dev Moves chain time to T0 + d days (block time; the pool reads the Treasury clock, so interest follows).
    function _warpToDay(uint256 d) internal {
        vm.warp(START_TIMESTAMP + d * 1 days);
    }

    function _invest(uint256 amount) internal {
        vm.prank(agent);
        treasury.invest(address(adapter), amount);
    }
}
