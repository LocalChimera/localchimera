import pkg from 'casper-js-sdk';
const sdk = pkg;
const { PrivateKey, KeyAlgorithm, CLValue, Args, ExecutableDeployItem, DeployHeader, Deploy } = sdk;

const RPC_URL = 'http://localhost:7778/rpc';
const CHAIN_NAME = 'casper-test';

const CONSUMER_PEM = `-----BEGIN EC PRIVATE KEY-----
MHQCAQEEIA6Hjhvhzz4rc5cKlR3fOtI42H8E1VOqpdpe6P/Nc7qvoAcGBSuBBAAK
oUQDQgAEJ9jdXMqmAORbNuWY2Q74wmtsZ++Bvf696PpYOZepHqWCFmTFZDzW+JYO
fZf7vQid4otudHLFJBWkiazcayJz9g==
-----END EC PRIVATE KEY-----`;

const PROVIDER_PEM = `-----BEGIN EC PRIVATE KEY-----
MHQCAQEEIBJLNm8sYi/pVIcbF2soCZTxr9wO3EGtlEtkA2X5bOQvoAcGBSuBBAAK
oUQDQgAE7jl1qDI712D51EeKgfIZ974LmOYjjwkjQ3mHFrpLpL/mbwQ7mz/zmBjf
Rm6VsWCs2wbZAkjyLfzmUUrmzvWIhQ==
-----END EC PRIVATE KEY-----`;

const CONTRACT_HASH = '0a8ec17ba7e8e2992b2d726675cc0c91850a9fac28667b288a34e7cee4239e5d';

async function callEntryPoint(pem, entryPoint, argsMap, jobId) {
  const privateKey = PrivateKey.fromPem(pem, KeyAlgorithm.SECP256K1);
  const publicKey = privateKey.publicKey;

  const args = Args.fromMap(argsMap);
  const contractHashObj = sdk.ContractHash.newContract(CONTRACT_HASH);
  const storedContract = new sdk.StoredContractByHash(contractHashObj, entryPoint, args);
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
  if (data.error) {
    console.error(`${entryPoint} submit failed:`, data.error);
    return null;
  }
  console.log(`${entryPoint} deploy hash:`, data.result.deploy_hash);

  await new Promise(r => setTimeout(r, 25000));

  const infoRes = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1,
      method: 'info_get_deploy',
      params: { deploy_hash: data.result.deploy_hash }
    })
  });
  const info = await infoRes.json();
  const exec = info.result?.execution_info?.execution_result?.Version2;
  const status = exec?.error_message || 'SUCCESS';
  console.log(`${entryPoint} execution:`, status);
  return status;
}

async function main() {
  const jobId = 'job:account-hash-e39ac4daa9a8fe88d9f074cecfd537d18eb0fbf1196c1b4dd85749bcc50723e9:0';

  console.log('=== Testing job lifecycle ===');
  console.log('Job ID:', jobId);

  // Step 1: provider_ack
  let status = await callEntryPoint(PROVIDER_PEM, 'provider_ack', {
    job_id: CLValue.newCLString(jobId),
  });
  if (status !== 'SUCCESS') return;

  // Step 2: provider_complete
  status = await callEntryPoint(PROVIDER_PEM, 'provider_complete', {
    job_id: CLValue.newCLString(jobId),
  });
  if (status !== 'SUCCESS') return;

  // Step 3: consumer_confirm
  status = await callEntryPoint(CONSUMER_PEM, 'consumer_confirm', {
    job_id: CLValue.newCLString(jobId),
  });
  if (status !== 'SUCCESS') return;

  // Step 4: claim_payment
  status = await callEntryPoint(PROVIDER_PEM, 'claim_payment', {
    job_id: CLValue.newCLString(jobId),
  });
  if (status !== 'SUCCESS') return;

  console.log('=== Full lifecycle completed successfully ===');
}

main().catch(console.error);
