import sdk from 'casper-js-sdk';
import { readFileSync } from 'fs';

const pem = readFileSync('/tmp/Account 1_secret_key.pem', 'utf-8');
const key = sdk.PrivateKey.fromPem(pem, sdk.KeyAlgorithm.SECP256K1);
const myAccountHash = key.publicKey.accountHash().toPrefixedString();

const CONTRACTS = {
  computeRegistry: 'f8c969bfa7553a23deab0f77fb43210d4810156a977e0cc2695b23182e5b41d0',
  reputation: 'fd0bf02161433c13c3070b7d0ea383c976bcbc799413638b4fedc703d4efa1db',
};

function accountHashToBytes(hashStr) {
  const hex = hashStr.replace('account-hash-', '');
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

const args = sdk.Args.fromMap({
  compute_registry: sdk.CLValue.newCLByteArray(accountHashToBytes(CONTRACTS.computeRegistry)),
  reputation: sdk.CLValue.newCLByteArray(accountHashToBytes(CONTRACTS.reputation)),
  owner: sdk.CLValue.newCLByteArray(accountHashToBytes(myAccountHash)),
  protocol_fee_recipient: sdk.CLValue.newCLByteArray(accountHashToBytes(myAccountHash)),
});

const wasmPath = '/home/user/CascadeProjects/chimera-fortytwo-node/contracts-casper/target/wasm32-unknown-unknown/release/escrow_vault.wasm';
const wasmBytes = new Uint8Array(readFileSync(wasmPath));

const session = sdk.ExecutableDeployItem.newModuleBytes(wasmBytes, args);
const payment = sdk.ExecutableDeployItem.standardPayment('10000000000');

const header = sdk.DeployHeader.default();
header.account = key.publicKey;
header.chainName = 'casper-test';

const deploy = sdk.Deploy.makeDeploy(header, payment, session);
deploy.sign(key);

console.log('Deploy hash:', deploy.hash.toHex());

const RPC = process.env.RPC_URL || 'https://rpc.testnet.casper.network/rpc';
const client = new sdk.RpcClient(new sdk.HttpHandler(RPC));
const result = await client.putDeploy(deploy);
console.log('putDeploy result:', result.deployHash.toHex());

console.log('Waiting for execution...');
for (let i = 0; i < 120; i++) {
  await new Promise(r => setTimeout(r, 5000));
  try {
    const info = await client.getDeploy(deploy.hash.toHex());
    if (info.deploy?.executionInfo) {
      const ei = info.deploy.executionInfo;
      console.log('Executed at block:', ei.blockHeight);
      const er = ei.executionResult?.Version2;
      if (er) {
        console.log('Error:', er.errorMessage || 'None');
        console.log('Consumed:', er.consumed);
      }
      console.log('');
      console.log('UPDATE this hash in frontend/src/casper-client.ts:');
      console.log('  escrowVault: "<NEW_HASH>"');
      break;
    }
  } catch {}
}
