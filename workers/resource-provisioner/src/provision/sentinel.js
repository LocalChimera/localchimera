const SENTINEL_API_URL = process.env.SENTINEL_API_URL || 'https://api.sentinel.co';
const SENTINEL_KEY = process.env.SENTINEL_KEY || '';

export async function provisionSentinel({ quantity, recipient, duration }) {
  const id = `sentinel-${Date.now()}`;
  console.log(`[sentinel] provisioning ${quantity} GB bandwidth for ${recipient}`);

  let endpoint = null;
  try {
    const res = await fetch(`${SENTINEL_API_URL}/v2/bandwidth/subscribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SENTINEL_KEY}`,
      },
      body: JSON.stringify({
        gb: Number(quantity),
        duration: duration || 1,
        client: recipient,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      endpoint = data.endpoint || data.session_id || null;
    } else {
      console.warn(`[sentinel] subscribe failed: ${res.status}`);
    }
  } catch (e) {
    console.warn(`[sentinel] subscribe failed: ${e.message}`);
  }

  return {
    id,
    txHash: null,
    status: 'provisioned',
    endpoint,
    duration: duration || 1,
    apiUrl: SENTINEL_API_URL,
  };
}
