// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/IComputeRegistry.sol";
import "./libraries/Utils.sol";

/// @title ComputeRegistry
/// @notice Provider registry with staking, metadata, and status management
/// @dev Implements the Provider Registry from the decentralized compute marketplace architecture
contract ComputeRegistry is IComputeRegistry, Ownable {
    using MathLib for uint256;
    using ValidationLib for uint256;
    using ValidationLib for address;
    using ValidationLib for string;
    using BytesLib for bytes32;

    // State
    mapping(address => Provider) public providers;
    mapping(address => address) public authorityToProvider; // authority => provider address
    mapping(bytes32 => address) public peerIdToProvider; // qvacPeerId => provider address
    mapping(address => uint256) public stakes;

    uint256 public minimumStakeAmount = 1 ether;
    address public feeRecipient;

    // Constants
    uint256 public constant MIN_TPS = 1;
    uint256 public constant MAX_CONTEXT_TOKENS = 100_000;

    constructor(address _owner, address _feeRecipient, uint256 _minimumStake) Ownable(_owner) {
        feeRecipient = _feeRecipient;
        minimumStakeAmount = _minimumStake;
    }

    modifier onlyAuthorized(address providerAddress) {
        require(providers[providerAddress].authority == msg.sender, "ComputeRegistry: not authorized");
        _;
    }

    modifier providerExists(address providerAddress) {
        require(providers[providerAddress].status != uint8(ProviderStatus.Unregistered), "ComputeRegistry: provider not found");
        _;
    }

    function registerProvider(
        bytes32 qvacPeerId,
        string calldata name,
        uint16 taskTypes,
        PricingTier[] calldata tiers,
        uint256 stakeAmount
    ) external payable override returns (address providerAddress) {
        // Validations
        require(stakeAmount >= minimumStakeAmount, "ComputeRegistry: stake below minimum");
        require(msg.value >= stakeAmount, "ComputeRegistry: insufficient stake sent");
        name.validateString();
        require(taskTypes != 0, "ComputeRegistry: at least one task type required");
        require(tiers.length > 0, "ComputeRegistry: at least one pricing tier required");
        require(!qvacPeerId.isZero(), "ComputeRegistry: invalid peer ID");
        require(peerIdToProvider[qvacPeerId] == address(0), "ComputeRegistry: peer ID already registered");
        require(authorityToProvider[msg.sender] == address(0), "ComputeRegistry: authority already has provider");

        // Validate tiers
        for (uint256 i = 0; i < tiers.length; i++) {
            tiers[i].modelId.validateString();
            tiers[i].pricePerRequest.validatePrice(1);
            tiers[i].minTPS.validatePrice(MIN_TPS);
            require(tiers[i].maxContextTokens <= MAX_CONTEXT_TOKENS, "ComputeRegistry: maxContextTokens too high");
        }

        // Create provider address (using CREATE2-like deterministic address)
        providerAddress = address(uint160(uint256(keccak256(abi.encodePacked(msg.sender, qvacPeerId, block.timestamp)))));

        // Initialize provider
        Provider storage provider = providers[providerAddress];
        provider.authority = msg.sender;
        provider.qvacPeerId = qvacPeerId;
        provider.name = name;
        provider.taskTypes = taskTypes;
        // Copy tiers from calldata to storage using push
        for (uint256 i = 0; i < tiers.length; i++) {
            provider.tiers.push(tiers[i]);
        }
        provider.jobsCompleted = 0;
        provider.totalEarned = 0;
        provider.totalStaked = stakeAmount;
        provider.status = uint8(ProviderStatus.Active);
        provider.registeredAt = block.timestamp;
        provider.updatedAt = block.timestamp;

        // Update mappings
        authorityToProvider[msg.sender] = providerAddress;
        peerIdToProvider[qvacPeerId] = providerAddress;
        stakes[providerAddress] = stakeAmount;

        emit ProviderRegistered(msg.sender, qvacPeerId, name);
        emit StakeDeposited(msg.sender, stakeAmount);
    }

    function updateProvider(
        address providerAddress,
        string calldata name,
        uint16 taskTypes,
        PricingTier[] calldata tiers
    ) external override onlyAuthorized(providerAddress) providerExists(providerAddress) {
        Provider storage provider = providers[providerAddress];
        require(provider.status == uint8(ProviderStatus.Active), "ComputeRegistry: provider not active");

        if (bytes(name).length > 0) {
            provider.name = name;
        }
        if (taskTypes != 0) {
            provider.taskTypes = taskTypes;
        }
        if (tiers.length > 0) {
            for (uint256 i = 0; i < tiers.length; i++) {
                tiers[i].modelId.validateString();
                tiers[i].pricePerRequest.validatePrice(1);
                tiers[i].minTPS.validatePrice(MIN_TPS);
                require(tiers[i].maxContextTokens <= MAX_CONTEXT_TOKENS, "ComputeRegistry: maxContextTokens too high");
            }
            // Clear existing tiers and copy new ones
            delete provider.tiers;
            for (uint256 i = 0; i < tiers.length; i++) {
                provider.tiers.push(tiers[i]);
            }
        }
        provider.updatedAt = block.timestamp;

        emit ProviderUpdated(msg.sender, name, taskTypes, tiers);
    }

    function rotatePeerId(address providerAddress, bytes32 newQvacPeerId) external override onlyAuthorized(providerAddress) providerExists(providerAddress) {
        Provider storage provider = providers[providerAddress];
        require(provider.status == uint8(ProviderStatus.Active), "ComputeRegistry: provider not active");
        require(!newQvacPeerId.isZero(), "ComputeRegistry: invalid peer ID");
        require(peerIdToProvider[newQvacPeerId] == address(0), "ComputeRegistry: peer ID already in use");

        bytes32 oldPeerId = provider.qvacPeerId;
        delete peerIdToProvider[oldPeerId];
        provider.qvacPeerId = newQvacPeerId;
        peerIdToProvider[newQvacPeerId] = providerAddress;
        provider.updatedAt = block.timestamp;

        emit PeerIdRotated(msg.sender, oldPeerId, newQvacPeerId);
    }

    function pauseProvider(address providerAddress) external override onlyAuthorized(providerAddress) providerExists(providerAddress) {
        Provider storage provider = providers[providerAddress];
        require(provider.status == uint8(ProviderStatus.Active), "ComputeRegistry: provider not active");
        provider.status = uint8(ProviderStatus.Paused);
        provider.updatedAt = block.timestamp;

        emit ProviderPaused(msg.sender);
    }

    function resumeProvider(address providerAddress) external override onlyAuthorized(providerAddress) providerExists(providerAddress) {
        Provider storage provider = providers[providerAddress];
        require(provider.status == uint8(ProviderStatus.Paused), "ComputeRegistry: provider not paused");
        provider.status = uint8(ProviderStatus.Active);
        provider.updatedAt = block.timestamp;

        emit ProviderResumed(msg.sender);
    }

    function slashProvider(address providerAddress, bytes calldata proof) external override onlyOwner providerExists(providerAddress) {
        Provider storage provider = providers[providerAddress];
        require(provider.status != uint8(ProviderStatus.Slashed), "ComputeRegistry: already slashed");
        provider.status = uint8(ProviderStatus.Slashed);
        provider.updatedAt = block.timestamp;

        emit ProviderSlashed(provider.authority, proof);
    }

    function depositStake(address providerAddress) external payable override providerExists(providerAddress) {
        Provider storage provider = providers[providerAddress];
        require(provider.status == uint8(ProviderStatus.Active), "ComputeRegistry: provider not active");
        require(msg.value > 0, "ComputeRegistry: no value sent");

        provider.totalStaked += msg.value;
        stakes[providerAddress] += msg.value;

        emit StakeDeposited(provider.authority, msg.value);
    }

    function withdrawStake(address providerAddress, uint256 amount) external override onlyAuthorized(providerAddress) providerExists(providerAddress) {
        Provider storage provider = providers[providerAddress];
        require(provider.status == uint8(ProviderStatus.Active) || provider.status == uint8(ProviderStatus.Paused), "ComputeRegistry: wrong status");
        require(stakes[providerAddress] >= amount, "ComputeRegistry: insufficient stake");
        require(stakes[providerAddress] - amount >= minimumStakeAmount, "ComputeRegistry: would fall below minimum stake");

        stakes[providerAddress] -= amount;
        provider.totalStaked -= amount;

        payable(provider.authority).transfer(amount);
        emit StakeWithdrawn(provider.authority, amount);
    }

    function getProvider(address providerAddress) external view override returns (Provider memory) {
        return providers[providerAddress];
    }

    function getProviderByAuthority(address authority) external view override returns (address providerAddress) {
        return authorityToProvider[authority];
    }

    function getProviderByPeerId(bytes32 qvacPeerId) external view override returns (address providerAddress) {
        return peerIdToProvider[qvacPeerId];
    }

    function getProviderStatus(address providerAddress) external view override returns (ProviderStatus) {
        return ProviderStatus(providers[providerAddress].status);
    }

    function isActiveProvider(address providerAddress) external view override returns (bool) {
        return providers[providerAddress].status == uint8(ProviderStatus.Active);
    }

    function getStake(address providerAddress) external view override returns (uint256) {
        return stakes[providerAddress];
    }

    function minimumStake() external view override returns (uint256) {
        return minimumStakeAmount;
    }

    // Admin functions
    function setMinimumStake(uint256 newMinimumStake) external onlyOwner {
        minimumStakeAmount = newMinimumStake;
    }

    function setFeeRecipient(address newFeeRecipient) external onlyOwner {
        feeRecipient = newFeeRecipient;
    }

    function emergencyWithdraw() external onlyOwner {
        payable(owner()).transfer(address(this).balance);
    }

    receive() external payable {}
}