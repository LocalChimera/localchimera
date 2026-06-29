import { readFileSync } from 'fs';
import { join } from 'path';
import sdk from 'casper-js-sdk';

const key = sdk.PrivateKey.fromPem(readFileSync('/tmp/casper-wallet/Account 1_secret_key.pem', 'utf-8'), sdk.KeyAlgorithm.SECP256K1);
const owner = sdk.CLValue.newCLByteArray(key.publicKey.accountHash().hashBytes);
const args = sdk.Args.fromMap({
  owner,
  fee_recipient: owner,
  minimum_stake: sdk.CLValue.newCLUInt512('1000000000'),
});

console.log('Args.fromMap result type:', args?.constructor?.name);
console.log('Args keys:', Object.keys(args.args || {}));
console.log('args.args:', JSON.stringify(args.args));

const wasm = readFileSync(join(process.cwd(), 'contracts-casper/target/wasm32v1-none/release/compute_registry.wasm'));
const session = sdk.ExecutableDeployItem.newModuleBytes(wasm, args);
const payment = sdk.ExecutableDeployItem.standardPayment('50000000000');
const header = sdk.DeployHeader.default();
header.account = key.publicKey;
header.chainName = 'casper-test';

const deploy = sdk.Deploy.makeDeploy(header, payment, session);
const json = sdk.Deploy.toJSON(deploy);
console.log('Session args count:', json.session?.ModuleBytes?.args?.length);
const arg2 = json.session?.ModuleBytes?.args?.[2];
console.log('Arg 2:', JSON.stringify(arg2));

// Try number-based U512
const argsNum = sdk.Args.fromMap({
  owner,
  fee_recipient: owner,
  minimum_stake: sdk.CLValue.newCLUInt512(1000000000),
});
const sessionNum = sdk.ExecutableDeployItem.newModuleBytes(wasm, argsNum);
const deployNum = sdk.Deploy.makeDeploy(header, payment, sessionNum);
const jsonNum = sdk.Deploy.toJSON(deployNum);
console.log('Arg 2 (number) parsed:', jsonNum.session?.ModuleBytes?.args?.[2]?.[1]?.parsed);
console.log('Arg 2 (number) bytes:', jsonNum.session?.ModuleBytes?.args?.[2]?.[1]?.bytes);
