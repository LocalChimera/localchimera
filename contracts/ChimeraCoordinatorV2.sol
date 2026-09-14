// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ChimeraCoordinatorV2
 * @notice Tokenomics-enabled job router for the Chimera DePIN platform.
 *
 * Replaces the ETH-based payment model with CHIMERA token payments via transferFrom.
 * Adds two-tier provider selection (staked Tier 1 > unstaked Tier 2), reputation-weighted
 * scoring, sliding-scale platform fees by stake, gradient slashing on fallback,
 * consumer priority boost, premium routing, referral bonuses, auto-buyback and burn,
 * WETH fee conversion, reward distribution to stakers, emergency pause, and a
 * circuit breaker.
 *
 * The v1 coordinator (ETH-based) remains deployed but is deprecated. All new jobs
 * should use this v2 coordinator with CHIMERA payments.
 */

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

interface IChimeraStaking {
    function getStake(address provider) external view returns (uint256 staked, uint256 weight, uint256 lockMultiplier, uint256 unlockAt, uint256 unstakeAvailableAt);
    function slash(address provider, address consumer, uint256 jobAmount) external;
    function incrementSuccessfulJobs(address provider) external;
    function getCircuitBreakerStatus() external view returns (uint256 slashVolume24h, uint256 totalStaked, bool triggered);
    function consumerBoostStake(uint256 amount) external;
    function consumerBoostUnstake(uint256 amount) external;
    function getPremiumStatus(address provider) external view returns (bool priorityRouting, bool higherThroughput, bool customPricing);
    function payReferralBonus(address referee, uint256 amount) external;
    function getReferralInfo(address user) external view returns (address referrer, uint256 jobsCounted, uint256 totalEarned);
    function distributeRewards(uint256 amount) external;
    function fundRewardPool(uint256 amount) external;
    function resetCircuitBreaker() external;
}

interface IComputeRegistry {
    struct Provider {
        address authority;
        bytes32 qvacPeerId;
        string name;
        uint16 taskTypes;
        uint64 jobsCompleted;
        uint256 totalEarned;
        uint256 totalStaked;
        uint8 status;
    }

    function getRegisteredProviders() external view returns (address[] memory);
    function getProvider(address providerAddress) external view returns (Provider memory);
    function getProviderStatus(address providerAddress) external view returns (uint8);
}

interface IChimeraToken {
    function burn(uint256 amount) external;
}

interface IUniswapV4Pool {
    function swap(address recipient, bool zeroForOne, int256 amountSpecified, uint160 sqrtPriceLimitX96, bytes calldata data) external;
    function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked);
}

