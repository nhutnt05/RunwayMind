// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MockLendingPool} from "../../contracts/mocks/MockLendingPool.sol";
import {VaultAdapter} from "../../contracts/VaultAdapter.sol";
import {IClock} from "../../contracts/interfaces/IClock.sol";
import {Category} from "../../contracts/interfaces/IObligationRegistry.sol";
import {AdapterStatus} from "../../contracts/interfaces/IPolicyEngine.sol";
import {IMockLendingPool} from "../../contracts/interfaces/IMockLendingPool.sol";
import {Fixture} from "../utils/Fixture.sol";

/// @notice D7-A1 gas budgets (docs/02 §I: invest < 300k, pay < 250k, enforceDeadlines worst case < 1M).
///         Gas is measured around the single call plus the 21,000 intrinsic cost. Every obligation/adapter is created
///         in setUp, so storage is cold in the test transaction exactly as it is on-chain.
///
///         Measured (D7): `invest` costs ~230k at the demo shape and grows ~8k per active obligation (three cold
///         SLOADs per obligation in `amountDueUntil`), so the 300k target holds up to 10 active obligations; at the
///         MAX_ACTIVE_OBLIGATIONS = 50 / MAX_ADAPTERS = 5 cap it is ~680k. That is a documented deviation
///         (docs/DECISIONS.md DEC-GAS-1, docs/SECURITY_NOTES.md §2): the worst-case tests below are regression
///         ceilings, not a claim that the docs/02 §I target is met at the cap.
abstract contract GasHelpers is Fixture {
    uint256 internal constant TX_BASE = 21_000;
    uint256 internal constant INVEST_BUDGET = 300_000; // docs/02 §I
    uint256 internal constant PAY_BUDGET = 250_000; // docs/02 §I
    uint256 internal constant ENFORCE_BUDGET = 1_000_000; // docs/02 §I (worst case)

    function _createSmall(uint256 n) internal {
        for (uint256 i = 0; i < n; ++i) {
            _create(makeAddr(string(abi.encode("gas", i))), 100e6, T0 + 7 days, Category.VENDOR_INVOICE);
        }
    }

    function _investGas(address a, uint256 amount) internal returns (uint256 used) {
        vm.prank(agent);
        uint256 g = gasleft();
        treasury.invest(a, amount);
        used = g - gasleft() + TX_BASE;
    }

    function _payGas(uint256 id) internal returns (uint256 used) {
        vm.prank(keeper);
        uint256 g = gasleft();
        treasury.pay(id);
        used = g - gasleft() + TX_BASE;
    }

    function _enforceGas() internal returns (uint256 used, uint256 withdrawn) {
        vm.prank(keeper);
        uint256 g = gasleft();
        withdrawn = treasury.enforceDeadlines();
        used = g - gasleft() + TX_BASE;
    }
}

/// @notice Demo shape (docs/12): 3 obligations, 1 adapter — every docs/02 §I target holds.
contract GasDemoShapeTest is GasHelpers {
    function test_gas_demo_invest_under300k() public {
        uint256 used = _investGas(address(adapter), 70_000e6);
        emit log_named_uint("invest (3 obligations, 1 adapter)", used);
        assertLt(used, INVEST_BUDGET);
    }

    function test_gas_demo_payFromIdle_under250k() public {
        _warpToDay(7);
        uint256 used = _payGas(o1);
        emit log_named_uint("pay from idle", used);
        assertLt(used, PAY_BUDGET);
    }

    function test_gas_demo_payWithPull_under250k() public {
        _invest(70_000e6); // idle 30,000
        _warpToDay(7);
        vm.prank(keeper);
        treasury.pay(o1); // idle 10,000
        _warpToDay(30);
        vm.roll(block.number + 1);
        uint256 used = _payGas(o2); // needs 10,000 pulled from the vault
        emit log_named_uint("pay with vault pull", used);
        assertLt(used, PAY_BUDGET);
    }

    function test_gas_demo_enforceDeadlines_under1M() public {
        _invest(70_000e6);
        _warpToDay(17); // O2 enters the horizon -> shortfall 20,000
        (uint256 used, uint256 withdrawn) = _enforceGas();
        emit log_named_uint("enforceDeadlines (demo)", used);
        assertEq(withdrawn, 20_000e6);
        assertLt(used, ENFORCE_BUDGET);
    }
}

