// Vendored from SlopDotCash/slopdotcash (MIT) — src/lib/reward-cycle.ts.
// Excerpted `allocateReviewBudgetMinor`: deterministic integer largest-
// remainder allocation (integer micro-units in, exact split out).
// See UPSTREAM.md in this directory.
export function allocateReviewBudgetMinor(
  totalMinor: bigint,
  contributors: readonly { actorId: string; scoreThirds: number }[],
): Map<string, bigint> {
  if (totalMinor < 0n) throw new RangeError("review budget cannot be negative");
  if (
    contributors.some(
      ({ actorId, scoreThirds }) =>
        actorId.length === 0 ||
        !Number.isSafeInteger(scoreThirds) ||
        scoreThirds < 0,
    ) ||
    new Set(contributors.map(({ actorId }) => actorId)).size !==
      contributors.length
  ) {
    throw new TypeError("review weights must be unique non-negative integers");
  }
  const eligible = contributors
    .filter(
      ({ scoreThirds }) => Number.isSafeInteger(scoreThirds) && scoreThirds > 0,
    )
    .sort((left, right) => left.actorId.localeCompare(right.actorId));
  if (eligible.length === 0 || totalMinor === 0n) return new Map();
  const totalWeight = eligible.reduce(
    (total, contributor) => total + BigInt(contributor.scoreThirds),
    0n,
  );
  const allocations = new Map<string, bigint>();
  const remainders = eligible.map((contributor) => {
    const numerator = totalMinor * BigInt(contributor.scoreThirds);
    const amount = numerator / totalWeight;
    allocations.set(contributor.actorId, amount);
    return { actorId: contributor.actorId, remainder: numerator % totalWeight };
  });
  let unallocated =
    totalMinor -
    [...allocations.values()].reduce((total, amount) => total + amount, 0n);
  remainders.sort((left, right) =>
    left.remainder === right.remainder
      ? left.actorId.localeCompare(right.actorId)
      : left.remainder > right.remainder
        ? -1
        : 1,
  );
  for (let index = 0; unallocated > 0n; index += 1) {
    const actorId = remainders[index % remainders.length].actorId;
    allocations.set(actorId, (allocations.get(actorId) ?? 0n) + 1n);
    unallocated -= 1n;
  }
  return allocations;
}
