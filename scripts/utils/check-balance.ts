import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const configPath = join(__dirname, '../config/chimera-testnet.json');
const config = JSON.parse(readFileSync(configPath, 'utf-8'));

const rpcUrl = process.env.CHIMERA_RPC_URL || config.rpcUrl;
const provider = new ethers.JsonRpcProvider(rpcUrl);
const address = config.operatorAddress;

async function main() {
  console.log('RPC:', rpcUrl);
  console.log('Address:', address);
  try {
    const balance = await provider.getBalance(address);
    const nonce = await provider.getTransactionCount(address);
    const network = await provider.getNetwork();
    console.log('Balance:', ethers.formatEther(balance), 'ETH');
    console.log('Nonce:', nonce);
    console.log('Chain ID:', Number(network.chainId));
  } catch (err: any) {
    console.error('Error:', err.message || err);
  }
}

main();
