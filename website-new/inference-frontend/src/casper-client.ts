// @ts-nocheck
import * as sdk from 'casper-js-sdk';

const RPC_URL = 'https://rpc.testnet.casper.network/rpc';
const CHAIN_NAME = 'casper-test';

export interface ContractConfig {
  computeRegistry: string;
  orderBook: string;
  escrowVault: string;
  reputation: string;
}

export const CONTRACTS: ContractConfig = {
  computeRegistry: 'f8c969bfa7553a23deab0f77fb43210d4810156a977e0cc2695b23182e5b41d0',
  orderBook: 'cecfc698508213f63e7e7fe6f0729b090af23c87c7e444db7fc90be73736e399',
  escrowVault: 'f9aa6606c892e4437a1664cfa9841864ab62000b2c53cb16c25d0f711d7ff38b',
  reputation: 'fd0bf02161433c13c3070b7d0ea383c976bcbc799413638b4fedc703d4efa1db',
};

let rpcClient: any = null;

function getClient(): any {
  if (!rpcClient) {
    rpcClient = new sdk.RpcClient(new sdk.HttpHandler(RPC_URL));
  }
  return rpcClient;
}

export async function getAccountBalance(publicKey: any): Promise<string> {
  try {
    const accountHash = publicKey.accountHash().toPrefixedString();
    // Use raw RPC since SDK v2 parameter mapping is broken for getLatestEntity
    const entityRes = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'state_get_entity',
        params: { entity_identifier: { AccountHash: accountHash } },
      }),
    }).then(r => r.json());

    if (entityRes.error) return 'Error: ' + entityRes.error.message;

    const mainPurse = entityRes.result?.addressable_entity?.Account?.main_purse;
    if (!mainPurse) return '0 CSPR';

    // Query purse balance
    const balanceRes = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'query_balance',
        params: { purse_identifier: { main_purse_under_account_hash: accountHash } },
      }),
    }).then(r => r.json());

    if (balanceRes.error) return 'Error: ' + balanceRes.error.message;
    console.log('[balance] query_balance result:', balanceRes.result);
    const balanceValue = balanceRes.result?.balance || '0';
    return (Number(balanceValue) / 1e9).toFixed(4) + ' CSPR';
  } catch (e: any) {
    return 'Error: ' + e.message;
  }
}

export async function getLatestBlockHash(): Promise<string> {
  const client = getClient();
  const res = await client.getLatestBlock();
  const block = res.block?.Version2 ?? res.block;
  return block.hash;
}

export async function queryContractNamedKeys(contractHash: string): Promise<{ name: string; key: string }[]> {
  try {
    const res = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'query_global_state',
        params: { key: `hash-${contractHash}` },
      }),
    }).then(r => r.json());
    if (res.error) { console.error('[namedKeys] query_global_state error:', res.error); return []; }
    const contract = res.result?.stored_value?.Contract;
    if (!contract) return [];
    return contract.named_keys.map((nk: any) => ({
      name: nk.name,
      key: nk.key,
    }));
  } catch (e: any) {
    console.error('[namedKeys] error:', e.message);
    return [];
  }
}

export async function getMinimumStake(contractHash: string): Promise<string> {
  try {
    const namedKeys = await queryContractNamedKeys(contractHash);
    const minStakeKey = namedKeys.find(nk => nk.name === 'minimum_stake');
    if (!minStakeKey) return '0';
    const res = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 5,
        method: 'query_global_state',
        params: { key: minStakeKey.key },
      }),
    }).then(r => r.json());
    if (res.error) return '0';
    const parsed = res.result?.stored_value?.CLValue?.parsed;
    return parsed || '0';
  } catch (e: any) {
    console.error('[minimumStake] error:', e.message);
    return '0';
  }
}

export function parsePemKey(pem: string): any {
  try {
    return sdk.PrivateKey.fromPem(pem, sdk.KeyAlgorithm.SECP256K1);
  } catch {
    return null;
  }
}

export async function getAccountMainPurse(accountHash: string): Promise<string | null> {
  try {
    const res = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1,
        method: 'state_get_account_info',
        params: { account_identifier: accountHash },
      }),
    }).then(r => r.json());
    const mainPurse = res.result?.account?.main_purse;
    if (!mainPurse) {
      console.error('[getAccountMainPurse] no main_purse in response:', res);
      return null;
    }
    return mainPurse;
  } catch (e: any) {
    console.error('[getAccountMainPurse] error:', e.message);
    return null;
  }
}

const NEEDS_PURSE = new Set(['register_provider', 'deposit_stake', 'withdraw_stake']);

function buildDeploy(account: any, contractHash: string, entryPoint: string, argsMap: Record<string, any>, payment = '50000000000') {
  const args = sdk.Args.fromMap(argsMap);
  const contractHashObj = sdk.ContractHash.newContract(contractHash);
  const storedContract = new sdk.StoredContractByHash(contractHashObj, entryPoint, args);
  const session = new sdk.ExecutableDeployItem();
  session.storedContractByHash = storedContract;
  const paymentItem = sdk.ExecutableDeployItem.standardPayment(payment);
  const header = sdk.DeployHeader.default();
  header.account = account;
  header.chainName = CHAIN_NAME;
  return sdk.Deploy.makeDeploy(header, paymentItem, session);
}

