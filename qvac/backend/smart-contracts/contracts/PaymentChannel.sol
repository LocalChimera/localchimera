// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

interface IPaymentChannel {
    enum ChannelStatus { Open, Closing, Closed }

    struct Channel {
        address sender;
        address receiver;
        uint256 deposit;
        uint256 withdrawn;
        uint256 lastNonce;
        ChannelStatus status;
        uint256 closingStartedAt;
    }

    error AlreadyClosed();
    error ChallengePeriodNotExpired();
    error ChannelExists();
    error ChannelNotClosing();
    error ChannelNotFound();
    error ChannelNotOpen();
    error InsufficientChannelBalance();
    error InvalidDeposit();
    error InvalidReceiver();
    error InvalidSender();
    error InvalidVoucher();
    error WithdrawalExceedsBalance();

    event ChannelClosed(bytes32 indexed channelId, uint256 senderRefund, uint256 receiverWithdrawn);
    event ChannelClosingInitiated(bytes32 indexed channelId, uint256 timestamp);
    event ChannelOpened(bytes32 indexed channelId, address indexed sender, address indexed receiver, uint256 deposit);
    event VoucherRedeemed(bytes32 indexed channelId, uint256 amount, uint256 nonce);

    function CHALLENGE_PERIOD() external view returns (uint256);
    function channels(bytes32 channelId) external view returns (address sender, address receiver, uint256 deposit, uint256 withdrawn, uint256 lastNonce, ChannelStatus status, uint256 closingStartedAt);
    function finalizeClose(bytes32 channelId) external;
    function initiateClose(bytes32 channelId) external;
    function openChannel(address receiver) external payable returns (bytes32 channelId);
    function owner() external view returns (address);
    function redeemVoucher(bytes32 channelId, uint256 amount, uint256 nonce, bytes calldata signature) external;
    function usedVouchers(bytes32 voucherHash) external view returns (bool);
}

contract PaymentChannel is IPaymentChannel, Ownable {
    uint256 public constant CHALLENGE_PERIOD = 1 days;

    mapping(bytes32 => Channel) public channels;
    mapping(bytes32 => bool) public usedVouchers;

    constructor() Ownable(msg.sender) {}

    receive() external payable {}

    function openChannel(address receiver) external payable returns (bytes32 channelId) {
        if (receiver == address(0)) revert InvalidReceiver();
        if (msg.value == 0) revert InvalidDeposit();

        channelId = keccak256(abi.encodePacked(msg.sender, receiver, block.timestamp, msg.value));
        if (channels[channelId].sender != address(0)) revert ChannelExists();

        channels[channelId] = Channel({
            sender: msg.sender,
            receiver: receiver,
            deposit: msg.value,
            withdrawn: 0,
            lastNonce: 0,
            status: ChannelStatus.Open,
            closingStartedAt: 0
        });

        emit ChannelOpened(channelId, msg.sender, receiver, msg.value);
    }

    function redeemVoucher(bytes32 channelId, uint256 amount, uint256 nonce, bytes calldata signature) external {
        Channel storage channel = channels[channelId];
        if (channel.sender == address(0)) revert ChannelNotFound();
        if (channel.status != ChannelStatus.Open && channel.status != ChannelStatus.Closing) revert ChannelNotOpen();
        if (nonce <= channel.lastNonce) revert InvalidVoucher();
        if (amount > channel.deposit - channel.withdrawn) revert InsufficientChannelBalance();

        bytes32 voucherHash = keccak256(abi.encodePacked(channelId, amount, nonce));
        if (usedVouchers[voucherHash]) revert InvalidVoucher();

        address signer = ECDSA.recover(MessageHashUtils.toEthSignedMessageHash(voucherHash), signature);
        if (signer != channel.sender) revert InvalidSender();

        usedVouchers[voucherHash] = true;
        channel.lastNonce = nonce;
        channel.withdrawn += amount;

        (bool success, ) = channel.receiver.call{value: amount}("");
        if (!success) revert WithdrawalExceedsBalance();

        emit VoucherRedeemed(channelId, amount, nonce);
    }

    function initiateClose(bytes32 channelId) external {
        Channel storage channel = channels[channelId];
        if (channel.sender == address(0)) revert ChannelNotFound();
        if (channel.status != ChannelStatus.Open) revert ChannelNotOpen();

        channel.status = ChannelStatus.Closing;
        channel.closingStartedAt = block.timestamp;

        emit ChannelClosingInitiated(channelId, block.timestamp);
    }

    function finalizeClose(bytes32 channelId) external {
        Channel storage channel = channels[channelId];
        if (channel.sender == address(0)) revert ChannelNotFound();
        if (channel.status != ChannelStatus.Closing) revert ChannelNotClosing();
        if (block.timestamp < channel.closingStartedAt + CHALLENGE_PERIOD) revert ChallengePeriodNotExpired();

        uint256 remaining = channel.deposit - channel.withdrawn;
        channel.status = ChannelStatus.Closed;

        (bool success, ) = channel.sender.call{value: remaining}("");
        if (!success) revert AlreadyClosed();

        emit ChannelClosed(channelId, remaining, channel.withdrawn);
    }

}
