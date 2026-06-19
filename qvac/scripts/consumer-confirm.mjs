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

const CONTRACT_HASH = 'b3f8b9643cc190448139525491b3196df072e30c703610261336bb97202b5e27';

async function main() {
  const privateKey = PrivateKey.fromPem(PEM, KeyAlgorithm.SECP256K1);
  const publicKey = privateKey.publicKey;
  
  const jobId = process.argv[2] || 'job:e39ac4daa9a8fe88d9f074cecfd537d18eb0fbf1196c1b4dd85749bcc50723e9:0';
  
  const argsMap = {
    job_id: CLValue.newCLString(jobId),
    rating: CLValue.newCLUint64('5'),
  };
  
  const args = Args.fromMap(argsMap);
  const contractHashObj = sdk.ContractHash.newContract(CONTRACT_HASH);
  const storedContract = new sdk.StoredContractByHash(contractHashObj, 'consumer_confirm', args);
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
