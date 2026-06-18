import pkg from 'casper-js-sdk';
const sdk = pkg;
const { PrivateKey, KeyAlgorithm, CLValue, Args, DeployHeader, ExecutableDeployItem, Deploy } = sdk;

const RPC_URL = 'http://localhost:7778/rpc';
const CHAIN_NAME = 'casper-test';

const PEM = `-----BEGIN EC PRIVATE KEY-----
MHQCAQEEIA6Hjhvhzz4rc5cKlR3fOtI42H8E1VOqpdpe6P/Nc7qvoAcGBSuBBAAK
oUQDQgAEJ9jdXMqmAORbNuWY2Q74wmtsZ++Bvf696PpYOZepHqWCFmTFZDzW+JYO
fZf7vQid4otudHLFJBWkiazcayJz9g==
-----END EC PRIVATE KEY-----`;

const CONTRACT_HASH = 'f813e6c77b9e4b60e0b78cebe2f7c412a1478e5a82f078413ac26c6f0521eb72';
const ESCROW_ACCOUNT = '7e00d7dd02ea921ad3271811d6c0f8928f2e83d91c6f4a5b89048e23683cdf6c';

function hexToBytes(hex) {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

async function main() {
  const privateKey = PrivateKey.fromPem(PEM, KeyAlgorithm.SECP256K1);
  const publicKey = privateKey.publicKey;
  const accountHashHex = publicKey.accountHash().toHex();
  
  console.log('Account hash:', accountHashHex);
  console.log('Escrow account:', ESCROW_ACCOUNT);
  console.log('Contract hash:', CONTRACT_HASH);
  
  const argsMap = {
    consumer: CLValue.newCLByteArray(hexToBytes(accountHashHex)),
    provider: CLValue.newCLByteArray(hexToBytes('f227d4fb7c50164d363c5461ad0044ef8f3b8ad5ee7072b87384e101a2a4263d')),
    amount: CLValue.newCLUInt512('1000'),
    provider_fee_bps: CLValue.newCLUint64('100'),
    order_id: CLValue.newCLString('test-job-5'),
    escrow_account: CLValue.newCLByteArray(hexToBytes(ESCROW_ACCOUNT)),
    contract_hash: CLValue.newCLByteArray(hexToBytes(CONTRACT_HASH)),
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
  
  const deployResult = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'account_put_deploy',
      params: { deploy: Deploy.toJSON(deploy) }
    })
  });
  const deployData = await deployResult.json();
  console.log('Deploy result:', JSON.stringify(deployData, null, 2));
}

main().catch(console.error);