export async function callEntryPoint(
  privateKey: any,
  contractHash: string,
  entryPoint: string,
  argsMap: Record<string, any>,
  payment = '10000000000'
): Promise<{ deployHash: string; error?: string }> {
  try {
    const client = getClient();
    const deploy = buildDeploy(privateKey.publicKey, contractHash, entryPoint, argsMap, payment);
    deploy.sign(privateKey);
    const result = await client.putDeploy(deploy);
    return { deployHash: result.deployHash.toHex() };
  } catch (err: any) {
    return { deployHash: '', error: err.message || String(err) };
  }
}

export async function callEntryPointWithWallet(
  provider: any,
  publicKeyHex: string,
  contractHash: string,
  entryPoint: string,
  argsMap: Record<string, any>,
  payment = '10000000000'
): Promise<{ deployHash: string; error?: string }> {
  try {
    const client = getClient();
    const publicKey = sdk.PublicKey.fromHex(publicKeyHex);
    const deploy = buildDeploy(publicKey, contractHash, entryPoint, argsMap, payment);

    const providerMethods = Object.keys(provider).filter(
      (m: string) => typeof (provider as any)[m] === 'function'
    );
    console.log('[wallet] provider methods count:', providerMethods.length);
    providerMethods.forEach((m, i) => console.log(`  [${i}] ${m}`));

    // Try signDeploy first (proper deploy signing API)
    if (typeof provider.signDeploy === 'function') {
      console.log('[wallet] using provider.signDeploy for', entryPoint);
      const deployJSON = sdk.Deploy.toJSON(deploy);
      const deployJsonString = JSON.stringify(deployJSON);
      try {
        const signedDeployJSON = await provider.signDeploy(deployJsonString, publicKeyHex);
        console.log('[wallet] signDeploy returned type:', typeof signedDeployJSON);
        const signedDeploy = sdk.Deploy.fromJSON(JSON.parse(signedDeployJSON));
        const putResult = await client.putDeploy(signedDeploy);
        console.log('[wallet] deploy submitted:', putResult.deployHash.toHex());
        return { deployHash: putResult.deployHash.toHex() };
      } catch (err: any) {
        console.error('[wallet] signDeploy failed:', err.message);
        // fall through to sign()
      }
    }

    if (typeof provider.sign !== 'function') {
      return { deployHash: '', error: 'Wallet provider has no sign() or signDeploy() method. Available: ' + providerMethods.join(', ') };
    }

    console.log('[wallet] using provider.sign for', entryPoint);
    const deployJSON = sdk.Deploy.toJSON(deploy);
    const deployJsonString = JSON.stringify(deployJSON);
    console.log('[wallet] deploy JSON length:', deployJsonString.length);

    const result = await provider.sign(deployJsonString, publicKeyHex);
    console.log('[wallet] sign() returned:', result);

    if (result && result.cancelled) {
      return { deployHash: '', error: 'User cancelled the signing request.' };
    }
    if (!result || !result.signatureHex) {
      return { deployHash: '', error: 'Wallet did not return a signature. Result: ' + JSON.stringify(result) };
    }

    // Build complete deploy JSON with wallet signature and parse via fromJSON
    const prefix = publicKeyHex.slice(0, 2);
    const fullSigHex = prefix + result.signatureHex;
    const completeJSON = {
      ...deployJSON,
      approvals: [{
        signer: publicKeyHex,
        signature: fullSigHex,
      }],
    };
    console.log('[wallet] built complete deploy JSON with approval');

    try {
      const signedDeploy = sdk.Deploy.fromJSON(completeJSON);
      console.log('[wallet] fromJSON succeeded, approvals:', signedDeploy.approvals.length);
      const putResult = await client.putDeploy(signedDeploy);
      console.log('[wallet] deploy submitted:', putResult.deployHash.toHex());
      return { deployHash: putResult.deployHash.toHex() };
    } catch (err: any) {
      console.error('[wallet] fromJSON or putDeploy failed:', err.message);
      // Fallback: submit raw JSON via RPC
      console.log('[wallet] falling back to raw RPC account_put_deploy');
      const putRes = await fetch(RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 4,
          method: 'account_put_deploy',
          params: { deploy: completeJSON },
        }),
      }).then(r => r.json());
      if (putRes.error) {
        console.error('[wallet] account_put_deploy error:', putRes.error);
        return { deployHash: '', error: putRes.error.message || JSON.stringify(putRes.error) };
      }
      const deployHash = putRes.result?.deploy_hash || '';
      console.log('[wallet] deploy submitted via RPC:', deployHash);
      return { deployHash };
    }
  } catch (err: any) {
    console.error('[wallet] error:', err);
    return { deployHash: '', error: err.message || String(err) };
  }
}

