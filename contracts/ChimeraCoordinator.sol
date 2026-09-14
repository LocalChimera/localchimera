// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IEscrowVault {
    struct Job {
        bytes32 jobId;
        address consumer;
        address providerAuthority;
        bytes32 providerPeerId;
        bytes32 requestHash;
        uint64 nonce;
        uint64 taskType;
        uint64 validUntil;
        bytes quoteSignature;
        uint256 amount;
        address paymentMint;
        uint256 providerFeeBps;
        uint8 state;
        uint256 createdAt;
        uint256 providerAckedAt;
        uint256 providerCompletedAt;
        uint256 confirmWindowStart;
        uint256 refundedAt;
        uint256 settledAt;
        uint256 disputeId;
        bytes32 responseHash;
        bytes teeQuote;
        uint64 klerosDisputeId;
        uint64 klerosRuling;
    }

    function createJob(
        address providerAuthority,
        bytes32 requestHash,
        uint64 nonce,
        uint64 taskType,
        uint64 validUntil,
        bytes calldata quoteSignature,
        uint256 amount,
        address paymentMint,
        bytes16 refId
    ) external payable returns (address jobAddress, bytes32 jobId);

    function getJob(address jobAddress) external view returns (Job memory);
}

interface IComputeRegistry {
    struct Provider {
        address authority;
        bytes32 qvacPeerId;
        string name;
        uint16 taskTypes;
        PricingTier[] tiers;
        uint64 jobsCompleted;
        uint256 totalEarned;
        uint256 totalStaked;
        uint8 status;
        uint256 registeredAt;
        uint256 updatedAt;
        StorageCapacity storageCap;
        ComputeCapacity computeCap;
        InferenceCapacity inferenceCap;
        BandwidthCapacity bandwidthCap;
    }

    struct PricingTier {
        string modelId;
        uint256 pricePerRequest;
        uint256 minTPS;
        uint256 maxContextTokens;
    }

    struct StorageCapacity {
        uint64 totalCapacityMb;
        uint256 pricePerMbMonth;
        uint64 minStorageMb;
        uint64 maxStorageMb;
        bool enabled;
    }

    struct ComputeCapacity {
        uint64 cpuCores;
        uint64 ramMb;
        bool gpu;
        uint64 vramMb;
        string runtimeTypes;
        uint256 pricePerCpuSec;
        uint256 pricePerGpuSec;
        bool enabled;
    }

    struct InferenceCapacity {
        string models;
        bool gpu;
        uint64 vramMb;
        uint256 pricePerRequest;
        bool enabled;
    }

    struct BandwidthCapacity {
        uint64 bandwidthMbps;
        string serviceType;
        uint64 orPort;
        uint64 dirPort;
        uint256 pricePerHour;
        uint256 pricePerGiB;
        bool enabled;
    }

    function getRegisteredProviders() external view returns (address[] memory);
    function getProvider(address providerAddress) external view returns (Provider memory);
    function getProviderStatus(address providerAddress) external view returns (uint8);
    function TASK_TYPE_COMPUTE() external view returns (uint16);
    function TASK_TYPE_STORAGE() external view returns (uint16);
    function TASK_TYPE_INFERENCE() external view returns (uint16);
    function TASK_TYPE_BANDWIDTH() external view returns (uint16);
}

interface IBridgeDispatcher {
    function dispatch(
        bytes32 jobId,
        address jobAddress,
        uint64 taskType,
        uint8 policy,
        address destinationReceiver,
        uint256 destinationChainId,
        bytes calldata lifiCallData,
        bytes32 bridgeTransactionId
    ) external payable;
}

interface AutomationCompatibleInterface {
    function checkUpkeep(bytes calldata checkData) external view returns (bool upkeepNeeded, bytes memory performData);
    function performUpkeep(bytes calldata performData) external;
}

/**
 * @title ChimeraCoordinator
 * @dev On-chain job router for the Chimera escrow using OpenZeppelin AccessControl.
 *
 * Users call createJob() on this contract instead of the EscrowVault directly.
 * The coordinator reads the ComputeRegistry, selects an active provider that supports
 * the requested task type, and creates the escrow job with that provider pre-assigned.
 * A JobRouted event is emitted so the assigned provider can listen and execute.
 */

