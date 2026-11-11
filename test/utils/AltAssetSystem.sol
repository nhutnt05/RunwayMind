// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockLendingPool} from "../../contracts/mocks/MockLendingPool.sol";
import {ObligationRegistry} from "../../contracts/ObligationRegistry.sol";
import {PolicyEngine} from "../../contracts/PolicyEngine.sol";
import {Treasury} from "../../contracts/Treasury.sol";
import {VaultAdapter} from "../../contracts/VaultAdapter.sol";
import {IClock} from "../../contracts/interfaces/IClock.sol";
import {IObligationRegistry, ObligationInput, Category} from "../../contracts/interfaces/IObligationRegistry.sol";
import {IPolicyEngine, AdapterStatus} from "../../contracts/interfaces/IPolicyEngine.sol";
import {IMockLendingPool} from "../../contracts/interfaces/IMockLendingPool.sol";

/// @notice A full RunwayMind system (docs/02 §H, same parameters as Fixture) deployed around an arbitrary ERC-20.
struct Sys {
    IERC20 token;
    ObligationRegistry registry;
    PolicyEngine policy;
    Treasury treasury;
    MockLendingPool pool;
    VaultAdapter adapter;
}

/// @notice Deploys a Sys for any ERC-20 asset (token-agnostic flows, reentrant-token tests). Balances are set with
///         `deal`, so the token needs no mint function.
abstract contract AltAssetSystem is Test {
    function _deployAltSystem(IERC20 token, address admin_, address agent_, uint256 seed, uint256 interestReserve)
        internal
        returns (Sys memory s)
    {
        s.token = token;
        vm.startPrank(admin_);
        s.registry = new ObligationRegistry(admin_);
        s.policy = new PolicyEngine(admin_, address(token), IObligationRegistry(address(s.registry)), 14 days, 10_000e6, 7000);
        s.treasury = new Treasury(
            token, IObligationRegistry(address(s.registry)), IPolicyEngine(address(s.policy)), admin_, true
        );
        s.registry.setClock(address(s.treasury));
        s.registry.grantRole(s.registry.TREASURY_ROLE(), address(s.treasury));
        s.pool = new MockLendingPool(token, IClock(address(s.treasury)), admin_, 800);
        s.pool.setUtilization(5000);
        s.adapter = new VaultAdapter(IMockLendingPool(address(s.pool)), address(s.treasury), "Mock Lending Pool");
        s.policy.setAdapterStatus(address(s.adapter), AdapterStatus.ACTIVE);
        s.treasury.grantRole(s.treasury.AGENT_ROLE(), agent_);
        vm.stopPrank();
        if (seed != 0) deal(address(token), address(s.treasury), seed, true);
        if (interestReserve != 0) deal(address(token), address(s.pool), interestReserve, true);
    }

    function _createOn(Sys memory s, address admin_, address recipient, uint256 amount, uint64 due)
        internal
        returns (uint256 id)
    {
        vm.prank(admin_);
        id = s.registry.createObligation(
            ObligationInput({
                recipient: recipient,
                amount: amount,
                firstDueDate: due,
                interval: 0,
                maxOccurrences: 1,
                category: Category.PAYROLL,
                metadataHash: bytes32(0)
            })
        );
    }
}
