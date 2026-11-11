// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ObligationInput, Category} from "../../../contracts/interfaces/IObligationRegistry.sol";
import {HandlerBase, Ctx} from "./HandlerBase.sol";

/// @notice ADMIN actor: create / cancel obligations (to a fixed recipient set), advance time (DEMO offset and chain
///         time), trip and reset the circuit breaker.
contract AdminHandler is HandlerBase {
    address[] internal recipients;

    constructor(Ctx memory c, address[] memory recipients_) HandlerBase(c) {
        recipients = recipients_;
    }

    function createObligation(uint256 recipientSeed, uint256 amountSeed, uint256 dueSeed, uint256 kindSeed) external {
        address r = recipients[recipientSeed % recipients.length];
        uint64 nowTs = treasury.currentTime();
        uint64 due = nowTs + uint64(bound(dueSeed, 1 hours, 60 days));
        uint256 kind = kindSeed % 3; // 0 one-time, 1 unlimited recurring, 2 capped recurring
        uint64 interval = kind == 0 ? 0 : uint64(bound(kindSeed, 1 days, 45 days));
        uint32 maxOcc = kind == 0 ? 1 : (kind == 1 ? 0 : uint32(bound(kindSeed >> 8, 2, 6)));
        vm.prank(admin);
        try registry.createObligation(
            ObligationInput({
                recipient: r,
                amount: bound(amountSeed, 1, 20_000e6),
                firstDueDate: due,
                interval: interval,
                maxOccurrences: maxOcc,
                category: Category(kindSeed % 4),
                metadataHash: bytes32(kindSeed)
            })
        ) {
            ghost.incObligationsCreated();
        } catch {}
    }

    function cancelObligation(uint256 idSeed) external {
        uint256 count = registry.obligationCount();
        if (count == 0) return;
        vm.prank(admin);
        try registry.cancelObligation(bound(idSeed, 1, count)) {} catch {}
    }

    /// @dev DEMO time travel (monotonic, ≤ 365 days total).
    function advanceTime(uint256 secondsSeed) external {
        uint64 s = uint64(bound(secondsSeed, 1 hours, 6 days));
        if (uint256(treasury.timeOffset()) + s > treasury.MAX_TIME_OFFSET()) return;
        vm.prank(admin);
        treasury.advanceTime(s);
    }

    /// @dev Chain time.
    function warp(uint256 secondsSeed) external {
        vm.warp(block.timestamp + bound(secondsSeed, 1 hours, 6 days));
    }

    /// @dev Trips only on 1 in 4 calls so the breaker is not active for most of each run.
    function tripCircuitBreaker(uint256 seed) external {
        if (seed % 4 != 0) return;
        vm.prank(admin);
        treasury.tripCircuitBreaker();
    }

    function resetCircuitBreaker() external {
        vm.prank(admin);
        treasury.resetCircuitBreaker();
    }
}
