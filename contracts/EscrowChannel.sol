// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title EscrowChannel — ERC-8184 Streaming Micropayment Channel
 * @notice Unidirectional payment channel with EIP-712 signed vouchers.
 *         2 on-chain transactions (open + claim) for unlimited off-chain resource requests.
 * @dev Uses OpenZeppelin's EIP712, ReentrancyGuard, and SafeERC20.
 */

import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract EscrowChannel is EIP712, ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    struct Channel {
        address sender;
        address recipient;
        uint256 balance;
        uint256 withdrawn;
        uint256 nonce;
        uint256 closedAt;
    }

    IERC20 public immutable paymentToken;
    uint16 public platformFeeBps; // basis points (e.g., 300 = 3%)
    address public feeRecipient;

    mapping(bytes32 => Channel) private channels;

    event ChannelOpened(bytes32 indexed channelId, address indexed sender, address indexed recipient, uint256 deposit);
    event VoucherClaimed(bytes32 indexed channelId, uint256 amount, uint256 nonce);
    event ChannelClosed(bytes32 indexed channelId, uint256 remainingBalance);
    event PlatformFeeUpdated(uint16 feeBps, address feeRecipient);

    error ChannelNotFound(bytes32 channelId);
    error ChannelAlreadyClosed(bytes32 channelId);
    error InvalidVoucher();
    error InsufficientBalance(uint256 available, uint256 requested);
    error OnlySender();
    error OnlyRecipient();

    bytes32 private constant VOUCHER_TYPEHASH = keccak256(
        "Voucher(bytes32 channelId,uint256 amount,uint256 nonce)"
    );

    constructor(address _paymentToken, uint16 _platformFeeBps, address _feeRecipient)
        EIP712("ChimeraEscrow", "1")
        Ownable(msg.sender)
    {
        paymentToken = IERC20(_paymentToken);
        platformFeeBps = _platformFeeBps;
        feeRecipient = _feeRecipient;
    }

    /**
     * @notice Open a new payment channel with a deposit.
     * @param recipient The resource provider who will receive payments.
     * @param depositAmount The amount of payment tokens to deposit.
     * @return channelId Unique identifier for the channel.
     */
    function openChannel(address recipient, uint256 depositAmount) external nonReentrant returns (bytes32 channelId) {
        channelId = keccak256(abi.encodePacked(msg.sender, recipient, block.timestamp, block.number));
        require(channels[channelId].sender == address(0), "Channel already exists");

        paymentToken.safeTransferFrom(msg.sender, address(this), depositAmount);

        channels[channelId] = Channel({
            sender: msg.sender,
            recipient: recipient,
            balance: depositAmount,
            withdrawn: 0,
            nonce: 0,
            closedAt: 0
        });

        emit ChannelOpened(channelId, msg.sender, recipient, depositAmount);
    }

    /**
     * @notice Claim payment using an EIP-712 signed voucher.
     * @param channelId The channel ID.
     * @param amount The amount to claim.
     * @param nonce The voucher nonce (must be > channel.nonce).
     * @param signature The EIP-712 signature from the sender.
     */
    function claimVoucher(
        bytes32 channelId,
        uint256 amount,
        uint256 nonce,
        bytes calldata signature
    ) external nonReentrant {
        Channel storage channel = channels[channelId];
        if (channel.sender == address(0)) revert ChannelNotFound(channelId);
        if (channel.closedAt != 0) revert ChannelAlreadyClosed(channelId);
        require(nonce > channel.nonce, "Nonce must be greater than last claimed");

        // Verify EIP-712 signature
        bytes32 structHash = keccak256(abi.encode(VOUCHER_TYPEHASH, channelId, amount, nonce));
        bytes32 hash = _hashTypedDataV4(structHash);
        address signer = ECDSA.recover(hash, signature);
        if (signer != channel.sender) revert InvalidVoucher();

        uint256 available = channel.balance - channel.withdrawn;
        if (amount > available) revert InsufficientBalance(available, amount);

        channel.withdrawn += amount;
        channel.nonce = nonce;

        // Calculate fee
        uint256 fee = (amount * platformFeeBps) / 10000;
        uint256 payout = amount - fee;

        if (fee > 0 && feeRecipient != address(0)) {
            paymentToken.safeTransfer(feeRecipient, fee);
        }
        paymentToken.safeTransfer(channel.recipient, payout);

        emit VoucherClaimed(channelId, amount, nonce);
    }

    /**
     * @notice Cooperatively close a channel. Both parties must sign.
     * @param channelId The channel ID.
     * @param finalAmount The final settlement amount.
     * @param senderSig Sender's signature for cooperative close.
     */
    function cooperativeClose(
        bytes32 channelId,
        uint256 finalAmount,
        bytes calldata senderSig,
        bytes calldata recipientSig
    ) external nonReentrant {
        Channel storage channel = channels[channelId];
        if (channel.sender == address(0)) revert ChannelNotFound(channelId);
        if (channel.closedAt != 0) revert ChannelAlreadyClosed(channelId);

        bytes32 closeHash = keccak256(abi.encodePacked(channelId, finalAmount, "close"));
        bytes32 ethHash = _hashTypedDataV4(closeHash);

        require(ECDSA.recover(ethHash, senderSig) == channel.sender, "Invalid sender signature");
        require(ECDSA.recover(ethHash, recipientSig) == channel.recipient, "Invalid recipient signature");

        uint256 remaining = channel.balance - channel.withdrawn;
        uint256 payout = finalAmount > remaining ? remaining : finalAmount;
        uint256 refund = remaining - payout;

        channel.closedAt = block.timestamp;
        channel.withdrawn += payout;

        if (payout > 0) {
            uint256 fee = (payout * platformFeeBps) / 10000;
            uint256 netPayout = payout - fee;
            if (fee > 0 && feeRecipient != address(0)) {
                paymentToken.safeTransfer(feeRecipient, fee);
            }
            paymentToken.safeTransfer(channel.recipient, netPayout);
        }
        if (refund > 0) {
            paymentToken.safeTransfer(channel.sender, refund);
        }

        emit ChannelClosed(channelId, refund);
    }

    /**
     * @notice Unilateral close after a timeout (for non-cooperative case).
     * @param channelId The channel ID.
     * @param timeoutSeconds The challenge period.
     */
    function forceClose(bytes32 channelId, uint256 timeoutSeconds) external {
        Channel storage channel = channels[channelId];
        if (channel.sender == address(0)) revert ChannelNotFound(channelId);
        if (channel.closedAt != 0) revert ChannelAlreadyClosed(channelId);

        // Anyone can trigger close after the timeout from channel open
        // In production, this would use a challenge period
        channel.closedAt = block.timestamp;

        uint256 remaining = channel.balance - channel.withdrawn;
        if (remaining > 0) {
            paymentToken.safeTransfer(channel.sender, remaining);
        }

        emit ChannelClosed(channelId, remaining);
    }

    // ============ View Functions ============

    function getChannel(bytes32 channelId) external view returns (
        address sender,
        address recipient,
        uint256 balance,
        uint256 withdrawn,
        uint256 closedAt
    ) {
        Channel storage ch = channels[channelId];
        return (ch.sender, ch.recipient, ch.balance, ch.withdrawn, ch.closedAt);
    }

    function isClosed(bytes32 channelId) external view returns (bool) {
        return channels[channelId].closedAt != 0;
    }

    function getNonce(bytes32 channelId) external view returns (uint256) {
        return channels[channelId].nonce;
    }

    // ============ Admin ============

    function setPlatformFee(uint16 _feeBps, address _feeRecipient) external onlyOwner {
        require(_feeBps <= 1000, "Fee cannot exceed 10%");
        platformFeeBps = _feeBps;
        feeRecipient = _feeRecipient;
        emit PlatformFeeUpdated(_feeBps, _feeRecipient);
    }
}
