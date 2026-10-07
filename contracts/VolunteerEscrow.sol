// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * VolunteerEscrow — minimal job escrow for the Chimera volunteer network on Base.
 *
 * Design:
 *   - Consumers escrow native ETH per job.
 *   - The COORDINATOR_ROLE key (Cloudflare worker) marks jobs complete and
 *     attributes them to an off-chain volunteer id — it can never redirect
 *     funds: escrowed value always releases to `settlementAddress`.
 *   - Volunteers are paid out-of-band (monthly Logos settlement runbook),
 *     driven by the coordinator's ledger + the JobCompleted volunteerId.
 *   - UUPS upgradeable; upgrade authority is the admin (cold) key.
 */
contract VolunteerEscrow is
    Initializable,
    AccessControlUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable
{
    bytes32 public constant COORDINATOR_ROLE = keccak256("COORDINATOR_ROLE");

    struct Job {
        address consumer;
        uint256 amount;
        uint64 deadline;
        uint8 taskType;
        bool completed;
        bool refunded;
    }

    address public settlementAddress;
    mapping(bytes32 => Job) public jobs;
    uint256 public jobNonce;

    event JobCreated(
        bytes32 indexed jobId,
        address indexed consumer,
        uint8 taskType,
        uint256 amount,
        uint64 deadline,
        string payload
    );
    event JobCompleted(
        bytes32 indexed jobId,
        string volunteerId,
        bytes32 resultHash,
        uint256 amount
    );
    event JobRefunded(bytes32 indexed jobId, address indexed consumer, uint256 amount);
    event SettlementAddressUpdated(address indexed oldAddr, address indexed newAddr);

    error JobNotFound();
    error JobAlreadyResolved();
    error JobNotExpired();
    error NotConsumer();
    error EmptyPayload();
    error ZeroValue();
    error ZeroAddress();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address admin,
        address _settlementAddress,
        address coordinator
    ) external initializer {
        if (admin == address(0) || _settlementAddress == address(0)) revert ZeroAddress();
        __AccessControl_init();
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        if (coordinator != address(0)) _grantRole(COORDINATOR_ROLE, coordinator);
        settlementAddress = _settlementAddress;
    }

    /// @notice Consumer posts a job, escrowing msg.value. `payload` is the
    ///  job spec the volunteer executes (prompt, image, wasm ref, etc.).
    function createJob(
        string calldata payload,
        uint8 taskType,
        uint64 deadline
    ) external payable returns (bytes32 jobId) {
        if (msg.value == 0) revert ZeroValue();
        if (bytes(payload).length == 0) revert EmptyPayload();

        jobId = keccak256(abi.encodePacked(msg.sender, jobNonce++, block.timestamp));
        jobs[jobId] = Job({
            consumer: msg.sender,
            amount: msg.value,
            deadline: deadline,
            taskType: taskType,
            completed: false,
            refunded: false
        });
        emit JobCreated(jobId, msg.sender, taskType, msg.value, deadline, payload);
    }

    /// @notice Coordinator marks a job complete; escrow releases to the
    ///  settlement address. `volunteerId` (e.g. "wsp:<acct>") is logged for
    ///  off-chain Logos settlement accounting.
    function completeJob(
        bytes32 jobId,
        bytes32 resultHash,
        string calldata volunteerId
    ) external onlyRole(COORDINATOR_ROLE) nonReentrant {
        Job storage job = jobs[jobId];
        if (job.consumer == address(0)) revert JobNotFound();
        if (job.completed || job.refunded) revert JobAlreadyResolved();

        job.completed = true;
        emit JobCompleted(jobId, volunteerId, resultHash, job.amount);

        (bool ok, ) = settlementAddress.call{value: job.amount}("");
        require(ok, "settlement transfer failed");
    }

    /// @notice Consumer reclaims escrow after the job deadline passes.
    function refundJob(bytes32 jobId) external nonReentrant {
        Job storage job = jobs[jobId];
        if (job.consumer == address(0)) revert JobNotFound();
        if (job.completed || job.refunded) revert JobAlreadyResolved();
        if (job.deadline != 0 && block.timestamp < job.deadline) revert JobNotExpired();
        if (job.consumer != msg.sender && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender))
            revert NotConsumer();

        job.refunded = true;
        emit JobRefunded(jobId, job.consumer, job.amount);
        (bool ok, ) = job.consumer.call{value: job.amount}("");
        require(ok, "refund transfer failed");
    }

    function setSettlementAddress(address _settlementAddress)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (_settlementAddress == address(0)) revert ZeroAddress();
        emit SettlementAddressUpdated(settlementAddress, _settlementAddress);
        settlementAddress = _settlementAddress;
    }

    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    /// @dev storage gap for future upgrades
    uint256[50] private __gap;
}
