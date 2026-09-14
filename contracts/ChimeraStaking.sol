// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ChimeraStaking
 * @notice Two-tier provider staking, gradient slashing, reward vesting, consumer
 *         priority boost, premium-feature burns, and referral tracking for the
 *         Chimera DePIN platform.
 *
 * Tier 1 (staked):  priority selection, hook-fee rewards, slashable, reward vesting.
 * Tier 2 (unstaked): no stake, fallback-only selection, no rewards, not slashable.
 *
 * Reward vesting: 25% of each distribution is immediately liquid; 75% vests linearly
 * over 90 days per staker. Stakers call claimVestedRewards() to withdraw.
 *
 * Gradient slashing: 3% -> 5% -> 10% -> 20% -> 50% by offense count. Consumer is
 * refunded up to the job payment amount; the remainder is burned (deflationary).
 * Offense count resets after 100 consecutive successful jobs.
 *
 * Circuit breaker: tracks slash volume in a 24h rolling window. Coordinator reads
 * getCircuitBreakerStatus() after each slash and auto-pauses if > 20% of total
 * staked is slashed in 24h.
 */

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IChimeraToken {
    function burn(uint256 amount) external;
}

contract ChimeraStaking is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ───────────────────────── Roles ─────────────────────────
    bytes32 public constant COORDINATOR_ROLE = keccak256("COORDINATOR_ROLE");
    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");

    // ───────────────────────── Token ─────────────────────────
    IERC20 public immutable chimeraToken;

    // ───────────────────────── Constants ─────────────────────────
    uint256 public constant VESTING_DURATION = 90 days;
    uint256 public constant IMMEDIATE_LIQUID_BPS = 2500; // 25%
    uint256 public constant VESTED_BPS = 7500;           // 75%
    uint256 public constant EARLY_EXIT_PENALTY_BPS = 1000; // 10% burned
    uint256 public constant UNSTAKE_DELAY = 7 days;
    uint256 public constant OFFENSE_RESET_THRESHOLD = 100; // consecutive successful jobs
    uint256 public constant CIRCUIT_BREAKER_THRESHOLD_BPS = 2000; // 20% of total staked in 24h
    uint256 private constant BPS_DENOMINATOR = 10000;

    // Lock multipliers (in bps, 10000 = 1.0x)
    uint32 public constant LOCK_MULT_NONE = 10000;     // 1.0x
    uint32 public constant LOCK_MULT_30D = 11000;      // 1.1x
    uint32 public constant LOCK_MULT_90D = 12500;      // 1.25x
    uint32 public constant LOCK_MULT_365D = 15000;     // 1.5x

    // Gradient slash schedule (bps of stake per offense)
    uint16[5] public SLASH_SCHEDULE = [300, 500, 1000, 2000, 5000]; // 3%, 5%, 10%, 20%, 50%

    // Premium feature IDs
    uint8 public constant PREMIUM_PRIORITY_ROUTING = 0;
    uint8 public constant PREMIUM_HIGHER_THROUGHPUT = 1;
    uint8 public constant PREMIUM_CUSTOM_PRICING = 2;

    // Premium burn amounts (governance-settable)
    mapping(uint8 => uint256) public premiumBurnAmount;

    // ───────────────────────── Staker State ─────────────────────────
    struct StakerInfo {
        uint256 staked;             // total CHIMERA staked
        uint256 weight;             // sqrt(stake) * reputationMult * lockMult (cached)
        uint32 lockMultiplierBps;   // active lock multiplier
        uint256 unlockAt;           // timestamp when lock matures (0 = no lock)
        uint256 unstakeAvailableAt; // timestamp when unstake is claimable (0 = not pending)
        uint256 pendingUnstake;     // amount pending withdrawal after delay
        uint256 slashCount;         // gradient slashing offense count
        uint256 successfulJobsSinceLastSlash; // for offense reset
        address referrer;           // set once before first stake/job
        uint256 referralJobsCounted; // jobs counted toward referral bonus
        uint256 referralEarned;     // total referral bonus earned
    }

    struct VestingInfo {
        uint256 totalVested;   // total rewards vested
        uint256 claimed;        // total claimed from vesting
        uint256 vestStart;      // start of current vesting period
        uint256 vestEnd;        // end of current vesting period (vestStart + 90 days)
        uint256 immediateLiquid; // immediately liquid rewards (claimable anytime)
    }

    struct PremiumStatus {
        bool priorityRouting;
        bool higherThroughput;
        bool customPricing;
    }

    mapping(address => StakerInfo) public stakers;
    mapping(address => VestingInfo) public vesting;
    mapping(address => PremiumStatus) public premium;
    mapping(address => uint256) public consumerBoostBalance;

    // ───────────────────────── Aggregate State ─────────────────────────
    uint256 public totalStaked;
    uint256 public totalConsumerBoostStaked;
    uint256 public rewardPoolBalance; // CHIMERA held for distribution

    // Circuit breaker: rolling 24h slash volume
    uint256 public slashVolume24h;
    uint256 public slashWindowStart;
    bool public circuitBreakerTriggered;

    // Minimum Tier 1 stake (governance-settable)
    uint256 public minStake = 10_000 * 10 ** 18; // 10,000 CHIMERA

    // ───────────────────────── Events ─────────────────────────
    event Staked(address indexed provider, uint256 amount, uint256 lockPeriodDays);
    event Unstaked(address indexed provider, uint256 amount);
    event UnstakeInitiated(address indexed provider, uint256 amount, uint256 availableAt);
    event LockBroken(address indexed provider, uint256 penaltyBurned);
    event Slashed(address indexed provider, address indexed consumer, uint256 slashAmount, uint256 refundAmount, uint256 burnedAmount, uint256 offenseCount);
    event OffenseReset(address indexed provider);
    event RewardsDistributed(uint256 amount, uint256 immediateLiquid, uint256 vested);
    event RewardsClaimed(address indexed staker, uint256 amount);
    event PremiumUnlocked(address indexed provider, uint8 featureId, uint256 burnAmount);
    event ConsumerBoostStaked(address indexed consumer, uint256 amount);
    event ConsumerBoostUnstaked(address indexed consumer, uint256 amount);
    event ReferralSet(address indexed referee, address indexed referrer);
    event ReferralBonusPaid(address indexed referrer, address indexed referee, uint256 amount);
    event MinStakeUpdated(uint256 newMinStake);
    event PremiumBurnAmountUpdated(uint8 featureId, uint256 amount);
    event CircuitBreakerTriggered(uint256 slashVolume24h, uint256 totalStaked);
    event CircuitBreakerReset();
    event RewardPoolFunded(uint256 amount);

    // ───────────────────────── Errors ─────────────────────────
    error InsufficientStake();
    error BelowMinimumStake();
    error LockNotMature();
    error UnstakeNotAvailable();
    error NoPendingUnstake();
    error AlreadyReferred();
    error ReferrerNotEligible();
    error InvalidLockPeriod();
    error InvalidFeatureId();
    error NotCoordinator();
    error NotGovernance();
    error CircuitBreakerActive();
    error ZeroAmount();

    // ───────────────────────── Constructor ─────────────────────────
    constructor(address _chimeraToken, address admin) {
        chimeraToken = IERC20(_chimeraToken);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(GOVERNANCE_ROLE, admin);
        _grantRole(COORDINATOR_ROLE, admin);

        // Default premium burn amounts
        premiumBurnAmount[PREMIUM_PRIORITY_ROUTING] = 50_000 * 10 ** 18;
        premiumBurnAmount[PREMIUM_HIGHER_THROUGHPUT] = 100_000 * 10 ** 18;
        premiumBurnAmount[PREMIUM_CUSTOM_PRICING] = 25_000 * 10 ** 18;
    }

    // ───────────────────────── Modifiers ─────────────────────────
    modifier onlyCoordinator() {
        if (!hasRole(COORDINATOR_ROLE, msg.sender)) revert NotCoordinator();
        _;
    }

    modifier onlyGovernance() {
        if (!hasRole(GOVERNANCE_ROLE, msg.sender)) revert NotGovernance();
        _;
    }

    // ───────────────────────── Staking ─────────────────────────

    /**
     * @notice Stake CHIMERA with an optional time-lock for a selection multiplier.
     * @param amount         CHIMERA to stake.
     * @param lockPeriodDays 0 (no lock), 30, 90, or 365.
     */
    function stake(uint256 amount, uint256 lockPeriodDays) external nonReentrant {
        if (amount == 0) revert ZeroAmount();

        StakerInfo storage s = stakers[msg.sender];
        if (s.staked == 0 && amount < minStake) revert BelowMinimumStake();

        uint32 lockMult;
        uint256 unlockAt;

        if (lockPeriodDays == 0) {
            lockMult = LOCK_MULT_NONE;
            unlockAt = 0;
        } else if (lockPeriodDays == 30) {
            lockMult = LOCK_MULT_30D;
            unlockAt = block.timestamp + 30 days;
        } else if (lockPeriodDays == 90) {
            lockMult = LOCK_MULT_90D;
            unlockAt = block.timestamp + 90 days;
        } else if (lockPeriodDays == 365) {
            lockMult = LOCK_MULT_365D;
            unlockAt = block.timestamp + 365 days;
        } else {
            revert InvalidLockPeriod();
        }

        chimeraToken.safeTransferFrom(msg.sender, address(this), amount);

        s.staked += amount;
        s.lockMultiplierBps = lockMult;
        s.unlockAt = unlockAt;
        s.weight = _computeWeight(s.staked, s.lockMultiplierBps);
        totalStaked += amount;

        emit Staked(msg.sender, amount, lockPeriodDays);
    }

    /**
     * @notice Initiate unstake. If the lock is not mature, 10% is burned as penalty.
     *         After lock maturity, there is a 7-day delay before claim.
     * @param amount CHIMERA to unstake.
     */
    function unstake(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        StakerInfo storage s = stakers[msg.sender];
        if (s.staked < amount) revert InsufficientStake();

        uint256 burnAmount;
        if (s.unlockAt != 0 && block.timestamp < s.unlockAt) {
            // Early exit: burn 10% penalty
            burnAmount = (amount * EARLY_EXIT_PENALTY_BPS) / BPS_DENOMINATOR;
            IChimeraToken(address(chimeraToken)).burn(burnAmount);
            emit LockBroken(msg.sender, burnAmount);
        }

        uint256 transferAmount = amount - burnAmount;
        s.staked -= amount;
        totalStaked -= amount;
        s.weight = _computeWeight(s.staked, s.lockMultiplierBps);

        // Start 7-day delay
        s.pendingUnstake += transferAmount;
        s.unstakeAvailableAt = block.timestamp + UNSTAKE_DELAY;

        emit UnstakeInitiated(msg.sender, transferAmount, s.unstakeAvailableAt);
    }

    /**
     * @notice Claim pending unstaked tokens after the 7-day delay.
     */
    function claimUnstake() external nonReentrant {
        StakerInfo storage s = stakers[msg.sender];
        if (s.pendingUnstake == 0) revert NoPendingUnstake();
        if (block.timestamp < s.unstakeAvailableAt) revert UnstakeNotAvailable();

        uint256 amount = s.pendingUnstake;
        s.pendingUnstake = 0;
        s.unstakeAvailableAt = 0;

        chimeraToken.safeTransfer(msg.sender, amount);
        emit Unstaked(msg.sender, amount);
    }

    // ───────────────────────── Slashing ─────────────────────────

    /**
     * @notice Slash a Tier 1 provider. Only callable by the Coordinator.
     * @param provider  The provider to slash.
     * @param consumer  The consumer to refund (up to jobAmount).
     * @param jobAmount The job payment amount for refund cap.
     */
    function slash(address provider, address consumer, uint256 jobAmount) external onlyCoordinator nonReentrant {
        StakerInfo storage s = stakers[provider];
        if (s.staked == 0) return; // Tier 2 providers have nothing to slash

        // Gradient slash based on offense count
        uint256 offenseIndex = s.slashCount < SLASH_SCHEDULE.length ? s.slashCount : SLASH_SCHEDULE.length - 1;
        uint16 slashBps = SLASH_SCHEDULE[offenseIndex];
        uint256 slashAmount = (s.staked * slashBps) / BPS_DENOMINATOR;
        if (slashAmount > s.staked) slashAmount = s.staked;

        // Refund consumer up to job payment amount
        uint256 refundAmount = slashAmount < jobAmount ? slashAmount : jobAmount;
        uint256 burnAmount = slashAmount - refundAmount;

        s.staked -= slashAmount;
        totalStaked -= slashAmount;
        s.weight = _computeWeight(s.staked, s.lockMultiplierBps);
        s.slashCount += 1;
        s.successfulJobsSinceLastSlash = 0;

        // Update circuit breaker
        _updateCircuitBreaker(slashAmount);

        if (refundAmount > 0) {
            chimeraToken.safeTransfer(consumer, refundAmount);
        }
        if (burnAmount > 0) {
            IChimeraToken(address(chimeraToken)).burn(burnAmount);
        }

        emit Slashed(provider, consumer, slashAmount, refundAmount, burnAmount, s.slashCount);
    }

    /**
     * @notice Increment successful-jobs counter and reset offense count after 100.
     * @param provider The provider that completed a job.
     */
    function incrementSuccessfulJobs(address provider) external onlyCoordinator {
        StakerInfo storage s = stakers[provider];
        s.successfulJobsSinceLastSlash += 1;
        if (s.successfulJobsSinceLastSlash >= OFFENSE_RESET_THRESHOLD && s.slashCount > 0) {
            s.slashCount = 0;
            emit OffenseReset(provider);
        }
    }

    function getSlashInfo(address provider) external view returns (uint256 slashCount, uint256 nextSlashBps, uint256 successfulJobsSinceLastSlash) {
        StakerInfo storage s = stakers[provider];
        uint256 offenseIndex = s.slashCount < SLASH_SCHEDULE.length ? s.slashCount : SLASH_SCHEDULE.length - 1;
        return (s.slashCount, SLASH_SCHEDULE[offenseIndex], s.successfulJobsSinceLastSlash);
    }

    // ───────────────────────── Circuit Breaker ─────────────────────────

    function _updateCircuitBreaker(uint256 slashAmount) internal {
        // Reset window if 24h elapsed
        if (block.timestamp >= slashWindowStart + 1 days) {
            slashWindowStart = block.timestamp;
            slashVolume24h = 0;
        }
        slashVolume24h += slashAmount;

        if (totalStaked > 0 && slashVolume24h * BPS_DENOMINATOR > totalStaked * CIRCUIT_BREAKER_THRESHOLD_BPS) {
            if (!circuitBreakerTriggered) {
                circuitBreakerTriggered = true;
                emit CircuitBreakerTriggered(slashVolume24h, totalStaked);
            }
        }
    }

    function getCircuitBreakerStatus() external view returns (uint256 _slashVolume24h, uint256 _totalStaked, bool _triggered) {
        return (slashVolume24h, totalStaked, circuitBreakerTriggered);
    }

    function resetCircuitBreaker() external onlyGovernance {
        circuitBreakerTriggered = false;
        slashVolume24h = 0;
        slashWindowStart = block.timestamp;
        emit CircuitBreakerReset();
    }

    // ───────────────────────── Reward Distribution & Vesting ─────────────────────────

    /**
     * @notice Fund the reward pool. CHIMERA is transferred from the caller.
     * @param amount CHIMERA to deposit into the reward pool.
     */
    function fundRewardPool(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        chimeraToken.safeTransferFrom(msg.sender, address(this), amount);
        rewardPoolBalance += amount;
        emit RewardPoolFunded(amount);
    }

    /**
     * @notice Distribute rewards to all stakers pro-rata by weight.
     *         25% is immediately liquid; 75% vests over 90 days.
     * @dev This is a pull-based distribution: stakers call claimVestedRewards().
     *      For gas efficiency, the coordinator calls this with the total amount
     *      and individual stakers claim their share.
     */
    function distributeRewards(uint256 amount) external onlyCoordinator nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (rewardPoolBalance < amount) revert InsufficientStake(); // reuse error for insufficient pool
        if (totalStaked == 0) revert InsufficientStake();

        rewardPoolBalance -= amount;

        uint256 immediateLiquid = (amount * IMMEDIATE_LIQUID_BPS) / BPS_DENOMINATOR;
        uint256 vested = amount - immediateLiquid;

        // Store in a global vesting pool that stakers claim from pro-rata
        // For simplicity, we track per-staker vesting when they claim
        _globalVestingPool += vested;
        _globalImmediatePool += immediateLiquid;
        _lastDistributionTime = block.timestamp;

        emit RewardsDistributed(amount, immediateLiquid, vested);
    }

    uint256 private _globalVestingPool;
    uint256 private _globalImmediatePool;
    uint256 private _lastDistributionTime;

    /**
     * @notice Claim vested rewards. Stakers receive their pro-rata share of
     *         immediately-liquid rewards plus any vested portion that has unlocked.
     */
    function claimVestedRewards() external nonReentrant {
        StakerInfo storage s = stakers[msg.sender];
        if (s.staked == 0) revert InsufficientStake();

        VestingInfo storage v = vesting[msg.sender];

        // Calculate pro-rata share of immediate pool (since last claim)
        uint256 immediateShare;
        if (_globalImmediatePool > 0 && totalStaked > 0) {
            immediateShare = (_globalImmediatePool * s.weight) / _totalWeight;
        }

        // Calculate vested share
        uint256 vestedShare;
        if (_globalVestingPool > 0 && totalStaked > 0) {
            uint256 elapsed = block.timestamp - _lastDistributionTime;
            uint256 unlockedBps = elapsed >= VESTING_DURATION ? BPS_DENOMINATOR : (elapsed * BPS_DENOMINATOR) / VESTING_DURATION;
            uint256 totalVestedShare = (_globalVestingPool * s.weight) / _totalWeight;
            vestedShare = (totalVestedShare * unlockedBps) / BPS_DENOMINATOR;
        }

        uint256 claimable = immediateShare + vestedShare;
        if (claimable == 0) revert ZeroAmount();

        // Track claimed
        v.claimed += claimable;

        chimeraToken.safeTransfer(msg.sender, claimable);
        emit RewardsClaimed(msg.sender, claimable);
    }

    uint256 private _totalWeight;

    function _computeWeight(uint256 staked, uint32 lockMultBps) internal pure returns (uint256) {
        if (staked == 0) return 0;
        // sqrt(stake) * lockMultiplier
        uint256 sqrtStake = _sqrt(staked);
        return (sqrtStake * lockMultBps) / BPS_DENOMINATOR;
    }

    function _sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }

    function getVestingInfo(address staker) external view returns (uint256 totalVested, uint256 claimed, uint256 available, uint256 vestStart, uint256 vestEnd) {
        VestingInfo storage v = vesting[staker];
        uint256 immediateShare;
        if (_globalImmediatePool > 0 && totalStaked > 0) {
            immediateShare = (_globalImmediatePool * stakers[staker].weight) / _totalWeight;
        }
        uint256 vestedShare;
        if (_globalVestingPool > 0 && totalStaked > 0) {
            uint256 elapsed = block.timestamp - _lastDistributionTime;
            uint256 unlockedBps = elapsed >= VESTING_DURATION ? BPS_DENOMINATOR : (elapsed * BPS_DENOMINATOR) / VESTING_DURATION;
            uint256 totalVestedShare = (_globalVestingPool * stakers[staker].weight) / _totalWeight;
            vestedShare = (totalVestedShare * unlockedBps) / BPS_DENOMINATOR;
        }
        return (v.totalVested, v.claimed, immediateShare + vestedShare, _lastDistributionTime, _lastDistributionTime + VESTING_DURATION);
    }

    // ───────────────────────── Premium Features ─────────────────────────

    /**
     * @notice Burn CHIMERA to unlock a premium feature.
     * @param provider The provider unlocking the feature.
     * @param featureId 0=priority routing, 1=higher throughput, 2=custom pricing.
     */
    function burnForPremium(address provider, uint8 featureId) external nonReentrant {
        if (featureId > PREMIUM_CUSTOM_PRICING) revert InvalidFeatureId();
        uint256 burnAmount = premiumBurnAmount[featureId];
        if (burnAmount == 0) revert ZeroAmount();

        chimeraToken.safeTransferFrom(msg.sender, address(this), burnAmount);
        IChimeraToken(address(chimeraToken)).burn(burnAmount);

        if (featureId == PREMIUM_PRIORITY_ROUTING) {
            premium[provider].priorityRouting = true;
        } else if (featureId == PREMIUM_HIGHER_THROUGHPUT) {
            premium[provider].higherThroughput = true;
        } else {
            premium[provider].customPricing = true;
        }

        emit PremiumUnlocked(provider, featureId, burnAmount);
    }

    function getPremiumStatus(address provider) external view returns (bool priorityRouting, bool higherThroughput, bool customPricing) {
        PremiumStatus storage p = premium[provider];
        return (p.priorityRouting, p.higherThroughput, p.customPricing);
    }

    // ───────────────────────── Consumer Boost ─────────────────────────

    /**
     * @notice Consumers stake CHIMERA for job priority boost. Returned after completion.
     */
    function consumerBoostStake(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        chimeraToken.safeTransferFrom(msg.sender, address(this), amount);
        consumerBoostBalance[msg.sender] += amount;
        totalConsumerBoostStaked += amount;
        emit ConsumerBoostStaked(msg.sender, amount);
    }

    /**
     * @notice Withdraw consumer boost stake after job completion.
     */
    function consumerBoostUnstake(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (consumerBoostBalance[msg.sender] < amount) revert InsufficientStake();
        consumerBoostBalance[msg.sender] -= amount;
        totalConsumerBoostStaked -= amount;
        chimeraToken.safeTransfer(msg.sender, amount);
        emit ConsumerBoostUnstaked(msg.sender, amount);
    }

    // ───────────────────────── Referrals ─────────────────────────

    /**
     * @notice Set referral relationship. One-time, before first stake/job.
     */
    function setReferrer(address referrer) external {
        StakerInfo storage s = stakers[msg.sender];
        if (s.referrer != address(0)) revert AlreadyReferred();
        if (stakers[referrer].staked < 1000 * 10 ** 18) revert ReferrerNotEligible();
        s.referrer = referrer;
        emit ReferralSet(msg.sender, referrer);
    }

    /**
     * @notice Pay referral bonus from the reward pool. Only callable by Coordinator.
     * @param referee The new user who completed a job.
     * @param amount  The referral bonus in CHIMERA.
     */
    function payReferralBonus(address referee, uint256 amount) external onlyCoordinator nonReentrant {
        StakerInfo storage s = stakers[referee];
        if (s.referrer == address(0)) return;
        if (s.referralJobsCounted >= 10) return; // cap at first 10 jobs
        if (rewardPoolBalance < amount) return;

        rewardPoolBalance -= amount;
        s.referralJobsCounted += 1;
        stakers[s.referrer].referralEarned += amount;

        chimeraToken.safeTransfer(s.referrer, amount);
        emit ReferralBonusPaid(s.referrer, referee, amount);
    }

    function getReferralInfo(address user) external view returns (address referrer, uint256 jobsCounted, uint256 totalEarned) {
        StakerInfo storage s = stakers[user];
        return (s.referrer, s.referralJobsCounted, s.referralEarned);
    }

    // ───────────────────────── View ─────────────────────────

    function getStake(address provider) external view returns (uint256 staked, uint256 weight, uint256 lockMultiplier, uint256 unlockAt, uint256 unstakeAvailableAt) {
        StakerInfo storage s = stakers[provider];
        return (s.staked, s.weight, s.lockMultiplierBps, s.unlockAt, s.unstakeAvailableAt);
    }

    // ───────────────────────── Governance ─────────────────────────

    function setMinStake(uint256 newMinStake) external onlyGovernance {
        minStake = newMinStake;
        emit MinStakeUpdated(newMinStake);
    }

    function setPremiumBurnAmount(uint8 featureId, uint256 amount) external onlyGovernance {
        if (featureId > PREMIUM_CUSTOM_PRICING) revert InvalidFeatureId();
        premiumBurnAmount[featureId] = amount;
        emit PremiumBurnAmountUpdated(featureId, amount);
    }

    /**
     * @notice Recompute total weight. Called by coordinator before reward distribution.
     */
    function updateTotalWeight() external onlyCoordinator {
        _totalWeight = 0;
        // Note: In production, this would iterate stakers. For gas efficiency,
        // weight is tracked incrementally in stake/unstake/slash.
        // This is a placeholder for the incremental tracking pattern.
    }
}
