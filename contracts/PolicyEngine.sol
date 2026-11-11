// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IPolicyEngine, AdapterStatus} from "./interfaces/IPolicyEngine.sol";
import {IObligationRegistry} from "./interfaces/IObligationRegistry.sol";
import {IVaultAdapter} from "./interfaces/IVaultAdapter.sol";
import {
    ZeroAddress,
    AdapterNotWhitelisted,
    AdapterMismatch,
    ReserveViolation,
    ExposureLimitExceeded,
    InvalidParameter,
    TooManyAdapters,
    AdapterHasBalance
} from "./libraries/Errors.sol";

/// @title PolicyEngine (docs/02 §C)
/// @notice Holds policy parameters and the adapter whitelist; computes the required reserve, shortfall, deadlines and
///         max investable; validates investments (R1, R3, R4). Stateless with respect to funds.
contract PolicyEngine is AccessControl, IPolicyEngine {
    uint256 public constant MAX_ADAPTERS = 5;
    uint64 public constant MIN_SAFETY_HORIZON = 1 days;
    uint64 public constant MAX_SAFETY_HORIZON = 90 days;

    address public immutable asset;
    IObligationRegistry private immutable _registry;

    uint64 public safetyHorizon;
    uint256 public emergencyBuffer;
    uint16 public maxExposureBps;

    mapping(address => AdapterStatus) public adapterStatus;
    address[] private _adapters;

    constructor(
        address admin,
        address asset_,
        IObligationRegistry registry_,
        uint64 safetyHorizon_,
        uint256 emergencyBuffer_,
        uint16 maxExposureBps_
    ) {
        if (admin == address(0) || asset_ == address(0) || address(registry_) == address(0)) {
            revert ZeroAddress();
        }
        _validateSafetyHorizon(safetyHorizon_);
        _validateMaxExposure(maxExposureBps_);
        asset = asset_;
        _registry = registry_;
        safetyHorizon = safetyHorizon_;
        emergencyBuffer = emergencyBuffer_;
        maxExposureBps = maxExposureBps_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        emit PolicyParametersUpdated(safetyHorizon_, emergencyBuffer_, maxExposureBps_);
    }

    // ------------------------------------------------------------------------------------------------ ADMIN

    function setSafetyHorizon(uint64 h) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _validateSafetyHorizon(h);
        safetyHorizon = h;
        _emitParams();
    }

    function setEmergencyBuffer(uint256 buffer) external onlyRole(DEFAULT_ADMIN_ROLE) {
        emergencyBuffer = buffer;
        _emitParams();
    }

    function setMaxExposureBps(uint16 bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _validateMaxExposure(bps);
        maxExposureBps = bps;
        _emitParams();
    }

    function setAdapterStatus(address adapter, AdapterStatus status) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (adapter == address(0)) revert ZeroAddress();
        AdapterStatus current = adapterStatus[adapter];

        if (status == AdapterStatus.NONE) {
            if (current != AdapterStatus.NONE) {
                uint256 bal = IVaultAdapter(adapter).balance();
                if (bal != 0) revert AdapterHasBalance(adapter, bal);
                _removeAdapter(adapter);
            }
        } else if (current == AdapterStatus.NONE) {
            if (_adapters.length >= MAX_ADAPTERS) revert TooManyAdapters();
            if (IVaultAdapter(adapter).asset() != asset) revert AdapterMismatch(adapter);
            _adapters.push(adapter);
        }

        adapterStatus[adapter] = status;
        emit AdapterStatusUpdated(adapter, status);
    }

    // ------------------------------------------------------------------------------------------------ views

    function registry() external view returns (address) {
        return address(_registry);
    }

    function getAdapters() external view returns (address[] memory) {
        return _adapters;
    }

    function requiredReserve(uint64 nowTs) public view returns (uint256) {
        return _registry.amountDueUntil(nowTs + safetyHorizon) + emergencyBuffer;
    }

    function liquidityShortfall(uint256 idle, uint64 nowTs) public view returns (uint256) {
        uint256 req = requiredReserve(nowTs);
        return req > idle ? req - idle : 0;
    }

    function withdrawalDeadline(uint64 dueDate) public view returns (uint64) {
        return dueDate > safetyHorizon ? dueDate - safetyHorizon : 0;
    }

    /// @dev Exact rule logic of docs/02 §C.4: R4 → R1 → R3.
    function checkInvest(
        address adapter,
        uint256 amount,
        uint256 idleBefore,
        uint256 adapterBalanceBefore,
        uint256 totalAssets_,
        uint64 nowTs
    ) public view {
        // R4 — whitelist
        if (adapterStatus[adapter] != AdapterStatus.ACTIVE) revert AdapterNotWhitelisted(adapter);
        // R1 — reserve ratio (idle after investment must cover window + buffer)
        uint256 req = requiredReserve(nowTs);
        uint256 idleAfter = idleBefore - amount; // Treasury already checked amount <= idleBefore
        if (idleAfter < req) revert ReserveViolation(idleAfter, req);
        // R3 — exposure limit (inclusive)
        uint256 cap = (totalAssets_ * maxExposureBps) / 10_000;
        uint256 afterBal = adapterBalanceBefore + amount;
        if (afterBal > cap) revert ExposureLimitExceeded(afterBal, cap);
    }

    function maxInvestable(address adapter, uint256 idle, uint256 adapterBalance, uint256 totalAssets_, uint64 nowTs)
        external
        view
        returns (uint256)
    {
        if (adapterStatus[adapter] != AdapterStatus.ACTIVE) return 0;
        uint256 req = requiredReserve(nowTs);
        uint256 r1 = idle > req ? idle - req : 0;
        uint256 cap = (totalAssets_ * maxExposureBps) / 10_000;
        uint256 r3 = cap > adapterBalance ? cap - adapterBalance : 0;
        return r1 < r3 ? r1 : r3;
    }

    // ------------------------------------------------------------------------------------------------ internal

    function _validateSafetyHorizon(uint64 h) private pure {
        if (h < MIN_SAFETY_HORIZON || h > MAX_SAFETY_HORIZON) revert InvalidParameter("safetyHorizon");
    }

    function _validateMaxExposure(uint16 bps) private pure {
        if (bps < 1 || bps > 10_000) revert InvalidParameter("maxExposureBps");
    }

    function _emitParams() private {
        emit PolicyParametersUpdated(safetyHorizon, emergencyBuffer, maxExposureBps);
    }

    function _removeAdapter(address adapter) private {
        uint256 n = _adapters.length;
        for (uint256 i = 0; i < n; ++i) {
            if (_adapters[i] == adapter) {
                _adapters[i] = _adapters[n - 1];
                _adapters.pop();
                return;
            }
        }
    }
}
