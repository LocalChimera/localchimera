/**
 * allocateReviewBudgetMinor (vendored, SlopDotCash/slopdotcash MIT) —
 * the integer largest-remainder allocator behind split awards.
 * Covers: exact total, deterministic remainder ordering, zero/empty
 * weights, validation errors, uniqueness requirement.
 */
import { describe, expect, it } from 'vitest'
import { allocateReviewBudgetMinor } from '../src/vendor/slop/reward-allocation'

describe('allocateReviewBudgetMinor', () => {
  it('splits the exact total with no remainder loss', () => {
    const alloc = allocateReviewBudgetMinor(100n, [
      { actorId: 'a', scoreThirds: 1 },
      { actorId: 'b', scoreThirds: 1 },
      { actorId: 'c', scoreThirds: 1 },
    ])
    expect([...alloc.values()].reduce((t, v) => t + v, 0n)).toBe(100n)
    // 100/3 = 33r1 — two get 34? no: largest-remainder gives 34/33/33.
    const sorted = [alloc.get('a')!, alloc.get('b')!, alloc.get('c')!].sort((x, y) => Number(x - y))
    expect(sorted).toEqual([33n, 33n, 34n])
  })

  it('is deterministic — ties break on actorId order', () => {
    const alloc = allocateReviewBudgetMinor(10n, [
      { actorId: 'did:zB', scoreThirds: 1 },
      { actorId: 'did:zA', scoreThirds: 1 },
    ])
    // 5/5 splits evenly; with remainder ties, sorted actorId wins first.
    const alloc2 = allocateReviewBudgetMinor(7n, [
      { actorId: 'did:zB', scoreThirds: 1 },
      { actorId: 'did:zA', scoreThirds: 1 },
    ])
    expect(alloc.get('did:zA')).toBe(5n)
    expect(alloc2.get('did:zA')! + alloc2.get('did:zB')!).toBe(7n)
    // zA sorts first → gets the remainder unit.
    expect(alloc2.get('did:zA')).toBe(4n)
    expect(alloc2.get('did:zB')).toBe(3n)
  })

  it('zero weights produce empty allocations', () => {
    expect(allocateReviewBudgetMinor(50n, [{ actorId: 'a', scoreThirds: 0 }]).size).toBe(0)
    expect(allocateReviewBudgetMinor(0n, [{ actorId: 'a', scoreThirds: 5 }]).size).toBe(0)
  })

  it('rejects negative totals, negative scores, duplicate ids', () => {
    expect(() => allocateReviewBudgetMinor(-1n, [{ actorId: 'a', scoreThirds: 1 }])).toThrow()
    expect(() => allocateReviewBudgetMinor(10n, [{ actorId: 'a', scoreThirds: -1 }])).toThrow()
    expect(() =>
      allocateReviewBudgetMinor(10n, [
        { actorId: 'a', scoreThirds: 1 },
        { actorId: 'a', scoreThirds: 1 },
      ]),
    ).toThrow()
  })

  it('proportional split on real scores (arena-style)', () => {
    const alloc = allocateReviewBudgetMinor(1_000_000n, [
      { actorId: 'winner', scoreThirds: 835 },
      { actorId: 'second', scoreThirds: 833 },
      { actorId: 'third', scoreThirds: 828 },
    ])
    const total = [...alloc.values()].reduce((t, v) => t + v, 0n)
    expect(total).toBe(1_000_000n)
    expect(alloc.get('winner')!).toBeGreaterThan(alloc.get('second')!)
    expect(alloc.get('second')!).toBeGreaterThan(alloc.get('third')!)
  })
})
