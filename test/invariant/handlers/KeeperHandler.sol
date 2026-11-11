// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Obligation} from "../../../contracts/interfaces/IObligationRegistry.sol";
import {HandlerBase, Ctx} from "./HandlerBase.sol";

/// @notice KEEPER actor (no role): pay obligations (single and loops) and enforce deadlines. Checks INV-2 and INV-4
///         right after each action and feeds INV-7 bookkeeping.
contract KeeperHandler is HandlerBase {
    constructor(Ctx memory c) HandlerBase(c) {}

    function pay(uint256 idSeed) external {
        uint256 count = registry.obligationCount();
        _payOnce(bound(idSeed, 1, count + 1)); // count + 1 = unknown id
    }

    /// @dev Keeper loop: pays every due occurrence (up to 3 overdue occurrences per obligation per call).
    function payAllDue() external {
        uint256 count = registry.obligationCount();
        for (uint256 id = 1; id <= count; ++id) {
            for (uint256 k = 0; k < 3; ++k) {
                if (!_payOnce(id)) break;
            }
        }
    }

    function enforceDeadlines() external {
        bool liquid = _allPoolsLiquid()
            && treasury.idleBalance() + adapter0.balance() + adapter1.balance() >= treasury.requiredReserve();
        vm.prank(keeper);
        try treasury.enforceDeadlines() returns (uint256 withdrawn) {
            if (withdrawn > 0) ghost.addPoolOps(2);
            if (liquid) {
                ghost.incEnforceLiquidCheck();
                if (treasury.shortfall() != 0) ghost.flag(4); // INV-4
            }
        } catch {
            if (liquid) ghost.flag(4);
        }
    }

    function _payOnce(uint256 id) internal returns (bool ok) {
        Obligation memory ob;
        try registry.getObligation(id) returns (Obligation memory o) {
            ob = o;
        } catch {
            vm.prank(keeper);
            try treasury.pay(id) {
                ghost.flag(2); // an unknown id must never pay anybody
            } catch {}
            return false;
        }
        uint256 recipientBefore = usdc.balanceOf(ob.recipient);
        vm.prank(keeper);
        try treasury.pay(id) {
            Obligation memory after_ = registry.getObligation(id);
            ghost.recordPay(id, after_.paidOccurrences, ob.recipient, ob.amount);
            ghost.addPoolOps(2); // pay may pull liquidity from adapters
            // INV-2: exactly the registered amount went to the registered recipient
            if (usdc.balanceOf(ob.recipient) != recipientBefore + ob.amount) ghost.flag(2);
            ok = true;
        } catch {}
    }
}
