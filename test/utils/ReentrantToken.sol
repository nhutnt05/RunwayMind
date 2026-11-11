// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ITreasury} from "../../contracts/interfaces/ITreasury.sol";

interface ITokensRecipient {
    function tokensReceived(address from, uint256 amount) external;
}

/// @notice ERC-777-style 6-decimal token (docs/10 §2.4): after every balance update it calls
///         `tokensReceived` on recipients that registered a hook (ERC-1820-like opt-in), giving them control flow in the
///         middle of `Treasury.pay`.
contract ReentrantToken is ERC20 {
    mapping(address => bool) public hasHook;

    constructor() ERC20("Reentrant USD", "rUSD") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @notice Recipient opts in to receive callbacks.
    function registerHook() external {
        hasHook[msg.sender] = true;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (to != address(0) && hasHook[to]) ITokensRecipient(to).tokensReceived(from, value);
    }
}

/// @notice Registered obligation recipient that tries to get paid twice by re-entering `Treasury.pay` from the token
///         hook. `swallow = true` catches the re-entry revert so the outer payment can complete.
contract ReentrantRecipient is ITokensRecipient {
    ITreasury public immutable treasury;
    uint256 public targetId;
    bool public swallow;
    bool public armed;
    uint256 public hookCalls;
    bytes public lastRevert;

    constructor(ITreasury treasury_, ReentrantToken token) {
        treasury = treasury_;
        token.registerHook();
    }

    function arm(uint256 id, bool swallow_) external {
        targetId = id;
        swallow = swallow_;
        armed = true;
    }

    function tokensReceived(address, uint256) external {
        hookCalls += 1;
        if (!armed) return;
        (bool ok, bytes memory ret) = address(treasury).call(abi.encodeCall(ITreasury.pay, (targetId)));
        if (ok || swallow) {
            lastRevert = ret;
            return;
        }
        assembly {
            revert(add(ret, 32), mload(ret))
        }
    }
}
