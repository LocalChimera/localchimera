/**
 * Canonical task types used across the SDK, resource provisioner, and coordinator.
 *
 * Canonical space (Browser SDK / resource-provisioner):
 *   0 = inference, 1 = storage, 2 = compute, 3 = bandwidth
 *
 * Botchain uses bit flags:
 *   1 = compute, 2 = storage, 4 = inference, 8 = bandwidth
 */
export const TASK_TYPE = {
  INFERENCE: 0,
  STORAGE: 1,
  COMPUTE: 2,
  BANDWIDTH: 3,
};

export const TASK_TYPE_NAME = {
  [TASK_TYPE.INFERENCE]: 'inference',
  [TASK_TYPE.STORAGE]: 'storage',
  [TASK_TYPE.COMPUTE]: 'compute',
  [TASK_TYPE.BANDWIDTH]: 'bandwidth',
};

export const TASK_TYPE_BOTCHAIN = {
  COMPUTE: 1,
  STORAGE: 2,
  INFERENCE: 4,
  BANDWIDTH: 8,
};

/**
 * Convert a single network-specific task type to canonical SDK space.
 * Supports Botchain bit-flag encodings by returning the first matching bit.
 */
export function normalizeTaskType(taskType, network = '') {
  const tt = Number(taskType) || 0;

  if (network === 'botchain') {
    if (tt & TASK_TYPE_BOTCHAIN.INFERENCE) return TASK_TYPE.INFERENCE;
    if (tt & TASK_TYPE_BOTCHAIN.STORAGE) return TASK_TYPE.STORAGE;
    if (tt & TASK_TYPE_BOTCHAIN.COMPUTE) return TASK_TYPE.COMPUTE;
    if (tt & TASK_TYPE_BOTCHAIN.BANDWIDTH) return TASK_TYPE.BANDWIDTH;
    return tt <= 3 ? tt : TASK_TYPE.INFERENCE;
  }

  if (tt >= 0 && tt <= 3) return tt;

  // Bit-flag fallback
  if (tt & TASK_TYPE_BOTCHAIN.INFERENCE) return TASK_TYPE.INFERENCE;
  if (tt & TASK_TYPE_BOTCHAIN.STORAGE) return TASK_TYPE.STORAGE;
  if (tt & TASK_TYPE_BOTCHAIN.COMPUTE) return TASK_TYPE.COMPUTE;
  if (tt & TASK_TYPE_BOTCHAIN.BANDWIDTH) return TASK_TYPE.BANDWIDTH;

  return TASK_TYPE.INFERENCE;
}

/**
 * Convert a canonical task type back to Botchain bit-flag encoding.
 */
export function toBotchainTaskType(canonicalType) {
  switch (Number(canonicalType)) {
    case TASK_TYPE.INFERENCE: return TASK_TYPE_BOTCHAIN.INFERENCE;
    case TASK_TYPE.STORAGE: return TASK_TYPE_BOTCHAIN.STORAGE;
    case TASK_TYPE.COMPUTE: return TASK_TYPE_BOTCHAIN.COMPUTE;
    case TASK_TYPE.BANDWIDTH: return TASK_TYPE_BOTCHAIN.BANDWIDTH;
    default: return 0;
  }
}
