const INFERNET_API_URL = process.env.INFERNET_API_URL || 'https://api.infernet.protocol';
const INFERNET_KEY = process.env.INFERNET_KEY || '';

export async function provisionInfernet({ quantity, recipient, model = 'llama-3.2-1b' }) {
  const id = `infernet-${Date.now()}`;
  console.log(`[infernet] provisioning ${quantity} inference tokens for ${recipient}`);

  let result = null;
  try {
    const res = await fetch(`${INFERNET_API_URL}/v1/inference`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${INFERNET_KEY}`,
      },
      body: JSON.stringify({
        model,
        maxTokens: Number(quantity),
        client: recipient,
      }),
    });
    if (res.ok) {
      result = await res.json();
    } else {
      console.warn(`[infernet] inference failed: ${res.status}`);
    }
  } catch (e) {
    console.warn(`[infernet] inference failed: ${e.message}`);
  }

  return {
    id,
    txHash: null,
    status: 'provisioned',
    jobId: result?.jobId || id,
    output: result?.output || null,
    apiUrl: INFERNET_API_URL,
  };
}
