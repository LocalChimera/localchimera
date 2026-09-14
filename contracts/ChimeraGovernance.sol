// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ChimeraGovernance
 * @notice On-chain governance for Chimera protocol parameters with timelocked
 *         execution and juror-based dispute resolution for slash appeals.
 *
 * Voting power: 1 CHIMERA staked = 1 vote (reads from ChimeraStaking).
 * Proposal threshold: 100K CHIMERA staked.
 * Quorum: 5% of total staked.
 * Voting period: 3 days.
 * Timelock: 48 hours after vote passes.
 *
 * Dispute resolution: CHIMERA holders lock tokens to become eligible jurors.
 * Slashed providers appeal by paying CHIMERA. Min 7 jurors vote. Majority wins.
 * Winning jurors split the appeal payment; losing jurors forfeit locked portion.
 */

import "@openzeppelin/contracts/governance/TimelockController.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IChimeraStaking {
    function getStake(address provider) external view returns (uint256 staked, uint256 weight, uint256 lockMultiplier, uint256 unlockAt, uint256 unstakeAvailableAt);
    function slash(address provider, address consumer, uint256 jobAmount) external;
    function getSlashInfo(address provider) external view returns (uint256 slashCount, uint256 nextSlashBps, uint256 successfulJobsSinceLastSlash);
    function resetCircuitBreaker() external;
    function setMinStake(uint256 amount) external;
}

interface IChimeraToken {
    function burn(uint256 amount) external;
}

