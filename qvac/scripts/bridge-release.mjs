import { readFileSync } from 'fs';
import pkg from 'casper-js-sdk';
const sdk = pkg;
const { PrivateKey, KeyAlgorithm, CLValue, Args, DeployHeader, ExecutableDeployItem, Deploy } = sdk;

const RPC_URL = 'http://localhost:7778/rpc';
const CHAIN_NAME = 'casper-test';
const ESCROW_PEM_PATH = '/tmp/escrow-account.pem';

const CONTRACT_HASH = 'b3f8b9643cc190448139525491b3196df072e30c703610261336bb97202b5e27';

function hexToBytes(hex) {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

async function getJobState(jobId) {
  const argsMap = {
    job_id: CLValue.newCLString(jobId),
  };
  const args = Args.fromMap(argsMap);
  const contractHashObj = sdk.ContractHash.newContract(CONTRACT_HASH);
  const storedContract = new sdk.StoredContractByHash(contractHashObj, 'get_job', args);
  const session = new ExecutableDeployItem();
  session.storedContractByHash = storedContract;
  const payment = ExecutableDeployItem.standardPayment('10000000000');

  const privateKey = PrivateKey.fromPem(readFileSync(ESCROW_PEM_PATH, 'utf8'), KeyAlgorithm.SECP256K1);
  const publicKey = privateKey.publicKey;
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
  if (deployData.error) {
    console.error('get_job deploy failed:', deployData.error);
    return null;
  }

  const deployHash = deployData.result.deploy_hash;
  console.log('get_job deploy hash:', deployHash);

  // Wait for execution
  await new Promise(r => setTimeout(r, 20000));

  const infoRes = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'info_get_deploy',
      params: { deploy_hash: deployHash }
    })
  });
  const infoData = await infoRes.json();
  const execution_result = infoData.result?.execution_info?.execution_result;
  if (execution_result?.Version2) {
    const v2 = execution_result.Version2;
    console.log('get_job error:', v2.error_message);
    // Look for return value in effects (not directly available, need to parse)
    // For now we rely on dictionary queries or direct state inspection
    return { error: v2.error_message, deployHash };
  }
  return null;
}

async function transferToProvider(providerAccountHash, amount) {
  const privateKey = PrivateKey.fromPem(readFileSync(ESCROW_PEM_PATH, 'utf8'), KeyAlgorithm.SECP256K1);
  const publicKey = privateKey.publicKey;

  const args = Args.fromMap({
    target: CLValue.newCLByteArray(hexToBytes(providerAccountHash)),
    amount: CLValue.newCLUInt512(amount),
    id: CLValue.newCLOption(null, CLType.U64),
  });

  // Use a native transfer deploy instead of session code
  const header = DeployHeader.default();
  header.account = publicKey;
  header.chainName = CHAIN_NAME;

  // Native transfer: no session code, just transfer args in payment? No...
  // Actually for native transfer we need to use a specific approach
  // Casper SDK allows native transfers via Deploy.makeTransferDeploy or similar
  // But casper-js-sdk v2 might use Deploy.makeDeploy with transfer args

  // Let's use a simpler approach: StoredContractByHash call to mark_released,
  // and a separate native transfer deploy

  // For native transfer, use the Deploy constructor with transfer info
  // Actually casper-js-sdk doesn't have a simple native transfer in v2
  // We'll use a workaround: create a StoredContractByName or just use standard session

  // Actually the simplest is to create a small session deploy that calls transfer
  // But for now, let's use a module bytes deploy with minimal code
  // Or better: use the SDK's transfer support if available

  console.log('Provider transfer would go to:', providerAccountHash, 'amount:', amount);
  // TODO: implement actual transfer
  return null;
}

async function markReleased(jobId, providerPayout) {
  const privateKey = PrivateKey.fromPem(readFileSync(ESCROW_PEM_PATH, 'utf8'), KeyAlgorithm.SECP256K1);
  const publicKey = privateKey.publicKey;

  const argsMap = {
    job_id: CLValue.newCLString(jobId),
    provider_payout: CLValue.newCLUInt512(providerPayout),
  };
  const args = Args.fromMap(argsMap);
  const contractHashObj = sdk.ContractHash.newContract(CONTRACT_HASH);
  const storedContract = new sdk.StoredContractByHash(contractHashObj, 'mark_released', args);
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
  return await deployResult.json();
}

async function main() {
  const jobId = process.argv[2];
  if (!jobId) {
    console.error('Usage: node bridge-release.mjs <job_id>');
    process.exit(1);
  }

  console.log('Releasing funds for job:', jobId);
  console.log('Escrow PEM path:', ESCROW_PEM_PATH);

  // Step 1: Query job state via get_job
  // Note: get_job returns a string, but we can't easily parse it from deploy effects
  // For now we use direct dictionary queries instead

  // Step 2: Call mark_released (requires escrow caller)
  // We need to know provider_payout. For now use hardcoded or query from dictionaries.
  const providerPayout = '900'; // placeholder - should compute from job amount - fee

  console.log('Calling mark_released with payout:', providerPayout);
  const result = await markReleased(jobId, providerPayout);
  console.log('mark_released result:', JSON.stringify(result, null, 2));
}

main().catch(console.error);
