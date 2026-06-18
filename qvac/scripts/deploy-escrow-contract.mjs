import { readFileSync } from 'fs';
import pkg from 'casper-js-sdk';
const sdk = pkg;
const { PrivateKey, KeyAlgorithm, CLValue, Args, DeployHeader, ExecutableDeployItem, Deploy } = sdk;

const WASM_PATH = '/tmp/escrow_vault_fixed2.wasm';
const RPC_URL = 'http://localhost:7778/rpc';
const CHAIN_NAME = 'casper-test';

const PEM = `-----BEGIN EC PRIVATE KEY-----
MHQCAQEEIA6Hjhvhzz4rc5cKlR3fOtI42H8E1VOqpdpe6P/Nc7qvoAcGBSuBBAAK
oUQDQgAEJ9jdXMqmAORbNuWY2Q74wmtsZ++Bvf696PpYOZepHqWCFmTFZDzW+JYO
fZf7vQid4otudHLFJBWkiazcayJz9g==
-----END EC PRIVATE KEY-----`;

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

async function deploy() {
  const privateKey = PrivateKey.fromPem(PEM, KeyAlgorithm.SECP256K1);
  const publicKey = privateKey.publicKey;
  const deployerAccount = publicKey.accountHash().toHex();
  const userAccount = 'e39ac4daa9a8fe88d9f074cecfd537d18eb0fbf1196c1b4dd85749bcc50723e9';

  console.log('Deployer account:', deployerAccount);
  console.log('Contract owner will be:', userAccount);

  const wasmBytes = readFileSync(WASM_PATH);
  console.log('WASM size:', wasmBytes.length, 'bytes');

  const args = Args.fromMap({
    compute_registry: CLValue.newCLByteArray(accountHashToBytes(CONTRACTS.computeRegistry)),
    reputation: CLValue.newCLByteArray(accountHashToBytes(CONTRACTS.reputation)),
    owner: CLValue.newCLByteArray(accountHashToBytes(userAccount)),
    protocol_fee_recipient: CLValue.newCLByteArray(accountHashToBytes(userAccount)),
  });

  const header = DeployHeader.default();
  header.account = publicKey;
  header.chainName = CHAIN_NAME;

  const session = ExecutableDeployItem.newModuleBytes(wasmBytes, args);
  const payment = ExecutableDeployItem.standardPayment('500000000000');
  const deploy = Deploy.makeDeploy(header, payment, session);
  deploy.sign(privateKey);

  const deployJSON = Deploy.toJSON(deploy);

  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'account_put_deploy', params: { deploy: deployJSON } }),
  }).then(r => r.json());

  if (res.error) {
    console.error('Deploy failed:', res.error);
    process.exit(1);
  }

  console.log('Deploy submitted! Hash:', res.result.deploy_hash);
}

deploy().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
