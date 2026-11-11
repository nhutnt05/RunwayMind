// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {VaultAdapter} from "../../contracts/VaultAdapter.sol";
import {IMockLendingPool} from "../../contracts/interfaces/IMockLendingPool.sol";
import "../../contracts/libraries/Errors.sol";
import {Fixture} from "../utils/Fixture.sol";

contract VaultAdapterTest is Fixture {
    function test_constructor_wiring() public view {
        assertEq(adapter.asset(), address(usdc));
        assertEq(adapter.treasury(), address(treasury));
        assertEq(adapter.pool(), address(pool));
        assertEq(adapter.name(), "Mock Lending Pool (mUSDC)");
    }

    function test_constructor_rejectsEoaPool() public {
        vm.expectRevert(ZeroAddress.selector);
        new VaultAdapter(IMockLendingPool(makeAddr("eoa")), address(treasury), "x");
        vm.expectRevert(ZeroAddress.selector);
        new VaultAdapter(IMockLendingPool(address(pool)), address(0), "x");
    }

    function test_deposit_byNonTreasury_reverts() public {
        vm.prank(agent);
        vm.expectRevert(NotTreasury.selector);
        adapter.deposit(1);
        vm.prank(attacker);
        vm.expectRevert(NotTreasury.selector);
        adapter.deposit(1);
    }

    function test_withdraw_byNonTreasury_reverts() public {
        _invest(10_000e6);
        vm.prank(agent);
        vm.expectRevert(NotTreasury.selector);
        adapter.withdraw(10_000e6);
        vm.prank(admin);
        vm.expectRevert(NotTreasury.selector);
        adapter.withdraw(10_000e6);
    }

    function test_withdraw_sendsToTreasuryEvenWhenCalledByAgent() public {
        _invest(10_000e6);
        uint256 agentBefore = usdc.balanceOf(agent);
        uint256 idleBefore = treasury.idleBalance();
        vm.prank(agent);
        uint256 received = treasury.withdraw(address(adapter), 4000e6);
        assertEq(received, 4000e6);
        assertEq(treasury.idleBalance(), idleBefore + 4000e6);
        assertEq(usdc.balanceOf(agent), agentBefore);
        assertEq(usdc.balanceOf(address(adapter)), 0, "adapter never holds idle tokens");
    }

    function test_views_mirrorPool() public {
        _invest(10_000e6);
        vm.startPrank(admin);
        pool.setAPY(1200);
        pool.setUtilization(9800);
        pool.setPaused(true);
        vm.stopPrank();
        assertEq(adapter.balance(), pool.balanceOf(address(adapter)));
        assertEq(adapter.getAPY(), 1200);
        assertEq(adapter.utilizationBps(), 9800);
        assertTrue(adapter.isPaused());
        assertEq(adapter.availableLiquidity(), pool.availableLiquidity());
        assertEq(adapter.tvl(), usdc.balanceOf(address(pool)));
        assertEq(adapter.tvl(), 20_000e6); // 10,000 deposit + 10,000 interest reserve
    }
}
