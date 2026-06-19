import { readFileSync, writeFileSync } from 'fs';
import pkg from 'casper-js-sdk';
const sdk = pkg;
const { PrivateKey, KeyAlgorithm, CLValue, Args, DeployHeader, ExecutableDeployItem, Deploy } = sdk;

const WASM_PATH = '/tmp/escrow_vault_final.wasm';
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
  const payment = ExecutableDeployItem.standardPayment('50000000000');
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
  const deployHash = res.result.deploy_hash;

  console.log('Waiting for execution...');
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const infoRes = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1,
        method: 'info_get_deploy',
        params: { deploy_hash: deployHash }
      }),
    }).then(r => r.json());
    const execution_result = infoRes.result?.execution_info?.execution_result;
    if (execution_result?.Version2) {
      const v2 = execution_result.Version2;
      if (v2.error_message) {
        console.error('Deploy failed:', v2.error_message);
        process.exit(1);
      }
      console.log('Deploy executed successfully!');
      break;
    }
  }

  // Query account entity for new contract hash
  const entityRes = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1,
      method: 'state_get_entity',
      params: { entity_identifier: { AccountHash: 'account-hash-' + deployerAccount } },
    }),
  }).then(r => r.json());

  const keys = entityRes.result?.addressable_entity?.Account?.named_keys || [];
  const nk = keys.find((k) => k.name === 'escrow_vault_hash');
  if (nk) {
    const hash = nk.key.replace('hash-', '');
    console.log('\n=== NEW ESCROW VAULT CONTRACT HASH ===');
    console.log(hash);
    console.log('=======================================\n');
  } else {
    console.error('Could not find escrow_vault_hash in named keys');
    console.log('Named keys:', JSON.stringify(keys, null, 2));
  }
}

deploy().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