import "@openzeppelin/contracts/access/AccessControl.sol";

contract ChimeraCoordinator is AccessControl, AutomationCompatibleInterface {
    bytes32 public constant COORDINATOR_ROLE = keccak256("COORDINATOR_ROLE");
    IEscrowVault public escrow;
    IComputeRegistry public registry;

    // Active provider status in ComputeRegistry is 1
    uint8 constant PROVIDER_STATUS_ACTIVE = 1;

    // Default time allowed for a volunteer to complete a job before fallback can be triggered
    uint256 public fallbackTimeout = 60; // 1 minute

    // Time allowed for the tasking network to fulfill a job after fallback/bridge before a refund is triggered
    uint256 public refundTimeout = 1 hours;

    // Task dispatch policy: 0=hybrid (first+second party), 1=first-party-only, 2=second-party-only
    uint8 constant POLICY_HYBRID = 0;
    uint8 constant POLICY_FIRST_PARTY_ONLY = 1;
    uint8 constant POLICY_SECOND_PARTY_ONLY = 2;

    // On-chain bridge dispatcher (Li.Fi integration). When fallback is triggered, the
    // coordinator forwards the job amount to this contract, which executes the Li.Fi bridge.
    IBridgeDispatcher public bridgeDispatcher;

    mapping(address => bytes32) public jobIds;
    mapping(address => uint64) public jobTaskType;
    mapping(address => uint256) public jobDeadline;
    mapping(address => uint8) public jobPolicy;
    mapping(address => uint256) public jobAmount;
    mapping(address => address) public jobProvider;
    mapping(address => address) public jobConsumer;
    mapping(address => bool) public bridged;
    mapping(address => bool) public paid;
    mapping(address => bool) public refunded;
    mapping(address => bool) public fallbackCompleted;
    mapping(address => uint256) public refundDeadline;
    mapping(address => uint256) public jobBridgedAmount;
    address[] public jobList;
    mapping(address => uint256) public jobListIndex;

    // Li.Fi bridge calldata and destination per canonical task type. Set by owner.
    mapping(uint64 => bytes) public bridgeData;
    mapping(uint64 => address) public bridgeReceiver;
    mapping(uint64 => uint256) public bridgeDestinationChainId;
    mapping(uint64 => bytes) public refundBridgeData;
    mapping(uint64 => address) public refundBridgeReceiver;
    mapping(uint64 => uint256) public refundBridgeDestinationChainId;

    event JobRouted(
        bytes32 indexed jobId,
        address indexed jobAddress,
        address indexed provider,
        uint64 taskType,
        uint8 policy
    );

    event FallbackRequired(
        bytes32 indexed jobId,
        address indexed jobAddress,
        address indexed fallbackProvider,
        uint64 taskType,
        uint256 deadline,
        uint8 policy
    );

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event EscrowUpdated(address indexed previousEscrow, address indexed newEscrow);
    event RegistryUpdated(address indexed previousRegistry, address indexed newRegistry);
    event BridgeDispatcherUpdated(address indexed previousDispatcher, address indexed newDispatcher);
    event BridgeDataUpdated(uint64 indexed taskType, address indexed receiver, uint256 indexed destinationChainId);
    event RefundBridgeDataUpdated(uint64 indexed taskType, address indexed receiver, uint256 indexed destinationChainId);
    event FallbackBridged(
        bytes32 indexed jobId,
        address indexed jobAddress,
        uint64 indexed taskType,
        uint8 policy,
        uint256 amount,
        address bridgeDispatcher
    );
    event RefundBridged(
        bytes32 indexed jobId,
        address indexed jobAddress,
        uint64 indexed taskType,
        uint8 policy,
        uint256 amount,
        address bridgeDispatcher
    );
    event FallbackCompleted(
        bytes32 indexed jobId,
        address indexed jobAddress,
        bytes32 completionHash
    );

    event JobPaid(
        bytes32 indexed jobId,
        address indexed jobAddress,
        address indexed provider,
        bytes32 responseHash,
        uint256 amount
    );

    constructor(address _escrow, address _registry) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(COORDINATOR_ROLE, msg.sender);
        escrow = IEscrowVault(_escrow);
        registry = IComputeRegistry(_registry);
    }

    modifier onlyCoordinator() {
        require(hasRole(COORDINATOR_ROLE, msg.sender), "ChimeraCoordinator: not coordinator");
        _;
    }

    function setEscrow(address _escrow) external onlyCoordinator {
        address previous = address(escrow);
        escrow = IEscrowVault(_escrow);
        emit EscrowUpdated(previous, _escrow);
    }

    function setRegistry(address _registry) external onlyCoordinator {
        address previous = address(registry);
        registry = IComputeRegistry(_registry);
        emit RegistryUpdated(previous, _registry);
    }

    function transferOwnership(address newOwner) external onlyCoordinator {
        require(newOwner != address(0), "ChimeraCoordinator: zero address");
        _grantRole(DEFAULT_ADMIN_ROLE, newOwner);
        _grantRole(COORDINATOR_ROLE, newOwner);
        emit OwnershipTransferred(msg.sender, newOwner);
    }

    /**
     * @notice Create and route a job to the best available provider.
     * @param requestHash Hash of the request payload.
     * @param nonce Unique nonce for the job.
     * @param taskType Botchain task-type flag (1=compute, 2=storage, 4=inference, 8=bandwidth).
     * @param validUntil Unix timestamp after which the job expires.
     * @param quoteSignature Optional quote signature from the provider.
     * @param paymentMint Token address for payment (address(0) for native BOT).
     * @param refId Optional reference ID.
     * @return jobAddress The deployed escrow job address.
     * @return jobId The job ID bytes32.
     */
    function createJob(
        bytes32 requestHash,
        uint64 nonce,
        uint64 taskType,
        uint64 validUntil,
        bytes calldata quoteSignature,
        address paymentMint,
        bytes16 refId,
        uint8 policy,
        uint256 bridgeFee
    ) external payable returns (address jobAddress, bytes32 jobId) {
        require(policy <= POLICY_SECOND_PARTY_ONLY, "ChimeraCoordinator: invalid policy");

        uint256 amount = msg.value;
        require(amount > 0, "ChimeraCoordinator: amount must be greater than 0");

        if (policy == POLICY_SECOND_PARTY_ONLY) {
            // No escrow for second-party-only jobs: bridge the full payment directly to the tasking network.
            require(address(bridgeDispatcher) != address(0), "ChimeraCoordinator: bridge dispatcher not set");
            require(bridgeFee == 0, "ChimeraCoordinator: bridgeFee must be 0 for second-party-only");
            bytes memory lifiCallData = bridgeData[taskType];
            require(lifiCallData.length > 0, "ChimeraCoordinator: no bridge data for task type");
            address receiver = bridgeReceiver[taskType];
            uint256 destinationChainId = bridgeDestinationChainId[taskType];
            require(receiver != address(0), "ChimeraCoordinator: no bridge receiver for task type");
            require(destinationChainId > 0, "ChimeraCoordinator: no bridge destination chain for task type");

            jobAddress = _jobAddress(requestHash, nonce, taskType, msg.sender);
            jobIds[jobAddress] = keccak256(abi.encodePacked(jobAddress, block.number));
            jobTaskType[jobAddress] = taskType;
            jobDeadline[jobAddress] = 0; // no fallback needed
            jobPolicy[jobAddress] = policy;
            jobConsumer[jobAddress] = msg.sender;
            _addJob(jobAddress);

            bytes32 txId = keccak256(abi.encodePacked(jobIds[jobAddress], jobAddress, block.number));
            bridgeDispatcher.dispatch{value: amount}(
                jobIds[jobAddress],
                jobAddress,
                taskType,
                policy,
                receiver,
                destinationChainId,
                lifiCallData,
                txId
            );
            bridged[jobAddress] = true;
            jobBridgedAmount[jobAddress] = amount;
            refundDeadline[jobAddress] = block.timestamp + refundTimeout;
            emit JobRouted(jobIds[jobAddress], jobAddress, address(bridgeDispatcher), taskType, policy);
            emit FallbackBridged(jobIds[jobAddress], jobAddress, taskType, policy, amount, address(bridgeDispatcher));
            return (jobAddress, jobIds[jobAddress]);
        }

        address provider = selectProvider(taskType);
        require(provider != address(0), "ChimeraCoordinator: no active provider for task type");

        if (policy == POLICY_HYBRID) {
            // Hybrid: the full amount stays in the coordinator. The volunteer is paid directly
            // via payVolunteer() if they complete, otherwise the amount is bridged to the tasking
            // network via triggerFallback().
            require(bridgeFee == 0, "ChimeraCoordinator: bridgeFee must be 0 for hybrid; amount is held in coordinator");
            require(address(bridgeDispatcher) != address(0), "ChimeraCoordinator: bridge dispatcher not set for hybrid");
            require(bridgeData[taskType].length > 0, "ChimeraCoordinator: no bridge data for task type");
            require(bridgeReceiver[taskType] != address(0), "ChimeraCoordinator: no bridge receiver for task type");
            require(bridgeDestinationChainId[taskType] > 0, "ChimeraCoordinator: no bridge destination chain for task type");

            jobAddress = _jobAddress(requestHash, nonce, taskType, msg.sender);
            jobIds[jobAddress] = keccak256(abi.encodePacked(jobAddress, block.number));
            jobTaskType[jobAddress] = taskType;
            jobDeadline[jobAddress] = block.timestamp + fallbackTimeout;
            jobPolicy[jobAddress] = policy;
            jobProvider[jobAddress] = provider;
            jobConsumer[jobAddress] = msg.sender;
            _addJob(jobAddress);
            jobAmount[jobAddress] = amount;
            emit JobRouted(jobIds[jobAddress], jobAddress, provider, taskType, policy);
            return (jobAddress, jobIds[jobAddress]);
        }

        // First-party-only: escrow with the volunteer provider for full Chimera features.
        address escrowAddr;
        bytes32 escrowJobId;
        (escrowAddr, escrowJobId) = escrow.createJob{value: amount}(
            provider,
            requestHash,
            nonce,
            taskType,
            validUntil,
            quoteSignature,
            amount,
            paymentMint,
            refId
        );
        // Re-store metadata now that we have the real escrow address.
        jobAddress = escrowAddr;
        jobIds[jobAddress] = escrowJobId;
        jobTaskType[jobAddress] = taskType;
        jobDeadline[jobAddress] = block.timestamp + fallbackTimeout;
        jobPolicy[jobAddress] = policy;
        jobProvider[jobAddress] = provider;
        jobConsumer[jobAddress] = msg.sender;
        _addJob(jobAddress);
        emit JobRouted(jobIds[jobAddress], jobAddress, provider, taskType, policy);
    }

    /**
     * @notice Trigger a fallback signal when the assigned provider has not completed in time.
     * @dev Anyone can call this after jobDeadline[jobAddress]. A fallback provider (e.g., a
     *      protocol keeper or the resource-provisioner worker) listens for FallbackRequired,
     *      bridges funds to the tasking network, and submits the result on-chain.
     */
    function triggerFallback(address jobAddress) external {
        uint256 deadline = jobDeadline[jobAddress];
        require(deadline > 0, "ChimeraCoordinator: unknown job");
        require(!bridged[jobAddress], "ChimeraCoordinator: fallback already triggered");
        require(!paid[jobAddress], "ChimeraCoordinator: job already paid to a volunteer");
        // forge-lint: disable-next-line(block-timestamp)
        // Deadline is set by the coordinator owner; block.timestamp is sufficient for this timeout.
        require(block.timestamp > deadline, "ChimeraCoordinator: fallback not yet allowed");

        uint8 policy = jobPolicy[jobAddress];
        if (policy == POLICY_FIRST_PARTY_ONLY) {
            require(false, "ChimeraCoordinator: first-party-only jobs do not fall back to tasking networks");
        }
        if (policy == POLICY_SECOND_PARTY_ONLY) {
            require(false, "ChimeraCoordinator: second-party-only jobs are already bridged");
        }

        // For hybrid jobs, the full amount is held in the coordinator. It is now bridged to the tasking network.
        uint256 bridgeAmount = jobAmount[jobAddress];
        require(bridgeAmount > 0, "ChimeraCoordinator: no held amount to bridge");

        address fallbackProvider = selectProvider(_taskTypeFromJob(jobAddress));
        require(fallbackProvider != address(0), "ChimeraCoordinator: no fallback provider available");

        emit FallbackRequired(jobIdFor(jobAddress), jobAddress, fallbackProvider, _taskTypeFromJob(jobAddress), deadline, policy);

        _bridge(jobAddress, policy, bridgeAmount);
    }

    function setFallbackTimeout(uint256 newTimeout) external onlyCoordinator {
        fallbackTimeout = newTimeout;
    }

    function triggerFallbackForExpiredJobs() external {
        for (uint256 i = 0; i < jobList.length; i++) {
            address jobAddress = jobList[i];
            if (jobPolicy[jobAddress] != POLICY_HYBRID) continue;
            if (bridged[jobAddress] || paid[jobAddress]) continue;
            uint256 deadline = jobDeadline[jobAddress];
            if (deadline == 0 || block.timestamp <= deadline) continue;
            if (jobAmount[jobAddress] == 0) continue;
            try this.triggerFallback(jobAddress) {
                // succeeded
            } catch {
                // continue to next job; one failure should not block the rest
            }
        }
    }

    function payVolunteer(address jobAddress, bytes32 responseHash) external {
        require(jobProvider[jobAddress] == msg.sender, "ChimeraCoordinator: not the assigned provider");
        require(jobPolicy[jobAddress] == POLICY_HYBRID, "ChimeraCoordinator: only hybrid jobs can be paid directly");
        require(!bridged[jobAddress], "ChimeraCoordinator: job already bridged");
        require(!paid[jobAddress], "ChimeraCoordinator: already paid");
        require(block.timestamp <= jobDeadline[jobAddress], "ChimeraCoordinator: deadline passed; use triggerFallback");

        uint256 amount = jobAmount[jobAddress];
        require(amount > 0, "ChimeraCoordinator: no amount to pay");

        paid[jobAddress] = true;
        jobAmount[jobAddress] = 0;
        (bool success, ) = payable(msg.sender).call{value: amount}("");
        require(success, "ChimeraCoordinator: volunteer payment failed");

        emit JobPaid(jobIds[jobAddress], jobAddress, msg.sender, responseHash, amount);
    }

    function setBridgeDispatcher(address _bridgeDispatcher) external onlyCoordinator {
        require(_bridgeDispatcher != address(0), "ChimeraCoordinator: bridge dispatcher cannot be zero address");
        emit BridgeDispatcherUpdated(address(bridgeDispatcher), _bridgeDispatcher);
        bridgeDispatcher = IBridgeDispatcher(_bridgeDispatcher);
    }

    function setBridgeData(
        uint64 taskType,
        address receiver,
        uint256 destinationChainId,
        bytes calldata lifiCallData
    ) external onlyCoordinator {
        require(receiver != address(0), "ChimeraCoordinator: bridge receiver cannot be zero address");
        require(destinationChainId > 0, "ChimeraCoordinator: bridge destination chain must be set");
        require(lifiCallData.length > 0, "ChimeraCoordinator: bridge calldata cannot be empty");
        bridgeReceiver[taskType] = receiver;
        bridgeDestinationChainId[taskType] = destinationChainId;
        bridgeData[taskType] = lifiCallData;
        emit BridgeDataUpdated(taskType, receiver, destinationChainId);
    }

    function setRefundBridgeData(
        uint64 taskType,
        address receiver,
        uint256 destinationChainId,
        bytes calldata lifiCallData
    ) external onlyCoordinator {
        require(receiver != address(0), "ChimeraCoordinator: refund receiver cannot be zero address");
        require(destinationChainId > 0, "ChimeraCoordinator: refund destination chain must be set");
        require(lifiCallData.length > 0, "ChimeraCoordinator: refund calldata cannot be empty");
        refundBridgeReceiver[taskType] = receiver;
        refundBridgeDestinationChainId[taskType] = destinationChainId;
        refundBridgeData[taskType] = lifiCallData;
        emit RefundBridgeDataUpdated(taskType, receiver, destinationChainId);
    }

    function setRefundTimeout(uint256 newTimeout) external onlyCoordinator {
        refundTimeout = newTimeout;
    }

    /**
     * @notice Called by an authorized relayer (e.g., the resource-provisioner or a destination-chain oracle)
     *         to mark a bridged job as completed by the tasking network. This prevents an automatic refund.
     * @param completionHash A hash representing the tasking-network result (optional, can be 0).
     */
    function markFallbackComplete(address jobAddress, bytes32 completionHash) external onlyCoordinator {
        require(bridged[jobAddress], "ChimeraCoordinator: job not yet bridged");
        require(!refunded[jobAddress], "ChimeraCoordinator: job already refunded");
        fallbackCompleted[jobAddress] = true;
        emit FallbackCompleted(jobIdFor(jobAddress), jobAddress, completionHash);
    }

    /**
     * @notice Refund a bridged job whose tasking-network fulfillment window has expired without completion.
     *         Bridges the original amount back to the origin chain (consumer or coordinator).
     */
    function refundFallback(address jobAddress) external {
        require(bridged[jobAddress], "ChimeraCoordinator: job not bridged");
        require(!fallbackCompleted[jobAddress], "ChimeraCoordinator: job already completed by tasking network");
        require(!refunded[jobAddress], "ChimeraCoordinator: already refunded");
        uint256 deadline = refundDeadline[jobAddress];
        require(deadline > 0 && block.timestamp > deadline, "ChimeraCoordinator: refund window not yet expired");
        uint8 policy = jobPolicy[jobAddress];
        uint256 bridgeAmount = jobBridgedAmount[jobAddress];
        require(bridgeAmount > 0, "ChimeraCoordinator: no refund amount");
        _bridgeRefund(jobAddress, policy, bridgeAmount);
    }

    function refundFallbackForExpiredJobs() external {
        for (uint256 i = 0; i < jobList.length; i++) {
            address jobAddress = jobList[i];
            if (!bridged[jobAddress] || refunded[jobAddress] || fallbackCompleted[jobAddress]) continue;
            uint256 deadline = refundDeadline[jobAddress];
            if (deadline == 0 || block.timestamp <= deadline) continue;
            if (jobBridgedAmount[jobAddress] == 0) continue;
            try this.refundFallback(jobAddress) {
                // succeeded
            } catch {
                // continue to next job
            }
        }
    }

    /**
     * @notice Combined automation entry point: triggers fallback for unpaid hybrid jobs and refunds
     *         unfulfilled bridged jobs. Called by Reactive Network or a keeper.
     */
    function processExpiredJobs() external {
        this.triggerFallbackForExpiredJobs();
        this.refundFallbackForExpiredJobs();
    }

    /**
     * @notice Select an active provider for a task type deterministically.
     * @dev Uses a pseudo-random score seeded by block data and provider address.
     *      This is not secure randomness but is sufficient for load balancing among
     *      honest volunteers. The selected provider can still reject the job off-chain.
     */
    function selectProvider(uint64 taskType) public view returns (address) {
        require(taskType <= type(uint16).max, "ChimeraCoordinator: task type too large");
        address[] memory providers = registry.getRegisteredProviders();
        if (providers.length == 0) return address(0);

        address bestProvider = address(0);
        uint256 bestScore = type(uint256).max;
        // forge-lint: disable-next-line(unsafe-typecast)
        // taskType is checked above to fit in uint16
        uint16 taskType16 = uint16(taskType);

        for (uint256 i = 0; i < providers.length; i++) {
            address candidate = providers[i];
            IComputeRegistry.Provider memory p = registry.getProvider(candidate);
            if (p.status != PROVIDER_STATUS_ACTIVE) continue;
            if ((p.taskTypes & taskType16) == 0) continue;

            uint256 score = uint256(keccak256(abi.encodePacked(block.number, block.timestamp, candidate, tx.origin)));
            if (score < bestScore) {
                bestScore = score;
                bestProvider = candidate;
            }
        }

        return bestProvider;
    }

    // --- Automation / keeper integration (Chainlink Automation compatible) ---

    function checkUpkeep(bytes calldata checkData) external view returns (bool upkeepNeeded, bytes memory performData) {
        address jobAddress = abi.decode(checkData, (address));
        uint256 deadline = jobDeadline[jobAddress];
        bool needsFallback = deadline > 0
            && block.timestamp > deadline
            && !bridged[jobAddress]
            && !paid[jobAddress]
            && jobPolicy[jobAddress] == POLICY_HYBRID
            && jobAmount[jobAddress] > 0;
        return (needsFallback, checkData);
    }

    function performUpkeep(bytes calldata performData) external {
        address jobAddress = abi.decode(performData, (address));
        this.triggerFallback(jobAddress);
    }

    // --- Internal helpers ---

    function _jobAddress(
        bytes32 requestHash,
        uint64 nonce,
        uint64 taskType,
        address sender
    ) internal view returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(
            requestHash,
            nonce,
            taskType,
            sender,
            block.number,
            block.timestamp
        )))));
    }

    function _addJob(address jobAddress) internal {
        if (jobListIndex[jobAddress] == 0 && (jobList.length == 0 || jobList[0] != jobAddress)) {
            jobList.push(jobAddress);
            jobListIndex[jobAddress] = jobList.length;
        }
    }

    function _taskTypeFromJob(address jobAddress) internal view returns (uint64) {
        return jobTaskType[jobAddress];
    }

    function jobIdFor(address jobAddress) internal view returns (bytes32) {
        return jobIds[jobAddress];
    }

    function _bridge(address jobAddress, uint8 policy, uint256 bridgeAmount) internal {
        require(address(bridgeDispatcher) != address(0), "ChimeraCoordinator: bridge dispatcher not set");
        uint64 taskType = _taskTypeFromJob(jobAddress);
        bytes memory lifiCallData = bridgeData[taskType];
        require(lifiCallData.length > 0, "ChimeraCoordinator: no bridge data for task type");
        address receiver = bridgeReceiver[taskType];
        uint256 destinationChainId = bridgeDestinationChainId[taskType];
        require(receiver != address(0), "ChimeraCoordinator: no bridge receiver for task type");
        require(destinationChainId > 0, "ChimeraCoordinator: no bridge destination chain for task type");

        bridged[jobAddress] = true;
        jobBridgedAmount[jobAddress] = bridgeAmount;
        jobAmount[jobAddress] = 0;
        refundDeadline[jobAddress] = block.timestamp + refundTimeout;
        bytes32 txId = keccak256(abi.encodePacked(jobIdFor(jobAddress), jobAddress, block.number));
        bridgeDispatcher.dispatch{value: bridgeAmount}(
            jobIdFor(jobAddress),
            jobAddress,
            taskType,
            policy,
            receiver,
            destinationChainId,
            lifiCallData,
            txId
        );
        emit FallbackBridged(jobIdFor(jobAddress), jobAddress, taskType, policy, bridgeAmount, address(bridgeDispatcher));
    }

    function _bridgeRefund(address jobAddress, uint8 policy, uint256 bridgeAmount) internal {
        require(address(bridgeDispatcher) != address(0), "ChimeraCoordinator: bridge dispatcher not set");
        uint64 taskType = _taskTypeFromJob(jobAddress);
        bytes memory lifiCallData = refundBridgeData[taskType];
        require(lifiCallData.length > 0, "ChimeraCoordinator: no refund bridge data for task type");
        address receiver = refundBridgeReceiver[taskType];
        uint256 destinationChainId = refundBridgeDestinationChainId[taskType];
        require(receiver != address(0), "ChimeraCoordinator: no refund bridge receiver for task type");
        require(destinationChainId > 0, "ChimeraCoordinator: no refund bridge destination chain for task type");

        refunded[jobAddress] = true;
        jobAmount[jobAddress] = 0;
        bytes32 txId = keccak256(abi.encodePacked(jobIdFor(jobAddress), jobAddress, block.number, "refund"));
        bridgeDispatcher.dispatch{value: bridgeAmount}(
            jobIdFor(jobAddress),
            jobAddress,
            taskType,
            policy,
            receiver,
            destinationChainId,
            lifiCallData,
            txId
        );
        emit RefundBridged(jobIdFor(jobAddress), jobAddress, taskType, policy, bridgeAmount, address(bridgeDispatcher));
    }
}