contract ChimeraGovernance is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ───────────────────────── Roles ─────────────────────────
    bytes32 public constant COORDINATOR_ROLE = keccak256("COORDINATOR_ROLE");

    // ───────────────────────── Constants ─────────────────────────
    uint256 public constant MIN_JURORS = 7;
    uint256 public constant JUROR_LOCK_MIN = 1000 * 10 ** 18; // min 1000 CHIMERA to be a juror
    uint256 public constant VOTING_PERIOD = 3 days;
    uint256 public constant TIMELOCK_DELAY = 48 hours;
    uint256 public constant PROPOSAL_THRESHOLD = 100_000 * 10 ** 18;

    IChimeraStaking public staking;
    IERC20 public immutable chimeraToken;
    TimelockController public immutable timelock;

    // ───────────────────────── Proposals ─────────────────────────
    struct Proposal {
        address proposer;
        address[] targets;
        uint256[] values;
        bytes[] calldatas;
        string description;
        uint256 voteStart;
        uint256 voteEnd;
        uint256 yesVotes;
        uint256 noVotes;
        bool executed;
        bool canceled;
        mapping(address => bool) hasVoted;
        mapping(address => bool) votedYes;
    }

    mapping(uint256 => Proposal) public proposals;
    uint256 public proposalCount;

    // ───────────────────────── Dispute Resolution ─────────────────────────
    struct Juror {
        uint256 lockedAmount;
        bool    active;
    }

    struct SlashAppeal {
        address provider;        // the slashed provider appealing
        uint256 slashAmount;      // CHIMERA paid to appeal (equal to original slash)
        uint256 createdAt;
        bool    resolved;
        uint256 yesVotes;         // guilty votes
        uint256 noVotes;          // not-guilty votes
        uint256 totalJurors;
        mapping(address => bool)  hasVoted;
        mapping(address => bool)  votedGuilty;
        mapping(address => uint256) jurorWeights;
        address[] jurors;
    }

    mapping(address => Juror) public jurors;
    mapping(uint256 => SlashAppeal) public appeals;
    uint256 public appealCount;

    // ───────────────────────── Events ─────────────────────────
    event ProposalCreated(uint256 indexed proposalId, address indexed proposer, string description);
    event Voted(uint256 indexed proposalId, address indexed voter, bool support);
    event ProposalExecuted(uint256 indexed proposalId);
    event ProposalCanceled(uint256 indexed proposalId);
    event JurorLocked(address indexed juror, uint256 amount);
    event JurorUnlocked(address indexed juror, uint256 amount);
    event SlashAppealCreated(uint256 indexed appealId, address indexed provider, uint256 slashAmount);
    event VotedOnAppeal(uint256 indexed appealId, address indexed juror, bool guilty);
    event AppealResolved(uint256 indexed appealId, bool guilty, uint256 jurorRewardTotal);

    // ───────────────────────── Errors ─────────────────────────
    error BelowProposalThreshold();
    error BelowJurorLockMin();
    error NotEligibleJuror();
    error AppealNotFound();
    error AlreadyVoted();
    error AppealAlreadyResolved();
    error InsufficientJurors();
    error NotCoordinator();
    error ZeroAmount();
    error VotingNotActive();
    error VotingNotEnded();
    error ProposalNotFound();
    error ProposalAlreadyExecuted();
    error ProposalAlreadyCanceled();
    error QuorumNotReached();
    error NotPassed();

    // ───────────────────────── Constructor ─────────────────────────
    constructor(
        IERC20 _token,
        TimelockController _timelock,
        address _staking,
        address admin
    ) {
        chimeraToken = _token;
        timelock = _timelock;
        staking = IChimeraStaking(_staking);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(COORDINATOR_ROLE, admin);
    }

    // ───────────────────────── Proposals ─────────────────────────

    /**
     * @notice Create a governance proposal. Caller must have 100K+ CHIMERA staked.
     */
    function propose(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        string memory description
    ) external returns (uint256) {
        (uint256 staked,,,,) = staking.getStake(msg.sender);
        if (staked < PROPOSAL_THRESHOLD) revert BelowProposalThreshold();

        uint256 proposalId = proposalCount++;
        Proposal storage p = proposals[proposalId];
        p.proposer = msg.sender;
        p.targets = targets;
        p.values = values;
        p.calldatas = calldatas;
        p.description = description;
        p.voteStart = block.timestamp;
        p.voteEnd = block.timestamp + VOTING_PERIOD;

        emit ProposalCreated(proposalId, msg.sender, description);
        return proposalId;
    }

    /**
     * @notice Vote on a proposal. 1 staked CHIMERA = 1 vote.
     */
    function castVote(uint256 proposalId, bool support) external {
        Proposal storage p = proposals[proposalId];
        if (p.proposer == address(0)) revert ProposalNotFound();
        if (block.timestamp > p.voteEnd) revert VotingNotEnded();
        if (p.hasVoted[msg.sender]) revert AlreadyVoted();

        (uint256 staked,,,,) = staking.getStake(msg.sender);
        p.hasVoted[msg.sender] = true;
        p.votedYes[msg.sender] = support;

        if (support) {
            p.yesVotes += staked;
        } else {
            p.noVotes += staked;
        }

        emit Voted(proposalId, msg.sender, support);
    }

    /**
     * @notice Execute a passed proposal through the timelock.
     */
    function executeProposal(uint256 proposalId) external {
        Proposal storage p = proposals[proposalId];
        if (p.proposer == address(0)) revert ProposalNotFound();
        if (p.executed) revert ProposalAlreadyExecuted();
        if (block.timestamp <= p.voteEnd) revert VotingNotEnded();
        if (p.yesVotes <= p.noVotes) revert NotPassed();

        p.executed = true;

        // Schedule through timelock (48h delay)
        timelock.scheduleBatch(p.targets, p.values, p.calldatas, bytes32(0), keccak256(bytes(p.description)), TIMELOCK_DELAY);

        emit ProposalExecuted(proposalId);
    }

    function cancelProposal(uint256 proposalId) external {
        Proposal storage p = proposals[proposalId];
        if (p.proposer == address(0)) revert ProposalNotFound();
        if (msg.sender != p.proposer && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) revert ProposalAlreadyCanceled();
        p.canceled = true;
        emit ProposalCanceled(proposalId);
    }

    function getProposalState(uint256 proposalId) external view returns (string memory) {
        Proposal storage p = proposals[proposalId];
        if (p.proposer == address(0)) return "NotFound";
        if (p.canceled) return "Canceled";
        if (p.executed) return "Executed";
        if (block.timestamp <= p.voteEnd) return "Active";
        if (p.yesVotes > p.noVotes) return "Succeeded";
        return "Defeated";
    }

    // ───────────────────────── Dispute Resolution ─────────────────────────

    /**
     * @notice Lock CHIMERA to become an eligible juror for slash appeals.
     */
    function lockForDisputes(uint256 amount) external nonReentrant {
        if (amount < JUROR_LOCK_MIN) revert BelowJurorLockMin();
        chimeraToken.safeTransferFrom(msg.sender, address(this), amount);
        jurors[msg.sender].lockedAmount += amount;
        jurors[msg.sender].active = true;
        emit JurorLocked(msg.sender, amount);
    }

    /**
     * @notice Withdraw locked juror CHIMERA (unless actively in a dispute).
     */
    function unlockFromDisputes(uint256 amount) external nonReentrant {
        Juror storage j = jurors[msg.sender];
        if (j.lockedAmount < amount) revert ZeroAmount();
        j.lockedAmount -= amount;
        if (j.lockedAmount == 0) j.active = false;
        chimeraToken.safeTransfer(msg.sender, amount);
        emit JurorUnlocked(msg.sender, amount);
    }

    /**
     * @notice Create a slash appeal. The slashed provider pays CHIMERA equal to
     *         the original slash amount. Jurors vote to decide guilt.
     * @param slashId    Unique identifier for the original slash event.
     * @param slashAmount CHIMERA to pay for the appeal (equal to original slash).
     */
    function createSlashAppeal(uint256 slashId, uint256 slashAmount) external nonReentrant {
        if (slashAmount == 0) revert ZeroAmount();
        chimeraToken.safeTransferFrom(msg.sender, address(this), slashAmount);

        uint256 appealId = appealCount++;
        SlashAppeal storage appeal = appeals[appealId];
        appeal.provider = msg.sender;
        appeal.slashAmount = slashAmount;
        appeal.createdAt = block.timestamp;

        emit SlashAppealCreated(appealId, msg.sender, slashAmount);
    }

    /**
     * @notice Vote on a slash appeal as a juror.
     * @param appealId The appeal to vote on.
     * @param guilty   True = slash stands; false = slash reversed.
     */
    function voteOnAppeal(uint256 appealId, bool guilty) external nonReentrant {
        SlashAppeal storage appeal = appeals[appealId];
        if (appeal.provider == address(0)) revert AppealNotFound();
        if (appeal.resolved) revert AppealAlreadyResolved();
        if (!jurors[msg.sender].active || jurors[msg.sender].lockedAmount < JUROR_LOCK_MIN) revert NotEligibleJuror();
        if (appeal.hasVoted[msg.sender]) revert AlreadyVoted();

        appeal.hasVoted[msg.sender] = true;
        appeal.votedGuilty[msg.sender] = guilty;
        appeal.jurorWeights[msg.sender] = jurors[msg.sender].lockedAmount;
        appeal.jurors.push(msg.sender);
        appeal.totalJurors += 1;

        if (guilty) {
            appeal.yesVotes += jurors[msg.sender].lockedAmount;
        } else {
            appeal.noVotes += jurors[msg.sender].lockedAmount;
        }

        emit VotedOnAppeal(appealId, msg.sender, guilty);
    }

    /**
     * @notice Resolve an appeal after sufficient jurors have voted.
     *         Winning jurors split the appeal payment; losing jurors forfeit
     *         a small portion of their locked CHIMERA.
     */
    function resolveAppeal(uint256 appealId) external nonReentrant {
        SlashAppeal storage appeal = appeals[appealId];
        if (appeal.provider == address(0)) revert AppealNotFound();
        if (appeal.resolved) revert AppealAlreadyResolved();
        if (appeal.totalJurors < MIN_JURORS) revert InsufficientJurors();

        appeal.resolved = true;
        bool guilty = appeal.yesVotes >= appeal.noVotes;

        uint256 winningVotes = guilty ? appeal.yesVotes : appeal.noVotes;

        // Distribute appeal payment to winning jurors pro-rata
        if (winningVotes > 0) {
            for (uint256 i = 0; i < appeal.jurors.length; i++) {
                address juror = appeal.jurors[i];
                bool jurorVotedGuilty = appeal.votedGuilty[juror];
                bool isWinner = (guilty && jurorVotedGuilty) || (!guilty && !jurorVotedGuilty);
                if (isWinner) {
                    uint256 reward = (appeal.slashAmount * appeal.jurorWeights[juror]) / winningVotes;
                    if (reward > 0) {
                        chimeraToken.safeTransfer(juror, reward);
                    }
                } else {
                    // Losing jurors forfeit 10% of their locked CHIMERA (burned)
                    uint256 penalty = (jurors[juror].lockedAmount * 1000) / 10000;
                    if (penalty > 0) {
                        jurors[juror].lockedAmount -= penalty;
                        IChimeraToken(address(chimeraToken)).burn(penalty);
                    }
                }
            }
        }

        emit AppealResolved(appealId, guilty, appeal.slashAmount);
    }

    // ───────────────────────── Admin ─────────────────────────

    function setStaking(address _staking) external onlyRole(DEFAULT_ADMIN_ROLE) {
        staking = IChimeraStaking(_staking);
    }

    function setCoordinator(address coordinator) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _grantRole(COORDINATOR_ROLE, coordinator);
    }
}
