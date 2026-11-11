// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IClock} from "./interfaces/IClock.sol";
import {ITreasury} from "./interfaces/ITreasury.sol";
import {IObligationRegistry, Obligation, ObligationStatus} from "./interfaces/IObligationRegistry.sol";
import {IPolicyEngine, AdapterStatus} from "./interfaces/IPolicyEngine.sol";
import {IVaultAdapter} from "./interfaces/IVaultAdapter.sol";
import {
    ZeroAddress,
    ZeroAmount,
    CircuitBreakerActive,
    AdapterNotWhitelisted,
    AdapterUnknown,
    AdapterMismatch,
    InsufficientIdle,
    InsufficientLiquidity,
    ObligationNotDue,
    ObligationNotActive,
    NotDemoMode,
    InvalidTimeOffset
} from "./libraries/Errors.sol";

/// @title Treasury (docs/02 §A)
/// @notice Custody of DAO funds. Invests/withdraws only between itself and whitelisted adapters (subject to
///         PolicyEngine), pays registered obligations, owns the circuit breaker (R6) and the system clock.
/// @dev R5 (No External Transfer) is structural: the ONLY outbound transfer is in `pay()`, with recipient and amount
///      taken from the registry. No receive, no fallback, no execute, no sweep, no approve to EOAs.
contract Treasury is AccessControl, ReentrancyGuard, ITreasury {
    using SafeERC20 for IERC20;

    bytes32 public constant AGENT_ROLE = keccak256("AGENT_ROLE");
    uint64 public constant MAX_TIME_OFFSET = 365 days;

    IERC20 private immutable _asset;
    IObligationRegistry private immutable _registry;
    IPolicyEngine private immutable _policy;
    bool public immutable demoMode;

    uint64 public timeOffset;
    bool public circuitBreakerActive;

    modifier onlyAgentOrAdmin() {
        if (!hasRole(AGENT_ROLE, msg.sender) && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {
            revert AccessControlUnauthorizedAccount(msg.sender, AGENT_ROLE);
        }
        _;
    }

    constructor(IERC20 asset_, IObligationRegistry registry_, IPolicyEngine policy_, address admin, bool demoMode_) {
        if (
            address(asset_) == address(0) || address(registry_) == address(0) || address(policy_) == address(0)
                || admin == address(0)
        ) revert ZeroAddress();
        _asset = asset_;
        _registry = registry_;
        _policy = policy_;
        demoMode = demoMode_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin); // AGENT_ROLE is granted in deployment step 9
    }

    // ------------------------------------------------------------------------------------------------ clock

    function currentTime() public view returns (uint64) {
        // casting to uint64 is safe: block.timestamp fits in uint64 for ~584 billion years
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint64(block.timestamp) + timeOffset;
    }

    // ------------------------------------------------------------------------------------------------ AGENT / ADMIN

    function invest(address adapter, uint256 amount) external onlyAgentOrAdmin nonReentrant {
        if (circuitBreakerActive) revert CircuitBreakerActive(); // 1. R6
        if (amount == 0) revert ZeroAmount(); // 2.
        // 3. R4 fail-fast before ANY external call into the adapter
        if (_policy.adapterStatus(adapter) != AdapterStatus.ACTIVE) revert AdapterNotWhitelisted(adapter);
        // 4. adapter wiring
        if (IVaultAdapter(adapter).treasury() != address(this) || IVaultAdapter(adapter).asset() != address(_asset)) {
            revert AdapterMismatch(adapter);
        }
        // 5. idle
        uint256 idle = _asset.balanceOf(address(this));
        if (amount > idle) revert InsufficientIdle(amount, idle);
        // 6. policy: re-checks R4, then R1, R3
        _policy.checkInvest(adapter, amount, idle, vaultBalance(adapter), totalAssets(), currentTime());

        _asset.safeTransfer(adapter, amount);
        IVaultAdapter(adapter).deposit(amount);
        emit Invested(adapter, amount, msg.sender, _asset.balanceOf(address(this)));
    }

    /// @notice Allowed while the circuit breaker is active (R6). No destination parameter exists (R5).
    function withdraw(address adapter, uint256 amount)
        external
        onlyAgentOrAdmin
        nonReentrant
        returns (uint256 received)
    {
        if (_policy.adapterStatus(adapter) == AdapterStatus.NONE) {
            revert AdapterUnknown(adapter);
        }
        if (amount == 0) revert ZeroAmount();
        if (amount == type(uint256).max) amount = IVaultAdapter(adapter).balance();
        uint256 before = _asset.balanceOf(address(this));
        IVaultAdapter(adapter).withdraw(amount);
        received = _asset.balanceOf(address(this)) - before;
        emit Withdrawn(adapter, amount, received, msg.sender);
    }

    function tripCircuitBreaker() external onlyAgentOrAdmin {
        circuitBreakerActive = true; // idempotent
        emit CircuitBreakerTripped(msg.sender);
    }

    // ------------------------------------------------------------------------------------------------ ADMIN

    function resetCircuitBreaker() external onlyRole(DEFAULT_ADMIN_ROLE) {
        circuitBreakerActive = false;
        emit CircuitBreakerReset(msg.sender);
    }

    function setTimeOffset(uint64 newOffset) public onlyRole(DEFAULT_ADMIN_ROLE) {
        if (!demoMode) revert NotDemoMode();
        uint64 old = timeOffset;
        if (newOffset < old || newOffset > MAX_TIME_OFFSET) revert InvalidTimeOffset(old, newOffset);
        timeOffset = newOffset;
        emit TimeOffsetUpdated(old, newOffset);
    }

    /// @dev `advanceTime(x) = setTimeOffset(timeOffset + x)`; the sum saturates so setTimeOffset reports the bound.
    function advanceTime(uint64 secondsToAdd) external {
        uint256 requested = uint256(timeOffset) + secondsToAdd;
        // casting to uint64 is safe: guarded by the comparison on the same line
        // forge-lint: disable-next-line(unsafe-typecast)
        setTimeOffset(requested > type(uint64).max ? type(uint64).max : uint64(requested));
    }

    // ------------------------------------------------------------------------------------------------ anyone

    /// @notice Pays the next due occurrence of an obligation to its registered recipient. Allowed while breaker active.
    function pay(uint256 obligationId) external nonReentrant {
        Obligation memory ob = _registry.getObligation(obligationId); // reverts UnknownObligation
        if (ob.status != ObligationStatus.ACTIVE) revert ObligationNotActive(obligationId);
        uint64 nowTs = currentTime();
        if (nowTs < ob.nextDueDate) revert ObligationNotDue(obligationId, ob.nextDueDate, nowTs);

        uint256 idle = _asset.balanceOf(address(this));
        if (idle < ob.amount) {
            _pullLiquidity(ob.amount - idle);
            idle = _asset.balanceOf(address(this));
        }
        if (idle < ob.amount) revert InsufficientLiquidity(ob.amount, idle);

        // effects (registry) before the transfer — CEI
        (address recipient, uint256 amount, uint32 occurrence) = _registry.markPaid(obligationId);
        _asset.safeTransfer(recipient, amount);
        emit ObligationPaid(obligationId, recipient, amount, occurrence, msg.sender);
    }

    /// @notice R2: pulls any reserve shortfall back from adapters. Cheap no-op when there is none.
    function enforceDeadlines() external nonReentrant returns (uint256 withdrawn) {
        uint256 s = _policy.liquidityShortfall(_asset.balanceOf(address(this)), currentTime());
        if (s == 0) return 0;
        withdrawn = _pullLiquidity(s);
        emit DeadlineEnforced(msg.sender, s, withdrawn);
    }

    // ------------------------------------------------------------------------------------------------ views

    function asset() external view returns (address) {
        return address(_asset);
    }

    function registry() external view returns (address) {
        return address(_registry);
    }

    function policy() external view returns (address) {
        return address(_policy);
    }

    function idleBalance() public view returns (uint256) {
        return _asset.balanceOf(address(this));
    }

    function vaultBalance(address adapter) public view returns (uint256) {
        return _policy.adapterStatus(adapter) == AdapterStatus.NONE ? 0 : IVaultAdapter(adapter).balance();
    }

    function totalAssets() public view returns (uint256 total) {
        total = _asset.balanceOf(address(this));
        address[] memory adapters = _policy.getAdapters(); // <= MAX_ADAPTERS
        for (uint256 i = 0; i < adapters.length; ++i) {
            total += vaultBalance(adapters[i]);
        }
    }

    function requiredReserve() external view returns (uint256) {
        return _policy.requiredReserve(currentTime());
    }

    function shortfall() external view returns (uint256) {
        return _policy.liquidityShortfall(_asset.balanceOf(address(this)), currentTime());
    }

    function maxInvestable(address adapter) external view returns (uint256) {
        if (circuitBreakerActive) return 0;
        return _policy.maxInvestable(
            adapter, _asset.balanceOf(address(this)), vaultBalance(adapter), totalAssets(), currentTime()
        );
    }

    // ------------------------------------------------------------------------------------------------ internal

    /// @dev Pulls up to `needed` from adapters in policy order; failing adapters are skipped (try/catch) and amounts
    ///      are measured by balance delta, so a misreporting adapter cannot inflate `pulled`.
    function _pullLiquidity(uint256 needed) internal returns (uint256 pulled) {
        address[] memory adapters = _policy.getAdapters(); // <= MAX_ADAPTERS
        for (uint256 i = 0; i < adapters.length; ++i) {
            address adapter = adapters[i];
            if (_policy.adapterStatus(adapter) == AdapterStatus.NONE) continue;
            uint256 bal = IVaultAdapter(adapter).balance();
            uint256 liq = IVaultAdapter(adapter).availableLiquidity();
            uint256 available = bal < liq ? bal : liq;
            uint256 rest = needed - pulled;
            uint256 take = rest < available ? rest : available;
            if (take == 0) continue;
            uint256 before = _asset.balanceOf(address(this));
            try IVaultAdapter(adapter).withdraw(take) {
                pulled += _asset.balanceOf(address(this)) - before;
            } catch (bytes memory reason) {
                emit AdapterWithdrawFailed(adapter, take, reason);
            }
            if (pulled >= needed) break;
        }
    }
}
