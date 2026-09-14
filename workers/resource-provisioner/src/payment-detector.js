import { createPublicClient, http, parseAbi } from 'viem';
import { robinhoodChain } from './contracts/chain.js';

const ESCROW_CHANNEL_ADDRESS = process.env.ESCROW_CHANNEL_ADDRESS;
const RPC_URL = process.env.RPC_URL || 'https://rpc.mainnet.chain.robinhood.com';

const client = createPublicClient({
  chain: robinhoodChain,
  transport: http(RPC_URL),
});

const escrowAbi = parseAbi([
  'function getChannel(bytes32 channelId) view returns (address sender, address recipient, uint256 balance, uint256 withdrawn, uint256 closedAt)',
  'function voucherValue(bytes32 channelId, uint256 amount, uint256 nonce, bytes signature) view returns (bool valid)',
  'function isClosed(bytes32 channelId) view returns (bool)',
]);

export async function verifyPayment(channelId, voucher) {
  const channel = await client.readContract({
    address: ESCROW_CHANNEL_ADDRESS,
    abi: escrowAbi,
    functionName: 'getChannel',
    args: [channelId],
  });

  const closed = await client.readContract({
    address: ESCROW_CHANNEL_ADDRESS,
    abi: escrowAbi,
    functionName: 'isClosed',
    args: [channelId],
  });

  if (closed) {
    return { paid: false, state: 'closed', balance: '0', expectedAmount: '0', txHash: null };
  }

  const [, , balance, withdrawn] = channel;
  const available = BigInt(balance) - BigInt(withdrawn);

  if (voucher) {
    const valid = await client.readContract({
      address: ESCROW_CHANNEL_ADDRESS,
      abi: escrowAbi,
      functionName: 'voucherValue',
      args: [channelId, voucher.amount, voucher.nonce, voucher.signature],
    });

    if (!valid) {
      return { paid: false, state: 'invalid_voucher', balance: available.toString(), expectedAmount: voucher.amount, txHash: null };
    }

    return {
      paid: available >= BigInt(voucher.amount),
      state: 'voucher_valid',
      balance: available.toString(),
      expectedAmount: voucher.amount,
      txHash: null,
    };
  }

  return {
    paid: available > 0n,
    state: 'funded',
    balance: available.toString(),
    expectedAmount: '0',
    txHash: null,
  };
}
