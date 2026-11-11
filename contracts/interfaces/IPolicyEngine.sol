// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

enum AdapterStatus {
    NONE,
    ACTIVE,
    WITHDRAW_ONLY
}

interface IPolicyEngine {
    event PolicyParametersUpdated(uint64 safetyHorizon, uint256 emergencyBuffer, uint16 maxExposureBps);
    event AdapterStatusUpdated(address indexed adapter, AdapterStatus status);

    // ADMIN
    function setSafetyHorizon(uint64 h) external;
    function setEmergencyBuffer(uint256 buffer) external;
    function setMaxExposureBps(uint16 bps) external;
    function setAdapterStatus(address adapter, AdapterStatus status) external;

    // views / checks
    function asset() external view returns (address);
    function registry() external view returns (address);
    function safetyHorizon() external view returns (uint64);
    function emergencyBuffer() external view returns (uint256);
    function maxExposureBps() external view returns (uint16);
    function adapterStatus(address adapter) external view returns (AdapterStatus);
    function getAdapters() external view returns (address[] memory);

    function requiredReserve(uint64 nowTs) external view returns (uint256);
    function liquidityShortfall(uint256 idle, uint64 nowTs) external view returns (uint256);
    function withdrawalDeadline(uint64 dueDate) external view returns (uint64);
    function checkInvest(
        address adapter,
        uint256 amount,
        uint256 idleBefore,
        uint256 adapterBalanceBefore,
        uint256 totalAssets,
        uint64 nowTs
    ) external view;
    function maxInvestable(address adapter, uint256 idle, uint256 adapterBalance, uint256 totalAssets, uint64 nowTs)
        external
        view
        returns (uint256);
}
