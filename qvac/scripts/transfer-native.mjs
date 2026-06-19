import pkg from 'casper-js-sdk';
const sdk = pkg;

const RPC_URL = 'http://localhost:7778/rpc';
const CHAIN_NAME = 'casper-test';

const PROVIDER_PEM = `-----BEGIN EC PRIVATE KEY-----
MHQCAQEEIBJLNm8sYi/pVIcbF2soCZTxr9wO3EGtlEtkA2X5bOQvoAcGBSuBBAAK
oUQDQgAE7jl1qDI712D51EeKgfIZ974LmOYjjwkjQ3mHFrpLpL/mbwQ7mz/zmBjf
Rm6VsWCs2wbZAkjyLfzmUUrmzvWIhQ==
-----END EC PRIVATE KEY-----`;

const CONSUMER_PEM = `-----BEGIN EC PRIVATE KEY-----
MHQCAQEEIA6Hjhvhzz4rc5cKlR3fOtI42H8E1VOqpdpe6P/Nc7qvoAcGBSuBBAAK
oUQDQgAEJ9jdXMqmAORbNuWY2Q74wmtsZ++Bvf696PpYOZepHqWCFmTFZDzW+JYO
fZf7vQid4otudHLFJBWkiazcayJz9g==
-----END EC PRIVATE KEY-----`;

async function main() {
  const key = sdk.PrivateKey.fromPem(CONSUMER_PEM, sdk.KeyAlgorithm.SECP256K1);
  const providerKey = sdk.PrivateKey.fromPem(PROVIDER_PEM, sdk.KeyAlgorithm.SECP256K1);

  const deploy = sdk.makeCsprTransferDeploy({
    senderPublicKeyHex: key.publicKey.toHex(),
    recipientPublicKeyHex: providerKey.publicKey.toHex(),
    transferAmount: '2500000000',
    paymentAmount: '100000000',
    chainName: CHAIN_NAME,
  });

  deploy.sign(key);

  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1,
      method: 'account_put_deploy',
      params: { deploy: sdk.Deploy.toJSON(deploy) }
    })
  });
  const data = await res.json();
  console.log('Result:', JSON.stringify(data, null, 2));
}

main().catch(console.error);