/// @notice Operating envelope: the 300k invest target holds with 10 active obligations.
contract GasEnvelopeTest is GasHelpers {
    function setUp() public override {
        super.setUp();
        _createSmall(7); // 10 active
    }

    function test_gas_envelope_invest10Obligations_under300k() public {
        assertEq(registry.activeObligationCount(), 10);
        uint256 used = _investGas(address(adapter), 60_000e6);
        emit log_named_uint("invest (10 obligations, 1 adapter)", used);
        assertLt(used, INVEST_BUDGET);
    }
}

/// @notice Worst case: MAX_ACTIVE_OBLIGATIONS (50) scanned by `amountDueUntil` and MAX_ADAPTERS (5), each touched by
///         `_pullLiquidity`. enforceDeadlines must stay < 1M (docs/02 §I); invest/pay have regression ceilings.
contract GasWorstCaseTest is GasHelpers {
    uint256 internal constant PER_ADAPTER = 13_000e6;
    uint256 internal constant INVEST_WORST_CEILING = 750_000; // measured ~680k
    uint256 internal constant PAY_WORST_CEILING = 350_000; // measured ~310k

    VaultAdapter[5] internal adapters;
    MockLendingPool[5] internal pools;
    uint256 internal big; // 40,000 due at +40 days

    function setUp() public override {
        super.setUp(); // O1/O2/O3 + adapter #0
        adapters[0] = adapter;
        pools[0] = pool;
        vm.startPrank(admin);
        for (uint256 i = 1; i < 5; ++i) {
            pools[i] = new MockLendingPool(usdc, IClock(address(treasury)), admin, 800);
            pools[i].setUtilization(5000);
            adapters[i] = new VaultAdapter(IMockLendingPool(address(pools[i])), address(treasury), "gas pool");
            policy.setAdapterStatus(address(adapters[i]), AdapterStatus.ACTIVE);
            usdc.mint(admin, INTEREST_RESERVE);
            usdc.approve(address(pools[i]), INTEREST_RESERVE);
            pools[i].fundInterestReserve(INTEREST_RESERVE);
        }
        vm.stopPrank();
        _createSmall(46); // 46 x 100 inside the horizon
        big = _create(recipient1, 40_000e6, T0 + 40 days, Category.GRANT); // -> 50 active
        assertEq(registry.activeObligationCount(), registry.MAX_ACTIVE_OBLIGATIONS());
        assertEq(policy.getAdapters().length, policy.MAX_ADAPTERS());
        // reserve = 20,000 + 4,600 + 10,000 buffer = 34,600 -> 4 x 13,000 up front, the 5th is measured.
        for (uint256 i = 0; i < 4; ++i) {
            vm.prank(agent);
            treasury.invest(address(adapters[i]), PER_ADAPTER);
        }
    }

    function _investFifth() internal {
        vm.prank(agent);
        treasury.invest(address(adapters[4]), PER_ADAPTER);
    }

    function test_gas_worst_enforceDeadlines_under1M() public {
        _investFifth(); // 65,000 across 5 adapters, idle 35,000
        _warpToDay(32); // all obligations inside the horizon: shortfall ~69,600 > vault -> every adapter drained
        assertGt(treasury.shortfall(), 5 * PER_ADAPTER);
        (uint256 used, uint256 withdrawn) = _enforceGas();
        emit log_named_uint("enforceDeadlines (50 obligations, 5 adapters drained)", used);
        assertGe(withdrawn, 5 * PER_ADAPTER);
        for (uint256 i = 0; i < 5; ++i) {
            assertEq(adapters[i].balance(), 0);
        }
        assertLt(used, ENFORCE_BUDGET);
    }

    function test_gas_worst_invest_ceiling() public {
        uint256 used = _investGas(address(adapters[4]), PER_ADAPTER);
        emit log_named_uint("invest (50 obligations, 5 adapters)", used);
        assertGe(treasury.idleBalance(), treasury.requiredReserve());
        assertLt(used, INVEST_WORST_CEILING);
    }

    function test_gas_worst_payPullAcrossAllAdapters_ceiling() public {
        _investFifth(); // idle 35,000 < 40,000
        vm.startPrank(admin);
        for (uint256 i = 0; i < 4; ++i) {
            pools[i].setUtilization(9900);
            pools[i].setLiquidityShortage(true); // adapters 0..3 give ~1 % each -> the pull walks all five
        }
        vm.stopPrank();
        _warpToDay(40);
        uint256 before = usdc.balanceOf(recipient1);
        uint256 used = _payGas(big);
        emit log_named_uint("pay (pull across 5 adapters, 50 obligations)", used);
        assertEq(usdc.balanceOf(recipient1) - before, 40_000e6);
        assertLt(used, PAY_WORST_CEILING);
    }
}