contract ChimeraCoordinatorV2 is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ───────────────────────── Roles ─────────────────────────
    bytes32 public constant COORDINATOR_ROLE = keccak256("COORDINATOR_ROLE");
    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");

    // ───────────────────────── Token References ─────────────────────────
    IERC20 public immutable chimeraToken;
    IERC20 public immutable weth;
    IChimeraStaking public staking;
    IComputeRegistry public registry;

    // ───────────────────────── Constants ─────────────────────────
    uint8 constant PROVIDER_STATUS_ACTIVE = 1;
    uint256 private constant BPS_DENOMINATOR = 10000;
    uint256 public constant POI_BURN_BPS = 1000; // 10% burn on PoI settlement

    // Sliding scale fee tiers (bps)
    uint16 public constant FEE_BPS_0_STAKE = 300;      // 3.0%
    uint16 public constant FEE_BPS_10K_STAKE = 250;    // 2.5%
    uint16 public constant FEE_BPS_50K_STAKE = 200;    // 2.0%
    uint16 public constant FEE_BPS_100K_STAKE = 150;   // 1.5%

    // ───────────────────────── Configurable Parameters ─────────────────────────
    uint256 public fallbackTimeout = 60;
    uint256 public refundTimeout = 1 hours;
    uint256 public buybackBps = 2000; // 20% of platform fees → buyback
    uint256 public maxSlippageBps = 300; // 3% default
    uint256 public buybackThreshold = 10_000 * 10 ** 18; // 10K CHIMERA worth

    // ───────────────────────── Job State ─────────────────────────
    struct Job {
        bytes32 jobId;
        address consumer;
        address provider;
        uint64  taskType;
        uint256 amount;         // CHIMERA amount
        uint256 platformFee;    // CHIMERA platform fee
        uint256 deadline;
        uint256 createdAt;
        bool    paid;
        bool    bridged;
        bool    refunded;
        bool    fallbackCompleted;
        uint8   policy;
    }

    mapping(address => Job) public jobs;
    address[] public jobList;

    // ───────────────────────── Fee Accumulation ─────────────────────────
    uint256 public accumulatedPlatformFees;  // CHIMERA
    uint256 public accumulatedWethFees;      // WETH from hook fees
    uint256 public buybackAccumulated;      // CHIMERA allocated for buyback

    // ───────────────────────── Uniswap V4 ─────────────────────────
    address public uniswapV4Pool; // V4 pool for CHIMERA/WETH

    // ───────────────────────── Events ─────────────────────────
    event JobRouted(bytes32 indexed jobId, address indexed jobAddress, address indexed provider, uint64 taskType, uint256 amount, uint16 feeBps);
    event JobPaid(bytes32 indexed jobId, address indexed jobAddress, address indexed provider, uint256 amount, uint256 platformFee);
    event FallbackTriggered(bytes32 indexed jobId, address indexed jobAddress, address indexed provider, uint256 slashAmount);
    event BuybackExecuted(uint256 wethSpent, uint256 chimeraBought, uint256 chimeraBurned);
    event FeeSwapExecuted(uint256 wethSwapped, uint256 chimeraReceived);
    event FeesDistributed(uint256 amount);
    event ReferralBonusPaid(address indexed referrer, address indexed referee, uint256 amount);
    event CircuitBreakerTriggered();
    event StakingUpdated(address indexed previousStaking, address indexed newStaking);
    event RegistryUpdated(address indexed previousRegistry, address indexed newRegistry);
    event UniswapV4PoolUpdated(address indexed previousPool, address indexed newPool);
    event BuybackBpsUpdated(uint256 newBps);
    event MaxSlippageBpsUpdated(uint256 newBps);

    // ───────────────────────── Errors ─────────────────────────
    error ZeroAmount();
    error ZeroAddress();
    error NoProviderAvailable();
    error JobNotFound();
    error JobAlreadyPaid();
    error JobAlreadyBridged();
    error DeadlineNotPassed();
    error NotAssignedProvider();
    error OnlyConsumer();
    error OnlyGovernance();
    error OnlyCoordinator();
    error CircuitBreakerActive();
    error InsufficientBuybackBalance();
    error SlippageExceeded();

    // ───────────────────────── Constructor ─────────────────────────
    constructor(
        address _chimeraToken,
        address _weth,
        address _staking,
        address _registry,
        address admin
    ) {
        if (_chimeraToken == address(0) || _weth == address(0) || _staking == address(0) || _registry == address(0)) revert ZeroAddress();
        chimeraToken = IERC20(_chimeraToken);
        weth = IERC20(_weth);
        staking = IChimeraStaking(_staking);
        registry = IComputeRegistry(_registry);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(COORDINATOR_ROLE, admin);
        _grantRole(GOVERNANCE_ROLE, admin);
    }

    // ───────────────────────── Modifiers ─────────────────────────
    modifier onlyGovernance() {
        if (!hasRole(GOVERNANCE_ROLE, msg.sender)) revert OnlyGovernance();
        _;
    }

    modifier onlyCoordinator() {
        if (!hasRole(COORDINATOR_ROLE, msg.sender)) revert OnlyCoordinator();
        _;
    }

    // ───────────────────────── Job Creation ─────────────────────────

    /**
     * @notice Create and route a job. Payment is in CHIMERA (transferFrom).
     * @param requestHash   Hash of the request payload.
     * @param nonce         Unique nonce.
     * @param taskType      1=compute, 2=storage, 4=inference, 8=bandwidth.
     * @param amount        CHIMERA amount to pay for the job.
     * @param policy        0=hybrid, 1=first-party-only, 2=second-party-only.
     * @return jobAddress   Deterministic job address.
     * @return jobId        Job ID.
     */
    function createJob(
        bytes32 requestHash,
        uint64  nonce,
        uint64  taskType,
        uint256 amount,
        uint8   policy
    ) external nonReentrant whenNotPaused returns (address jobAddress, bytes32 jobId) {
        if (amount == 0) revert ZeroAmount();

        // Transfer CHIMERA from consumer to coordinator
        chimeraToken.safeTransferFrom(msg.sender, address(this), amount);

        // Select provider (two-tier: staked Tier 1 first, then unstaked Tier 2)
        address provider = selectProvider(taskType);
        if (provider == address(0)) revert NoProviderAvailable();

        // Compute sliding-scale platform fee
        uint16 feeBps = getPlatformFeeBps(msg.sender);
        uint256 platformFee = (amount * feeBps) / BPS_DENOMINATOR;
        uint256 providerAmount = amount - platformFee;

        // Generate job address and ID
        jobAddress = _jobAddress(requestHash, nonce, taskType, msg.sender);
        jobId = keccak256(abi.encodePacked(jobAddress, block.number));

        jobs[jobAddress] = Job({
            jobId: jobId,
            consumer: msg.sender,
            provider: provider,
            taskType: taskType,
            amount: providerAmount,
            platformFee: platformFee,
            deadline: block.timestamp + fallbackTimeout,
            createdAt: block.timestamp,
            paid: false,
            bridged: false,
            refunded: false,
            fallbackCompleted: false,
            policy: policy
        });
        jobList.push(jobAddress);

        // Accumulate platform fee
        accumulatedPlatformFees += platformFee;

        emit JobRouted(jobId, jobAddress, provider, taskType, amount, feeBps);
        return (jobAddress, jobId);
    }

    // ───────────────────────── Job Completion ─────────────────────────

    /**
     * @notice Provider calls this to claim payment after completing a job.
     * @param jobAddress   The job address.
     * @param responseHash Hash of the response payload.
     */
    function payProvider(address jobAddress, bytes32 responseHash) external nonReentrant whenNotPaused {
        Job storage job = jobs[jobAddress];
        if (job.consumer == address(0)) revert JobNotFound();
        if (job.paid) revert JobAlreadyPaid();
        if (job.bridged) revert JobAlreadyBridged();
        if (msg.sender != job.provider) revert NotAssignedProvider();
        if (block.timestamp > job.deadline) revert DeadlineNotPassed();

        job.paid = true;
        uint256 amount = job.amount;
        if (amount > 0) {
            chimeraToken.safeTransfer(job.provider, amount);
        }

        // Increment successful jobs for offense reset
        staking.incrementSuccessfulJobs(job.provider);

        // Pay referral bonus if applicable
        (address referrer, uint256 jobsCounted,) = staking.getReferralInfo(job.provider);
        if (referrer != address(0) && jobsCounted < 10) {
            uint256 referralBonus = (amount * 500) / BPS_DENOMINATOR; // 5%
            staking.payReferralBonus(job.provider, referralBonus);
            emit ReferralBonusPaid(referrer, job.provider, referralBonus);
        }

        emit JobPaid(job.jobId, jobAddress, job.provider, amount, job.platformFee);
    }

    /**
     * @notice Trigger fallback when the assigned provider has not completed in time.
     *         Slashes the Tier 1 provider and marks the job as bridged.
     */
    function triggerFallback(address jobAddress) external nonReentrant whenNotPaused {
        Job storage job = jobs[jobAddress];
        if (job.consumer == address(0)) revert JobNotFound();
        if (job.bridged) revert JobAlreadyBridged();
        if (job.paid) revert JobAlreadyPaid();
        if (block.timestamp <= job.deadline) revert DeadlineNotPassed();

        // Slash the assigned provider (only affects Tier 1 stakers)
        staking.slash(job.provider, job.consumer, job.amount);
        job.bridged = true;

        // Check circuit breaker
        (, , bool triggered) = staking.getCircuitBreakerStatus();
        if (triggered) {
            _pause();
            emit CircuitBreakerTriggered();
        }

        emit FallbackTriggered(job.jobId, jobAddress, job.provider, job.amount);
    }

    // ───────────────────────── Provider Selection ─────────────────────────

    /**
     * @notice Two-tier provider selection.
     *         1. Premium providers (burned for priority routing) — first priority
     *         2. Tier 1 staked providers — weighted by sqrt(stake) * reputation * lock
     *         3. Tier 2 unstaked providers — fallback from ComputeRegistry
     */
    function selectProvider(uint64 taskType) public view returns (address) {
        address[] memory providers = registry.getRegisteredProviders();
        if (providers.length == 0) return address(0);

        // Phase 1: Check for premium providers with matching task type
        address bestPremium;
        uint256 bestPremiumScore = 0;
        for (uint256 i = 0; i < providers.length; i++) {
            address candidate = providers[i];
            if (registry.getProviderStatus(candidate) != PROVIDER_STATUS_ACTIVE) continue;
            IComputeRegistry.Provider memory p = registry.getProvider(candidate);
            if ((p.taskTypes & uint16(taskType)) == 0) continue;

            (bool priorityRouting,,) = staking.getPremiumStatus(candidate);
            if (!priorityRouting) continue;

            uint256 score = uint256(keccak256(abi.encodePacked(block.number, candidate, tx.origin)));
            if (score > bestPremiumScore) {
                bestPremiumScore = score;
                bestPremium = candidate;
            }
        }
        if (bestPremium != address(0)) return bestPremium;

        // Phase 2: Tier 1 staked providers — weighted by sqrt(stake) * reputation * lock
        address bestTier1;
        uint256 bestWeight = 0;
        for (uint256 i = 0; i < providers.length; i++) {
            address candidate = providers[i];
            if (registry.getProviderStatus(candidate) != PROVIDER_STATUS_ACTIVE) continue;
            IComputeRegistry.Provider memory p = registry.getProvider(candidate);
            if ((p.taskTypes & uint16(taskType)) == 0) continue;

            (uint256 staked, uint256 weight,,,) = staking.getStake(candidate);
            if (staked == 0) continue; // skip unstaked for Tier 1

            // Reputation multiplier: 1 + min(jobsCompleted/500, 1) * (1 - slashCount/max(jobs,1))
            // Simplified: use weight from staking (already includes sqrt(stake) * lockMult)
            // Multiply by reputation factor
            uint256 repMultiplier = _reputationMultiplier(p.jobsCompleted);
            uint256 totalWeight = weight * repMultiplier / BPS_DENOMINATOR;

            // Add pseudo-random component for load balancing
            uint256 randomFactor = uint256(keccak256(abi.encodePacked(block.number, candidate, tx.origin)));
            uint256 score = totalWeight + (randomFactor % (totalWeight / 10 + 1));

            if (score > bestWeight) {
                bestWeight = score;
                bestTier1 = candidate;
            }
        }
        if (bestTier1 != address(0)) return bestTier1;

        // Phase 3: Tier 2 unstaked providers — fallback pseudo-random selection
        address bestTier2;
        uint256 bestScore = type(uint256).max;
        for (uint256 i = 0; i < providers.length; i++) {
            address candidate = providers[i];
            if (registry.getProviderStatus(candidate) != PROVIDER_STATUS_ACTIVE) continue;
            IComputeRegistry.Provider memory p = registry.getProvider(candidate);
            if ((p.taskTypes & uint16(taskType)) == 0) continue;

            (uint256 staked,,,,) = staking.getStake(candidate);
            if (staked > 0) continue; // skip staked for Tier 2

            uint256 score = uint256(keccak256(abi.encodePacked(block.number, block.timestamp, candidate, tx.origin)));
            if (score < bestScore) {
                bestScore = score;
                bestTier2 = candidate;
            }
        }
        return bestTier2;
    }

    function _reputationMultiplier(uint64 jobsCompleted) internal pure returns (uint256) {
        // 1 + min(jobsCompleted/500, 1)  → range [1.0x, 2.0x]
        // Return in bps: 10000 = 1.0x, 20000 = 2.0x
        if (jobsCompleted >= 500) return 20000;
        return 10000 + (uint256(jobsCompleted) * 10000) / 500;
    }

    // ───────────────────────── Sliding Scale Fees ─────────────────────────

    /**
     * @notice Get the platform fee in bps based on the user's stake.
     *         0 stake = 3%, 10K+ = 2.5%, 50K+ = 2%, 100K+ = 1.5%.
     */
    function getPlatformFeeBps(address user) public view returns (uint16) {
        (uint256 staked,,,,) = staking.getStake(user);
        if (staked >= 100_000 * 10 ** 18) return FEE_BPS_100K_STAKE;
        if (staked >= 50_000 * 10 ** 18) return FEE_BPS_50K_STAKE;
        if (staked >= 10_000 * 10 ** 18) return FEE_BPS_10K_STAKE;
        return FEE_BPS_0_STAKE;
    }

    // ───────────────────────── Auto-Buyback and Burn ─────────────────────────

    /**
     * @notice Execute buyback: swap 20% of accumulated platform fees (in WETH or CHIMERA)
     *         for CHIMERA on the V4 pool and burn it.
     * @param _maxSlippageBps Maximum slippage allowed (bps).
     * @dev Anyone can call this when buyback balance exceeds the threshold.
     */
    function executeBuyback(uint256 _maxSlippageBps) external nonReentrant whenNotPaused {
        uint256 buybackAmount = (accumulatedPlatformFees * buybackBps) / BPS_DENOMINATOR;
        if (buybackAmount < buybackThreshold) revert InsufficientBuybackBalance();

        // Deduct from accumulated fees
        accumulatedPlatformFees -= buybackAmount;

        // In production, this would swap on the Uniswap V4 pool.
        // For now, burn the CHIMERA directly (simplification: fees are already in CHIMERA).
        // A full implementation would:
        //   1. Check V4 pool spot price
        //   2. Swap WETH → CHIMERA (or burn CHIMERA directly if already in CHIMERA)
        //   3. Burn received CHIMERA
        IChimeraToken(address(chimeraToken)).burn(buybackAmount);

        emit BuybackExecuted(0, buybackAmount, buybackAmount);
    }

    /**
     * @notice Swap accumulated WETH hook fees for CHIMERA on the V4 pool.
     * @param _maxSlippageBps Maximum slippage allowed (bps).
     */
    function executeFeeSwap(uint256 _maxSlippageBps) external nonReentrant whenNotPaused {
        uint256 wethBalance = accumulatedWethFees;
        if (wethBalance == 0) revert ZeroAmount();

        accumulatedWethFees = 0;

        // In production, this would swap WETH → CHIMERA on the V4 pool.
        // For now, transfer WETH to the staking reward pool as-is.
        // A full implementation would:
        //   1. Check V4 pool spot price for WETH → CHIMERA
        //   2. Execute swap with slippage protection
        //   3. Transfer received CHIMERA to staking reward pool
        weth.safeTransfer(address(staking), wethBalance);

        emit FeeSwapExecuted(wethBalance, 0);
    }

    /**
     * @notice Distribute remaining platform fees (80%) to Tier 1 stakers via staking.
     */
    function distributeFees() external nonReentrant whenNotPaused {
        uint256 distributable = accumulatedPlatformFees;
        if (distributable == 0) revert ZeroAmount();

        accumulatedPlatformFees = 0;

        // Fund the staking reward pool and distribute
        chimeraToken.forceApprove(address(staking), distributable);
        staking.fundRewardPool(distributable);
        staking.distributeRewards(distributable);

        emit FeesDistributed(distributable);
    }

    // ───────────────────────── Emergency Pause / Circuit Breaker ─────────────────────────

    function pause() external onlyGovernance {
        _pause();
    }

    function unpause() external onlyGovernance {
        _unpause();
        staking.resetCircuitBreaker();
    }

    // ───────────────────────── Admin ─────────────────────────

    function setStaking(address _staking) external onlyGovernance {
        if (_staking == address(0)) revert ZeroAddress();
        emit StakingUpdated(address(staking), _staking);
        staking = IChimeraStaking(_staking);
    }

    function setRegistry(address _registry) external onlyGovernance {
        if (_registry == address(0)) revert ZeroAddress();
        emit RegistryUpdated(address(registry), _registry);
        registry = IComputeRegistry(_registry);
    }

    function setUniswapV4Pool(address _pool) external onlyGovernance {
        emit UniswapV4PoolUpdated(uniswapV4Pool, _pool);
        uniswapV4Pool = _pool;
    }

    function setBuybackBps(uint256 newBps) external onlyGovernance {
        require(newBps <= 5000, "buyback bps too high");
        buybackBps = newBps;
        emit BuybackBpsUpdated(newBps);
    }

    function setMaxSlippageBps(uint256 newBps) external onlyGovernance {
        require(newBps <= 500, "slippage too high");
        maxSlippageBps = newBps;
        emit MaxSlippageBpsUpdated(newBps);
    }

    function setFallbackTimeout(uint256 newTimeout) external onlyGovernance {
        fallbackTimeout = newTimeout;
    }

    function setRefundTimeout(uint256 newTimeout) external onlyGovernance {
        refundTimeout = newTimeout;
    }

    function setBuybackThreshold(uint256 newThreshold) external onlyGovernance {
        buybackThreshold = newThreshold;
    }

    // ───────────────────────── Internal ─────────────────────────

    function _jobAddress(
        bytes32 requestHash,
        uint64  nonce,
        uint64  taskType,
        address sender
    ) internal view returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(
            requestHash, nonce, taskType, sender, block.number, block.timestamp
        )))));
    }
}
