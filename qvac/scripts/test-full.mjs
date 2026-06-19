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

  console.log('Account hash:', accountHashHex);
  console.log('Contract hash:', CONTRACT_HASH);

  // Step 1: Transfer to contract purse using TransferDeployItem.newTransfer
  const transferPayment = ExecutableDeployItem.standardPayment('10000000000');
  const transferHeader = DeployHeader.default();
  transferHeader.account = publicKey;
  transferHeader.chainName = CHAIN_NAME;

  const transferDeployItem = sdk.TransferDeployItem.newTransfer(
    '2500000000',
    sdk.URef.fromString(CONTRACT_PURSE)
  );
  const transferSession = new ExecutableDeployItem();
  transferSession.transfer = transferDeployItem;

  const transferDeploy = Deploy.makeDeploy(transferHeader, transferPayment, transferSession);
  transferDeploy.sign(privateKey);

  const transferRes = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1,
      method: 'account_put_deploy',
      params: { deploy: Deploy.toJSON(transferDeploy) }
    })
  });
  const transferData = await transferRes.json();
  console.log('Transfer deploy result:', JSON.stringify(transferData, null, 2));

  if (transferData.error) {
    console.error('Transfer failed:', transferData.error);
    return;
  }

  // Wait for transfer
  console.log('Waiting for transfer execution...');
  await new Promise(r => setTimeout(r, 25000));

  const transferInfoRes = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1,
      method: 'info_get_deploy',
      params: { deploy_hash: transferData.result.deploy_hash }
    })
  });
  const transferInfo = await transferInfoRes.json();
  const transferExec = transferInfo.result?.execution_info?.execution_result?.Version2;
  console.log('Transfer execution:', transferExec?.error_message || 'SUCCESS');

  // Check contract purse balance
  const balanceRes = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1,
      method: 'query_balance',
      params: { purse_identifier: { purse_uref: CONTRACT_PURSE } }
    })
  });
  const balanceData = await balanceRes.json();
  console.log('Contract purse balance:', balanceData.result?.balance);

  // Step 2: Call create_job
  const argsMap = {
    consumer: CLValue.newCLByteArray(hexToBytes(accountHashHex)),
    provider: CLValue.newCLByteArray(hexToBytes('f227d4fb7c50164d363c5461ad0044ef8f3b8ad5ee7072b87384e101a2a4263d')),
    amount: CLValue.newCLUInt512('2500000000'),
    provider_fee_bps: CLValue.newCLUint64('100'),
    order_id: CLValue.newCLString('test-job-8'),
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

  if (data.error) {
    console.error('create_job failed:', data.error);
    return;
  }

  console.log('Waiting for create_job execution...');
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
  console.log('create_job execution:', exec?.error_message || 'SUCCESS');
}

main().catch(console.error);