export async function deployContractWithWallet(
  provider: any,
  publicKeyHex: string,
  wasmUrl: string,
  argsMap: Record<string, any>,
  payment = '50000000000'
): Promise<{ deployHash: string; error?: string }> {
  try {
    const client = getClient();
    const publicKey = sdk.PublicKey.fromHex(publicKeyHex);
    const accountHash = publicKey.accountHash();

    const wasmRes = await fetch(wasmUrl);
    if (!wasmRes.ok) return { deployHash: '', error: 'Failed to fetch WASM: ' + wasmRes.status };
    const wasmBytes = new Uint8Array(await wasmRes.arrayBuffer());

    const args = sdk.Args.fromMap(argsMap);
    const session = sdk.ExecutableDeployItem.newModuleBytes(wasmBytes, args);
    const paymentItem = sdk.ExecutableDeployItem.standardPayment(payment);
    const header = sdk.DeployHeader.default();
    header.account = publicKey;
    header.chainName = CHAIN_NAME;
    const deploy = sdk.Deploy.makeDeploy(header, paymentItem, session);

    // Build deploy JSON for wallet signing
    const deployJSON = sdk.Deploy.toJSON(deploy);
    const deployJsonString = JSON.stringify(deployJSON);

    const result = await provider.sign(deployJsonString, publicKeyHex);
    console.log('[wallet] deploy sign() returned:', result);

    if (result && result.cancelled) {
      return { deployHash: '', error: 'User cancelled the signing request.' };
    }
    if (!result || !result.signatureHex) {
      return { deployHash: '', error: 'Wallet did not return a signature.' };
    }

    const prefix = publicKeyHex.slice(0, 2);
    const fullSigHex = prefix + result.signatureHex;
    const completeJSON = {
      ...deployJSON,
      approvals: [{
        signer: publicKeyHex,
        signature: fullSigHex,
      }],
    };

    try {
      const signedDeploy = sdk.Deploy.fromJSON(completeJSON);
      const putResult = await client.putDeploy(signedDeploy);
      console.log('[wallet] contract deployed:', putResult.deployHash.toHex());
      return { deployHash: putResult.deployHash.toHex() };
    } catch (err: any) {
      console.error('[wallet] fromJSON/putDeploy failed:', err.message);
      // Fallback to raw RPC
      const putRes = await fetch(RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 6,
          method: 'account_put_deploy',
          params: { deploy: completeJSON },
        }),
      }).then(r => r.json());
      if (putRes.error) {
        console.error('[wallet] account_put_deploy error:', putRes.error);
        return { deployHash: '', error: putRes.error.message || JSON.stringify(putRes.error) };
      }
      const deployHash = putRes.result?.deploy_hash || '';
      console.log('[wallet] contract deployed via RPC:', deployHash);
      return { deployHash };
    }
  } catch (err: any) {
    console.error('[wallet] deploy error:', err);
    return { deployHash: '', error: err.message || String(err) };
  }
}

export async function getDeployStatus(deployHash: string): Promise<{ executed: boolean; error?: string; blockHeight?: number }> {
  try {
    const client = getClient();
    const res = await client.getDeploy(sdk.DeployHash.fromHex(deployHash));
    const info = res.executionInfo;
    if (!info) return { executed: false };
    const v2 = info.executionResult?.Version2;
    return {
      executed: true,
      error: v2?.errorMessage || undefined,
      blockHeight: info.blockHeight,
    };
  } catch {
    return { executed: false };
  }
}

export function accountHashFromPublicKey(publicKey: any): string {
  return publicKey.accountHash().toPrefixedString();
}

export function accountHashBytes(publicKey: any): Uint8Array {
  // account hash is 32 bytes
  return publicKey.accountHash().value();
}

export function publicKeyFromPrivate(privateKey: any): any {
  return privateKey.publicKey;
}

// ── Dictionary Queries ──

export async function getContractNamedKeys(contractHash: string): Promise<Record<string, string>> {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1,
      method: 'state_get_entity',
      params: { entity_identifier: { ContractHash: 'contract-' + contractHash } },
    }),
  }).then(r => r.json());
  const keys: any[] = res.result?.entity?.Contract?.contract?.named_keys || [];
  const map: Record<string, string> = {};
  for (const k of keys) map[k.name] = k.key;
  return map;
}

async function getLatestStateRootHash(): Promise<string> {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'chain_get_state_root_hash', params: null }),
  }).then(r => r.json());
  return res.result?.state_root_hash || '';
}

export async function queryDictionary(uref: string, key: string): Promise<any> {
  const stateRootHash = await getLatestStateRootHash();
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1,
      method: 'state_get_dictionary_item',
      params: {
        state_root_hash: stateRootHash,
        dictionary_identifier: {
          URef: { seed_uref: uref, dictionary_item_key: key },
        },
      },
    }),
  }).then(r => r.json());
  return res.result?.stored_value?.CLValue?.parsed;
}

export async function queryDictionaryItem(uref: string, key: string): Promise<any> {
  return queryDictionary(uref, key);
}
