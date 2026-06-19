import pkg from 'casper-js-sdk';
const sdk = pkg;
const { PrivateKey, KeyAlgorithm, CLValue, Args, ExecutableDeployItem, DeployHeader, Deploy } = sdk;

const RPC_URL = 'http://localhost:7778/rpc';
const CHAIN_NAME = 'casper-test';

const PEM = `-----BEGIN EC PRIVATE KEY-----
MHQCAQEEIA6Hjhvhzz4rc5cKlR3fOtI42H8E1VOqpdpe6P/Nc7qvoAcGBSuBBAAK
oUQDQgAEJ9jdXMqmAORbNuWY2Q74wmtsZ++Bvf696PpYOZepHqWCFmTFZDzW+JYO
fZf7vQid4otudHLFJBWkiazcayJz9g==
-----END EC PRIVATE KEY-----`;

const CONTRACT_HASH = '0a8ec17ba7e8e2992b2d726675cc0c91850a9fac28667b288a34e7cee4239e5d';
const CONTRACT_PURSE = 'uref-33418da0d442412e7513ee1660493282efdb47a3fd95a5ec7420ef7b5b18654f-007';

function hexToBytes(hex) {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

async function main() {
  const privateKey = PrivateKey.fromPem(PEM, KeyAlgorithm.SECP256K1);
  const publicKey = privateKey.publicKey;
  const accountHashHex = publicKey.accountHash().toHex();

  // Use a session contract that transfers to the contract purse and then calls create_job
  const wasmBytes = (await import('fs')).readFileSync('/tmp/escrow_vault_final.wasm');

  // Actually we need a custom session contract for this.
  // For now, let's just use a simpler approach: call create_job first (it just writes state),
  // then do a native transfer to the contract purse.
  // But native transfer to URef doesn't work easily in SDK.
  // Let's just call create_job and manually fund the contract purse using the bridge or another mechanism.
  console.log('Contract hash:', CONTRACT_HASH);
  console.log('Contract purse:', CONTRACT_PURSE);

  // Step 1: create_job (just writes state)
  const argsMap = {
    consumer: CLValue.newCLByteArray(hexToBytes(accountHashHex)),
    provider: CLValue.newCLByteArray(hexToBytes('f227d4fb7c50164d363c5461ad0044ef8f3b8ad5ee7072b87384e101a2a4263d')),
    amount: CLValue.newCLUInt512('1000'),
    provider_fee_bps: CLValue.newCLUint64('100'),
    order_id: CLValue.newCLString('test-job-7'),
  };

  const args = Args.fromMap(argsMap);
  const contractHashObj = sdk.ContractHash.newContract(CONTRACT_HASH);
  const storedContract = new sdk.StoredContractByHash(contractHashObj, 'create_job', args);
  const session = new ExecutableDeployItem();
  session.storedContractByHash = storedContract;
  const payment = ExecutableDeployItem.standardPayment('10000000000');
  const header = DeployHeader.default();
  header.account = publicKey;
  header.chainName = CHAIN_NAME;
  const deploy = Deploy.makeDeploy(header, payment, session);
  deploy.sign(privateKey);

  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1,
      method: 'account_put_deploy',
      params: { deploy: Deploy.toJSON(deploy) }
    })
  });
  const data = await res.json();
  console.log('create_job result:', JSON.stringify(data, null, 2));
}

main().catch(console.error);
