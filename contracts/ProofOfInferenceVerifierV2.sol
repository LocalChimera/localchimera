// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ProofOfInferenceVerifierV2
 * @notice Tokenomics-enabled Proof-of-Inference verifier.
 *
 * Replaces USDT settlement with CHIMERA token settlement and burns 10% of each
 * settlement amount (deflationary). All verification logic (ECDSA, node registry,
 * batch verify) is unchanged from v1.
 */

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IChimeraToken {
    function burn(uint256 amount) external;
}

contract ProofOfInferenceVerifierV2 is Ownable {
    using SafeERC20 for IERC20;

    // Receipt structure (packed for gas efficiency)
    struct Receipt {
        bytes32 merkleRoot;
        bytes32 promptHash;
        bytes32 outputHash;
        uint256 timestamp;
        uint256 chainIndex;
        uint256 tokensGenerated;
        uint256 durationMs;
        bytes32 sigR;
        bytes32 sigS;
        uint8 recoveryId;
        bytes publicKey; // 65 bytes uncompressed
        bytes32 previousHash;
    }

    // Node registration
    struct NodeInfo {
        address nodeAddress;
        bytes32 publicKeyHash; // keccak256 of the 65-byte uncompressed public key
        uint256 latestChainIndex;
        uint256 totalReceipts;
        uint256 totalTokens;
        bool registered;
    }

    // CHIMERA token contract (replaces USDT)
    IERC20 public immutable chimeraToken;

    // Node registry: publicKeyHash => NodeInfo
    mapping(bytes32 => NodeInfo) public nodes;

    // Verified receipts: merkleRoot => verified
    mapping(bytes32 => bool) public verifiedReceipts;

    // Settlement records
    struct Settlement {
        bytes32 merkleRoot;
        uint256 amount;
        uint256 burnAmount;
        uint256 timestamp;
    }
    mapping(bytes32 => Settlement[]) public settlements;

    // Total CHIMERA burned via PoI settlement (deflationary tracking)
    uint256 public totalBurned;

    // Events
    event NodeRegistered(bytes32 indexed publicKeyHash, address indexed nodeAddress);
    event InferenceVerified(
        bytes32 indexed publicKeyHash,
        bytes32 indexed merkleRoot,
        uint256 chainIndex,
        uint256 tokensGenerated,
        uint256 timestamp
    );
    event SettlementExecuted(
        bytes32 indexed merkleRoot,
        address indexed recipient,
        uint256 amount,
        uint256 burnAmount
    );

    // Config
    uint256 public constant MAX_SETTLE_PER_TX = 100;
    uint256 public constant POI_BURN_BPS = 1000; // 10% burn on settlement
    uint256 private constant BPS_DENOMINATOR = 10000;

    constructor(address _chimeraToken) Ownable(msg.sender) {
        chimeraToken = IERC20(_chimeraToken);
    }

    /**
     * @dev Register a node by its public key hash.
     * @param publicKeyHash keccak256 of the 65-byte uncompressed secp256k1 public key
     */
    function registerNode(bytes32 publicKeyHash) external {
        require(!nodes[publicKeyHash].registered, "Already registered");
        nodes[publicKeyHash] = NodeInfo({
            nodeAddress: msg.sender,
            publicKeyHash: publicKeyHash,
            latestChainIndex: 0,
            totalReceipts: 0,
            totalTokens: 0,
            registered: true
        });
        emit NodeRegistered(publicKeyHash, msg.sender);
    }

    /**
     * @dev Verify a proof-of-inference receipt on-chain.
     * Uses ecrecover to verify the secp256k1 signature over the merkleRoot.
     *
     * Note: Chimera uses raw secp256k1 (not Ethereum's prefixed signing),
     * so we derive the Ethereum address from the public key and compare.
     *
     * @param receipt The inference receipt to verify
     */
    function verifyInference(Receipt calldata receipt) external returns (bool) {
        bytes32 pubKeyHash = keccak256(receipt.publicKey);
        NodeInfo storage node = nodes[pubKeyHash];
        require(node.registered, "Node not registered");
        require(!verifiedReceipts[receipt.merkleRoot], "Already verified");
        require(receipt.chainIndex == node.latestChainIndex + 1, "Chain index mismatch");

        // Recover signer address using OpenZeppelin ECDSA
        bytes32 ethSignedHash = MessageHashUtils.toEthSignedMessageHash(receipt.merkleRoot);
        address recovered = ECDSA.recover(ethSignedHash, receipt.recoveryId + 27, receipt.sigR, receipt.sigS);

        // Derive expected address from public key
        bytes32 pubKeyAddrHash = keccak256(receipt.publicKey[1:]);
        address expectedAddr = address(uint160(uint256(pubKeyAddrHash)));

        require(recovered == expectedAddr, "Signature verification failed");

        // Mark as verified
        verifiedReceipts[receipt.merkleRoot] = true;
        node.latestChainIndex = receipt.chainIndex;
        node.totalReceipts++;
        node.totalTokens += receipt.tokensGenerated;

        emit InferenceVerified(
            pubKeyHash,
            receipt.merkleRoot,
            receipt.chainIndex,
            receipt.tokensGenerated,
            receipt.timestamp
        );

        return true;
    }

    /**
     * @dev Batch verify multiple receipts in a single transaction.
     */
    function verifyBatch(Receipt[] calldata receipts) external returns (uint256) {
        require(receipts.length <= MAX_SETTLE_PER_TX, "Too many receipts");
        uint256 verified = 0;
        for (uint256 i = 0; i < receipts.length; i++) {
            try this.verifyInference(receipts[i]) {
                verified++;
            } catch {
                // Skip failed verifications
            }
        }
        return verified;
    }

    /**
     * @dev Settle CHIMERA for verified inference receipts.
     *      Burns 10% of the settlement amount (deflationary).
     * @param merkleRoot The merkle root of the verified receipt
     * @param recipient The address to receive CHIMERA
     * @param amount The amount of CHIMERA (in 18 decimals)
     */
    function settle(
        bytes32 merkleRoot,
        address recipient,
        uint256 amount
    ) external onlyOwner {
        require(verifiedReceipts[merkleRoot], "Receipt not verified");
        require(amount > 0, "Amount must be > 0");

        uint256 burnAmount = (amount * POI_BURN_BPS) / BPS_DENOMINATOR;
        uint256 transferAmount = amount - burnAmount;

        chimeraToken.safeTransfer(recipient, transferAmount);
        IChimeraToken(address(chimeraToken)).burn(burnAmount);
        totalBurned += burnAmount;

        settlements[merkleRoot].push(Settlement({
            merkleRoot: merkleRoot,
            amount: transferAmount,
            burnAmount: burnAmount,
            timestamp: block.timestamp
        }));

        emit SettlementExecuted(merkleRoot, recipient, transferAmount, burnAmount);
    }

    /**
     * @dev Batch settle multiple verified receipts.
     *      Burns 10% of each settlement amount (deflationary).
     */
    function settleBatch(
        bytes32[] calldata merkleRoots,
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external onlyOwner {
        require(
            merkleRoots.length == recipients.length && recipients.length == amounts.length,
            "Array length mismatch"
        );
        require(merkleRoots.length <= MAX_SETTLE_PER_TX, "Too many settlements");

        for (uint256 i = 0; i < merkleRoots.length; i++) {
            require(verifiedReceipts[merkleRoots[i]], "Receipt not verified");

            uint256 burnAmount = (amounts[i] * POI_BURN_BPS) / BPS_DENOMINATOR;
            uint256 transferAmount = amounts[i] - burnAmount;

            chimeraToken.safeTransfer(recipients[i], transferAmount);
            IChimeraToken(address(chimeraToken)).burn(burnAmount);
            totalBurned += burnAmount;

            settlements[merkleRoots[i]].push(Settlement({
                merkleRoot: merkleRoots[i],
                amount: transferAmount,
                burnAmount: burnAmount,
                timestamp: block.timestamp
            }));

            emit SettlementExecuted(merkleRoots[i], recipients[i], transferAmount, burnAmount);
        }
    }

    /**
     * @dev Get node info by public key hash.
     */
    function getNode(bytes32 publicKeyHash) external view returns (NodeInfo memory) {
        return nodes[publicKeyHash];
    }

    /**
     * @dev Get settlement count for a receipt.
     */
    function getSettlementCount(bytes32 merkleRoot) external view returns (uint256) {
        return settlements[merkleRoot].length;
    }

    /**
     * @dev Check if a receipt has been verified.
     */
    function isVerified(bytes32 merkleRoot) external view returns (bool) {
        return verifiedReceipts[merkleRoot];
    }
}
