import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import sdk from 'casper-js-sdk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CHAIN_NAME = 'casper-test';
const RPC_URL = 'https://node.testnet.casper.network/rpc';
const PAYMENT = '50000000000'; // 50 CSPR
const WASM_DIR = join(__dirname, '../contracts-casper/target/wasm32-unknown-unknown/release');

function loadKey() {
  const pemPath = process.env.CSPR_PEM_PATH || '/tmp/casper-keys/Account 1_secret_key.pem';
  const pem = readFileSync(pemPath, 'utf-8');
  return sdk.PrivateKey.fromPem(pem, sdk.KeyAlgorithm.SECP256K1);
}

async function main() {
  const key = loadKey();
  const client = new sdk.RpcClient(new sdk.HttpHandler(RPC_URL));
  const accountHash = key.publicKey.accountHash().toPrefixedString();
  console.log('Deploying from account:', accountHash);

  const wasmPath = join(WASM_DIR, 'compute_registry.wasm');
  const wasmBytes = new Uint8Array(readFileSync(wasmPath));
  const args = sdk.Args.fromMap({
    owner: sdk.CLValue.newCLByteArray(key.publicKey.accountHash().hashBytes),
    fee_recipient: sdk.CLValue.newCLByteArray(key.publicKey.accountHash().hashBytes),
    minimum_stake: sdk.CLValue.newCLUInt512('1000000000000000000'),
  });

  // Build session item using buildFor1_5 (with .from() set)
  const sessionItem = new sdk.SessionBuilder()
    .from(key.publicKey)
    .wasm(wasmBytes)
    .installOrUpgrade()
    .runtimeArgs(args)
    .buildFor1_5();

  // Create payment item
  const paymentItem = sdk.ExecutableDeployItem.standardPayment(PAYMENT);

  // Create deploy header
  const header = sdk.DeployHeader.default();
  header.account = key.publicKey;
  header.timestamp = sdk.Timestamp.from(new Date());
  header.ttl = sdk.TTL.from('30m');
  header.chainName = CHAIN_NAME;
  header.gasPrice = 1;
  header.dependencies = [];

  // Create deploy
  const deploy = sdk.Deploy.makeDeploy(header, paymentItem, sessionItem);
  deploy.sign(key);

  // Convert to Transaction
  const tx = sdk.Transaction.fromDeploy(deploy);
  tx.sign(key);

  console.log('Transaction hash:', tx.hash.toHex());

  // Send via putTransaction
  const result = await client.putTransaction(tx);
  console.log('Result type:', result.constructor.name);
  console.log('Result keys:', Object.keys(result));

  // Wait
  const txHash = result.transactionHash.toHex();
  console.log('Waiting for', txHash);
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 5000));
    try {
      const info = await client.getTransaction(txHash);
      if (info.transaction?.executionInfo) {
        console.log('Executed!');
        return;
      }
    } catch {}
  }
  console.log('Did not execute');
}

main().catch(e => {
  console.error('Error:', e.message);
  console.error(e.stack);
  process.exit(1);
});
