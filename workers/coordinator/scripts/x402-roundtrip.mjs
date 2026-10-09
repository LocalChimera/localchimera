import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

const PAYEE = '0x1111111111111111111111111111111111111111'
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const acct = privateKeyToAccount(generatePrivateKey())

const authorization = {
  from: acct.address, to: PAYEE, value: '1000',
  validAfter: '0', validBefore: String(Math.floor(Date.now()/1000)+3600),
  nonce: '0x' + crypto.getRandomValues(new Uint8Array(32)).reduce((s,b)=>s+b.toString(16).padStart(2,'0'),''),
}
const signature = await acct.signTypedData({
  domain: { name:'USD Coin', version:'2', chainId:8453, verifyingContract:USDC },
  types: { TransferWithAuthorization: [
    {name:'from',type:'address'},{name:'to',type:'address'},{name:'value',type:'uint256'},
    {name:'validAfter',type:'uint256'},{name:'validBefore',type:'uint256'},{name:'nonce',type:'bytes32'} ] },
  primaryType: 'TransferWithAuthorization',
  message: authorization,
})
const xpay = Buffer.from(JSON.stringify({
  x402Version:1, scheme:'exact', network:'base',
  payload:{ signature, authorization } }),'utf8').toString('base64')

const res = await fetch('http://localhost:8790/jobs', {
  method:'POST',
  headers:{ 'authorization':'Bearer devtoken', 'content-type':'application/json', 'x-payment':xpay },
  body: JSON.stringify({ taskType:300, payload:'roundtrip' }),
})
console.log('HTTP', res.status, await res.text())
console.log('payer:', acct.address)
