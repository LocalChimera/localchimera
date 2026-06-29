import { readFileSync } from 'fs';
import sdk from 'casper-js-sdk';

const CHAIN_NAME = 'casper-test';
const RPC_URL = 'http://localhost:7778/rpc';
const PAYMENT = '5000000000';

const key = sdk.PrivateKey.fromPem(readFileSync('/tmp/casper-wallet/Account 1_secret_key.pem', 'utf-8'), sdk.KeyAlgorithm.SECP256K1);
const client = new sdk.RpcClient(new sdk.HttpHandler(RPC_URL));

const wasmBytes = readFileSync('/tmp/cleanup.wasm');
const session = sdk.ExecutableDeployItem.newModuleBytes(wasmBytes, sdk.Args.fromMap({}));
const payment = sdk.ExecutableDeployItem.standardPayment(PAYMENT);
const header = sdk.DeployHeader.default();
header.account = key.publicKey;
header.chainName = CHAIN_NAME;
header.timestamp = new Date() as any;

const deploy = sdk.Deploy.makeDeploy(header, payment, session);
deploy.sign(key);

const result = await client.putDeploy(deploy);
const deployHash = result.deployHash.toHex();
console.log('Cleanup deploy hash:', deployHash);
console.log('Explorer: https://testnet.cspr.live/deploy/' + deployHash);

console.log('Waiting...');
for (let i = 0; i < 30; i++) {
  await new Promise(r => setTimeout(r, 5000));
  try {
    const res = await client.getDeploy(sdk.DeployHash.fromHex(deployHash));
    const v2 = res.executionInfo?.executionResult?.Version2;
    if (v2) {
      if (v2.errorMessage) {
        console.error('Cleanup failed:', v2.errorMessage);
        process.exit(1);
      }
      console.log('Cleanup succeeded!');
      process.exit(0);
    }
  } catch {}
}
console.log('Timed out waiting');
