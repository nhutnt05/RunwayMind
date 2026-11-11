// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {MockUSDC} from "../../contracts/mocks/MockUSDC.sol";

contract MockUSDCTest is Test {
    MockUSDC internal usdc;
    address internal owner = makeAddr("owner");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public {
        vm.prank(owner);
        usdc = new MockUSDC();
    }

    function test_decimals_isSix() public view {
        assertEq(usdc.decimals(), 6);
        assertEq(usdc.name(), "Mock USD Coin");
        assertEq(usdc.symbol(), "mUSDC");
    }

    function test_mint_byOwner() public {
        vm.prank(owner);
        usdc.mint(alice, 100_000e6);
        assertEq(usdc.balanceOf(alice), 100_000e6);
        assertEq(usdc.totalSupply(), 100_000e6);
    }

    function test_mint_revertsForNonOwner() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        usdc.mint(alice, 1);
    }

    function test_transfer_standard() public {
        vm.prank(owner);
        usdc.mint(alice, 50e6);
        vm.prank(alice);
        assertTrue(usdc.transfer(bob, 20e6));
        assertEq(usdc.balanceOf(alice), 30e6);
        assertEq(usdc.balanceOf(bob), 20e6);
    }

    function test_transferFrom_requiresAllowance() public {
        vm.prank(owner);
        usdc.mint(alice, 50e6);
        vm.prank(bob);
        vm.expectRevert();
        usdc.transferFrom(alice, bob, 1);

        vm.prank(alice);
        usdc.approve(bob, 10e6);
        vm.prank(bob);
        assertTrue(usdc.transferFrom(alice, bob, 10e6));
        assertEq(usdc.balanceOf(bob), 10e6);
    }
}
