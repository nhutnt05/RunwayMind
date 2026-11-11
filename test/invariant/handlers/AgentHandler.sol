// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Vm} from "forge-std/Vm.sol";
import {ITreasury} from "../../../contracts/interfaces/ITreasury.sol";
import {VaultAdapter} from "../../../contracts/VaultAdapter.sol";
import {HandlerBase, Ctx} from "./HandlerBase.sol";

/// @notice AGENT actor: invest / withdraw random amounts, trip the breaker. Checks INV-3, INV-5, INV-6 immediately
///         after each invest attempt.
contract AgentHandler is HandlerBase {
    constructor(Ctx memory c) HandlerBase(c) {}

    function invest(uint256 adapterSeed, uint256 amountSeed) external {
        VaultAdapter a = _adapter(adapterSeed);
        uint256 idle = treasury.idleBalance();
        if (idle == 0) return;
        // half of the attempts stay within policy so successful invests are frequent
        uint256 maxInv = treasury.maxInvestable(address(a));
        uint256 amount = (amountSeed % 2 == 0 && maxInv > 0) ? bound(amountSeed, 1, maxInv) : bound(amountSeed, 1, idle);
        bool breaker = treasury.circuitBreakerActive();
        if (breaker) ghost.incInvestWhileBreaker();
        uint256 capBefore = (treasury.totalAssets() * policy.maxExposureBps()) / 10_000;

        vm.recordLogs();
        vm.prank(agent);
        try treasury.invest(address(a), amount) {
            ghost.incInvestSuccess();
            ghost.addPoolOps(1);
            if (treasury.idleBalance() < treasury.requiredReserve()) ghost.flag(3); // INV-3
            if (treasury.vaultBalance(address(a)) > capBefore) ghost.flag(5); // INV-5
        } catch {}
        Vm.Log[] memory logs = vm.getRecordedLogs();
        if (breaker) {
            for (uint256 i = 0; i < logs.length; ++i) {
                if (logs[i].emitter == address(treasury) && logs[i].topics[0] == ITreasury.Invested.selector) {
                    ghost.flag(6); // INV-6
                }
            }
        }
    }

    function withdraw(uint256 adapterSeed, uint256 amountSeed) external {
        VaultAdapter a = _adapter(adapterSeed);
        uint256 bal = a.balance();
        if (bal == 0) return;
        uint256 amount = amountSeed % 5 == 0 ? type(uint256).max : bound(amountSeed, 1, bal);
        vm.prank(agent);
        try treasury.withdraw(address(a), amount) {
            ghost.incWithdrawSuccess();
            ghost.addPoolOps(1);
        } catch {}
    }

    /// @dev Trips only on 1 in 4 calls so the breaker is not active for most of each run.
    function tripCircuitBreaker(uint256 seed) external {
        if (seed % 4 != 0) return;
        vm.prank(agent);
        treasury.tripCircuitBreaker();
    }
}
