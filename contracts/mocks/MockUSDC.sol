// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title MockUSDC — MOCK test token for the RunwayMind demo (docs/02 §F)
/// @notice MOCK token with NO monetary value. 6 decimals like USDC. Only the owner can mint (demo funding).
contract MockUSDC is ERC20, Ownable {
    constructor() ERC20("Mock USD Coin", "mUSDC") Ownable(msg.sender) {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
