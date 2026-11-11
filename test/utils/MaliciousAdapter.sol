// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IVaultAdapter} from "../../contracts/interfaces/IVaultAdapter.sol";
import {ITreasury} from "../../contracts/interfaces/ITreasury.sol";

/// @notice Wiring-correct IVaultAdapter (right asset + treasury, so ADMIN can whitelist it) that tries to re-enter the
///         Treasury from `deposit` / `withdraw` (docs/03 §3.12, docs/10 §2.4). Funds are held as plain token balance.
/// @dev `swallow = false`: the re-entrant call's revert bubbles up (whole outer call reverts).
///      `swallow = true` : the revert is caught and stored in `lastRevert`, and the adapter behaves normally.
contract MaliciousAdapter is IVaultAdapter {
    enum Attack {
        NONE,
        PAY,
        INVEST,
        WITHDRAW,
        ENFORCE
    }

    address public immutable asset;
    address public immutable treasury;

    Attack public attack;
    uint256 public attackArg;
    bool public swallow;
    uint256 public reentryAttempts;
    uint256 public reentrySuccesses;
    bytes public lastRevert;

    constructor(address asset_, address treasury_) {
        asset = asset_;
        treasury = treasury_;
    }

    function arm(Attack attack_, uint256 arg, bool swallow_) external {
        attack = attack_;
        attackArg = arg;
        swallow = swallow_;
    }

    function pool() external pure returns (address) {
        return address(0);
    }

    function name() external pure returns (string memory) {
        return "Malicious";
    }

    function deposit(uint256) external {
        require(msg.sender == treasury, "malicious: not treasury");
        _attack();
    }

    function withdraw(uint256 amount) external returns (uint256) {
        require(msg.sender == treasury, "malicious: not treasury");
        _attack();
        require(IERC20(asset).transfer(treasury, amount), "malicious: transfer");
        return amount;
    }

    function balance() public view returns (uint256) {
        return IERC20(asset).balanceOf(address(this));
    }

    function getAPY() external pure returns (uint256) {
        return 2000;
    }

    function isPaused() external pure returns (bool) {
        return false;
    }

    function availableLiquidity() external view returns (uint256) {
        return balance();
    }

    function utilizationBps() external pure returns (uint256) {
        return 0;
    }

    function tvl() external view returns (uint256) {
        return balance();
    }

    function _attack() internal {
        Attack a = attack;
        if (a == Attack.NONE) return;
        reentryAttempts += 1;
        bytes memory data;
        if (a == Attack.PAY) data = abi.encodeCall(ITreasury.pay, (attackArg));
        else if (a == Attack.INVEST) data = abi.encodeCall(ITreasury.invest, (address(this), attackArg));
        else if (a == Attack.WITHDRAW) data = abi.encodeCall(ITreasury.withdraw, (address(this), attackArg));
        else data = abi.encodeCall(ITreasury.enforceDeadlines, ());

        (bool ok, bytes memory ret) = treasury.call(data);
        if (ok) {
            reentrySuccesses += 1;
            return;
        }
        if (swallow) {
            lastRevert = ret;
            return;
        }
        assembly {
            revert(add(ret, 32), mload(ret))
        }
    }
}
