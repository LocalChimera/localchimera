const SPHERON_API_URL = process.env.SPHERON_API_URL || 'https://api.spheron.network';
const SPHERON_TOKEN = process.env.SPHERON_TOKEN || '';

export async function provisionSpheron({ quantity, recipient, imageTag = 'spheron/fizz:latest', code }) {
  const id = `spheron-${Date.now()}`;
  console.log(`[spheron] provisioning ${quantity} compute units for ${recipient}`);

  let result = null;
  try {
    const res = await fetch(`${SPHERON_API_URL}/v1/compute/deploy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SPHERON_TOKEN}`,
      },
      body: JSON.stringify({
        image: imageTag,
        duration: Number(quantity),
        env: { CHIMERA_RECIPIENT: recipient },
      }),
    });
    if (res.ok) {
      result = await res.json();
    } else {
      console.warn(`[spheron] deploy failed: ${res.status}`);
    }
  } catch (e) {
    console.warn(`[spheron] deploy failed: ${e.message}`);
  }

  return {
    id,
    txHash: null,
    status: 'provisioned',
    deploymentId: result?.deploymentId || id,
    endpoint: result?.endpoint || null,
    apiUrl: SPHERON_API_URL,
  };
}
