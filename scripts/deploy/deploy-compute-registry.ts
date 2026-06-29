import sdk from 'casper-js-sdk';
import { readFileSync } from 'fs';

const RPC_URL = 'http://localhost:7778/rpc';
const CHAIN_NAME = 'casper-test';

const key = sdk.PrivateKey.fromPem(readFileSync('/tmp/casper-wallet/Account 1_secret_key.pem', 'utf-8'), sdk.KeyAlgorithm.SECP256K1);
const client = new sdk.RpcClient(new sdk.HttpHandler(RPC_URL));
const accountHash = key.publicKey.accountHash().toPrefixedString();

console.log('Account:', accountHash);

const wasmBytes = new Uint8Array(readFileSync('contracts-casper/target/wasm32v1-none/release/compute_registry.wasm'));
const args = sdk.Args.fromMap({
  owner: sdk.CLValue.newCLByteArray(key.publicKey.accountHash().hashBytes),
  fee_recipient: sdk.CLValue.newCLByteArray(key.publicKey.accountHash().hashBytes),
  minimum_stake: sdk.CLValue.newCLUInt512('1000000000'),
});

const session = sdk.ExecutableDeployItem.newModuleBytes(wasmBytes, args);
const paymentItem = sdk.ExecutableDeployItem.standardPayment('100000000000');
const header = sdk.DeployHeader.default();
header.account = key.publicKey;
header.chainName = CHAIN_NAME;
const deploy = sdk.Deploy.makeDeploy(header, paymentItem, session);
deploy.sign(key);

const result = await client.putDeploy(deploy);
console.log('Deploy hash:', result.deployHash.toHex());
console.log('Explorer: https://testnet.cspr.live/deploy/' + result.deployHash.toHex());
console.log('Waiting for execution...');
