// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/IReputation.sol";
import "./interfaces/IComputeRegistry.sol";
import "./libraries/Utils.sol";

/// @title Reputation
/// @notice Reputation scoring with job tracking, ratings anchoring, and slashing
/// @dev Implements the Reputation Ledger from the decentralized compute marketplace architecture
contract Reputation is IReputation, Ownable {
    using MathLib for uint256;
    using ValidationLib for uint256;
    using ValidationLib for address;
    using BytesLib for bytes32;

    // State
    mapping(address => ReputationEntry) public providerReputations;
    mapping(address => ConsumerReputation) public consumerReputations;
    
    // For ranking - simple counter of providers with score > X
    mapping(uint256 => uint256) public scoreDistribution; // score => count
    
    address public immutable computeRegistry;
    address public escrowVault;

    // Constants for reputation scoring
    uint256 public constant JOBS_COMPLETED_WEIGHT = 10;
    uint256 public constant JOBS_DISPUTED_PENALTY = 50;
    uint256 public constant JOBS_SLASHED_PENALTY = 500;
    uint256 public constant EARNED_WEIGHT = 1; // 0.1 * (totalEarned / 1e18)
    uint256 public constant RATING_WEIGHT = 100;

    constructor(address _owner, address _computeRegistry, address _escrowVault) Ownable(_owner) {
        computeRegistry = _computeRegistry;
        escrowVault = _escrowVault;
    }

    modifier onlyAuthorized() {
        // Only escrow vault and compute registry can call these
        // In practice, this would be a role-based access control
        require(msg.sender == computeRegistry || msg.sender == owner() || msg.sender == escrowVault, "Reputation: not authorized");
        _;
    }

    // Allow owner to add authorized callers for flexibility
    mapping(address => bool) public authorizedCallers;

    function addAuthorizedCaller(address caller) external onlyOwner {
        authorizedCallers[caller] = true;
    }

    function removeAuthorizedCaller(address caller) external onlyOwner {
        authorizedCallers[caller] = false;
    }

    function setEscrowVault(address newEscrowVault) external onlyOwner {
        escrowVault = newEscrowVault;
    }

    // Updated modifier to use the mapping
    modifier onlyAuthorizedAny() {
        require(msg.sender == computeRegistry || msg.sender == owner() || msg.sender == escrowVault || authorizedCallers[msg.sender], "Reputation: not authorized");
        _;
    }

    function recordJobCompleted(address providerAuthority, uint256 amount) external override onlyAuthorizedAny {
        providerAuthority.validateAddress();
        amount.validateQuantity();
        
        // Capture old score before update
        uint256 oldScore = _calculateScoreInternal(providerReputations[providerAuthority]);
        
        ReputationEntry storage rep = providerReputations[providerAuthority];
        rep.providerAuthority = providerAuthority;
        rep.jobsCompleted += 1;
        rep.totalEarned += amount;
        rep.lastUpdate = block.timestamp;
        
        // Update score distribution
        _updateScoreDistribution(providerAuthority, oldScore);
    }

    function recordJobDisputed(address providerAuthority) external override onlyAuthorized {
        providerAuthority.validateAddress();
        
        // Capture old score before update
        uint256 oldScore = _calculateScoreInternal(providerReputations[providerAuthority]);
        
        ReputationEntry storage rep = providerReputations[providerAuthority];
        rep.providerAuthority = providerAuthority;
        rep.jobsDisputed += 1;
        rep.lastUpdate = block.timestamp;
        
        _updateScoreDistribution(providerAuthority, oldScore);
    }
    
    function recordJobSlashed(address providerAuthority) external override onlyAuthorized {
        providerAuthority.validateAddress();
        
        // Capture old score before update
        uint256 oldScore = _calculateScoreInternal(providerReputations[providerAuthority]);
        
        ReputationEntry storage rep = providerReputations[providerAuthority];
        rep.providerAuthority = providerAuthority;
        rep.jobsSlashed += 1;
        rep.lastUpdate = block.timestamp;
        
        _updateScoreDistribution(providerAuthority, oldScore);
    }

    function anchorRatings(address providerAuthority, bytes32 ratingsCID) external override onlyAuthorizedAny {
        providerAuthority.validateAddress();
        require(!ratingsCID.isZero(), "Reputation: invalid CID");
        
        ReputationEntry storage rep = providerReputations[providerAuthority];
        rep.providerAuthority = providerAuthority;
        rep.ratingsCID = ratingsCID;
        rep.lastUpdate = block.timestamp;

        emit RatingsAnchored(providerAuthority, ratingsCID);
    }

    function recordConsumerJobCreated(address consumer, uint256 amount) external override onlyAuthorizedAny {
        consumer.validateAddress();
        amount.validateQuantity();
        
        ConsumerReputation storage rep = consumerReputations[consumer];
        rep.consumer = consumer;
        rep.jobsCreated += 1;
        rep.totalSpent += amount;
    }

    function recordConsumerDisputeRaised(address consumer) external override onlyAuthorizedAny {
        consumer.validateAddress();
        
        ConsumerReputation storage rep = consumerReputations[consumer];
        rep.consumer = consumer;
        rep.disputesRaised += 1;
    }

    function recordConsumerDisputeWon(address consumer) external override onlyAuthorizedAny {
        consumer.validateAddress();
        
        ConsumerReputation storage rep = consumerReputations[consumer];
        rep.consumer = consumer;
        rep.disputesWon += 1;
    }

    function _updateScoreDistribution(address providerAuthority, uint256 oldScore) internal {
        if (oldScore > 0) {
            require(scoreDistribution[oldScore] > 0, "Reputation: distribution underflow");
            scoreDistribution[oldScore] -= 1;
        }
        
        ReputationEntry storage newRep = providerReputations[providerAuthority];
        uint256 newScore = _calculateScoreInternal(newRep);
        if (newScore > 0) {
            scoreDistribution[newScore] += 1;
        }
    }

    function _calculateScoreInternal(ReputationEntry storage rep) internal view returns (uint256) {
        if (rep.providerAuthority == address(0)) return 0;
        
        uint256 score = 0;
        score += rep.jobsCompleted * JOBS_COMPLETED_WEIGHT;
        if (rep.jobsDisputed > 0) {
            score = score >= rep.jobsDisputed * JOBS_DISPUTED_PENALTY 
                ? score - rep.jobsDisputed * JOBS_DISPUTED_PENALTY 
                : 0;
        }
        if (rep.jobsSlashed > 0) {
            score = score >= rep.jobsSlashed * JOBS_SLASHED_PENALTY 
                ? score - rep.jobsSlashed * JOBS_SLASHED_PENALTY 
                : 0;
        }
        score += (rep.totalEarned / 1e18) * EARNED_WEIGHT;
        // Note: Rating calculation would require off-chain data, skipped for on-chain
        
        return score;
    }

    function calculateReputationScore(address providerAuthority) external view override returns (uint256 score) {
        ReputationEntry storage rep = providerReputations[providerAuthority];
        return _calculateScoreInternal(rep);
    }

    function getProviderReputation(address providerAuthority) external view override returns (ReputationEntry memory) {
        return providerReputations[providerAuthority];
    }

    function getConsumerReputation(address consumer) external view override returns (ConsumerReputation memory) {
        return consumerReputations[consumer];
    }

    function getProviderReputationRank(address providerAuthority) external view override returns (uint256 rank) {
        ReputationEntry storage rep = providerReputations[providerAuthority];
        uint256 score = _calculateScoreInternal(rep);
        if (score == 0) return 0;
        
        // Simple rank: count of providers with higher score
        // In practice, would use a more efficient data structure
        for (uint256 s = score + 1; s < type(uint256).max; s++) {
            if (scoreDistribution[s] > 0) {
                rank += scoreDistribution[s];
            }
            // Limit iterations to prevent gas issues
            if (s > score + 10000) break;
        }
        return rank + 1; // 1-indexed
    }

    // Admin functions
    function resetProviderReputation(address providerAuthority) external onlyOwner {
        ReputationEntry storage rep = providerReputations[providerAuthority];
        uint256 oldScore = _calculateScoreInternal(rep);
        if (oldScore > 0) {
            require(scoreDistribution[oldScore] > 0, "Reputation: distribution underflow");
            scoreDistribution[oldScore] -= 1;
        }
        delete providerReputations[providerAuthority];
    }

    function setWeights(
        uint256 _jobsCompletedWeight,
        uint256 _jobsDisputedPenalty,
        uint256 _jobsSlashedPenalty,
        uint256 _earnedWeight,
        uint256 _ratingWeight
    ) external onlyOwner {
        // Note: These are constants in the current implementation
        // Would need to be state variables for runtime adjustment
    }
}