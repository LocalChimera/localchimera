// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title ChimeraBridgeDispatcher
 * @notice On-chain dispatcher that bridges funds via Li.Fi to pay tasking networks.
 * @dev The dispatcher is intentionally simple: the coordinator (or any permissionless
 *      keeper) calls `dispatch` with an amount and Li.Fi-encoded calldata. The contract
 *      forwards the native token to the configured Li.Fi diamond and emits a
 *      `BridgeDispatched` event that a tasking-network executor can watch on the
 *      destination chain to claim payment and submit a result.
 *
 *      Because Li.Fi routes are dynamic, the actual bridge calldata is supplied by the
 *      caller or by the coordinator's stored `bridgeData` per task type. The contract
 *      validates that the call succeeds and that the full `msg.value` is forwarded.
 */
contract ChimeraBridgeDispatcher is Ownable, Pausable {
    address public lifiDiamond;

    event LifiDiamondUpdated(address indexed previousDiamond, address indexed newDiamond);

    event BridgeDispatched(
        bytes32 indexed jobId,
        address indexed jobAddress,
        uint64 indexed taskType,
        uint8 policy,
        uint256 amount,
        address destinationReceiver,
        uint256 destinationChainId,
        bytes32 bridgeTransactionId
    );

    event BridgeCallFailed(
        bytes32 indexed jobId,
        address indexed jobAddress,
        bytes lifiCallData,
        string reason
    );

    constructor(address _lifiDiamond) Ownable(msg.sender) {
        lifiDiamond = _lifiDiamond;
    }

    /**
     * @notice Execute a Li.Fi bridge call from this contract.
     * @param jobId The job identifier being bridged.
     * @param jobAddress The escrow/job address on the source chain.
     * @param taskType Canonical task type for the job.
     * @param policy Task dispatch policy (HYBRID or SECOND_PARTY_ONLY).
     * @param destinationReceiver Address that should receive the bridged funds on the destination chain.
     * @param destinationChainId Li.Fi chain id of the destination network.
     * @param lifiCallData Fully encoded call to a Li.Fi diamond facet (e.g. startBridgeTokensViaAcross).
     * @param bridgeTransactionId A unique id used by Li.Fi to track the transfer; often keccak256 of jobId + nonce.
     */
    function dispatch(
        bytes32 jobId,
        address jobAddress,
        uint64 taskType,
        uint8 policy,
        address destinationReceiver,
        uint256 destinationChainId,
        bytes calldata lifiCallData,
        bytes32 bridgeTransactionId
    ) external payable whenNotPaused {
        require(lifiDiamond != address(0), "ChimeraBridgeDispatcher: Li.Fi diamond not set");
        require(msg.value > 0, "ChimeraBridgeDispatcher: nothing to bridge");
        require(policy != 1, "ChimeraBridgeDispatcher: first-party-only jobs are not bridged"); // POLICY_FIRST_PARTY_ONLY

        (bool success, bytes memory returnData) = lifiDiamond.call{value: msg.value}(lifiCallData);
        if (!success) {
            string memory reason = _getRevertReason(returnData);
            emit BridgeCallFailed(jobId, jobAddress, lifiCallData, reason);
            revert(reason);
        }

        emit BridgeDispatched(
            jobId,
            jobAddress,
            taskType,
            policy,
            msg.value,
            destinationReceiver,
            destinationChainId,
            bridgeTransactionId
        );
    }

    /**
     * @notice Rescue native token accidentally sent to this contract.
     */
    function rescueNative(address payable recipient, uint256 amount) external onlyOwner {
        require(recipient != address(0), "ChimeraBridgeDispatcher: zero recipient");
        (bool success, ) = recipient.call{value: amount}("");
        require(success, "ChimeraBridgeDispatcher: rescue failed");
    }

    function setLifiDiamond(address _lifiDiamond) external onlyOwner {
        require(_lifiDiamond != address(0), "ChimeraBridgeDispatcher: diamond cannot be zero address");
        emit LifiDiamondUpdated(lifiDiamond, _lifiDiamond);
        lifiDiamond = _lifiDiamond;
    }

    function setPaused(bool _paused) external onlyOwner {
        if (_paused) _pause();
        else _unpause();
    }

    function _getRevertReason(bytes memory returnData) internal pure returns (string memory) {
        if (returnData.length < 68) return "Transaction reverted silently";
        // Trim the custom error signature bytes4("Error(string)") and decode the string.
        assembly {
            returnData := add(returnData, 0x04)
        }
        return abi.decode(returnData, (string));
    }

    receive() external payable {}
}
