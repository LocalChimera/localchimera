const CRUST_API_URL = process.env.CRUST_API_URL || 'https://api.crust.network';
const CRUST_SEED = process.env.CRUST_SEED || '';

export async function provisionCrust({ quantity, recipient, data, cid: existingCid }) {
  const id = `crust-${Date.now()}`;
  console.log(`[crust] provisioning ${quantity} GB storage for ${recipient}`);

  let cid = existingCid;
  let storageInfo = null;

  if (data && !cid) {
    try {
      const form = new FormData();
      const blob = new Blob([data], { type: 'application/octet-stream' });
      form.append('file', blob, 'chimera-task.bin');
      const res = await fetch(`${CRUST_API_URL}/api/v0/add?pin=true`, {
        method: 'POST',
        body: form,
      });
      if (res.ok) {
        const json = await res.json();
        cid = json.Hash || json.Cid;
      }
    } catch (e) {
      console.warn(`[crust] upload failed: ${e.message}`);
    }
  }

  if (cid) {
    try {
      const res = await fetch(`${CRUST_API_URL}/api/v1/storage/order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cid,
          size: Number(quantity) * 1024 * 1024 * 1024,
          seed: CRUST_SEED,
        }),
      });
      if (res.ok) {
        storageInfo = await res.json();
      }
    } catch (e) {
      console.warn(`[crust] order failed: ${e.message}`);
    }
  }

  return {
    id,
    txHash: null,
    status: 'provisioned',
    cid,
    orderId: storageInfo?.orderId || null,
    apiUrl: CRUST_API_URL,
  };
}
