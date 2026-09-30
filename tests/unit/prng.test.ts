import { describe, it, expect } from 'vitest';
import { createRng, cloneRng, nextUint32, nextFloat, nextIntBelow, nextIntRange } from '@sim/prng.js';

describe('sfc32 PRNG (seeded via mulberry32)', () => {
  it('produces a deterministic, exact sequence for a fixed seed', () => {
    const rng = createRng(0xdecafbad);
    const seq = Array.from({ length: 8 }, () => nextUint32(rng));
    // Golden sequence: this is the contract. If the algorithm changes, replays
    // break, so this test locks the exact output. Recomputed once and pinned.
    expect(seq).toEqual([
      4261979179, 3901430709, 3533038735, 3369590794, 1885326157, 2274728332, 1258061634, 878392138,
    ]);
  });

  it('is reproducible: same seed -> same sequence', () => {
    const a = createRng(12345);
    const b = createRng(12345);
    for (let i = 0; i < 100; i++) {
      expect(nextUint32(a)).toBe(nextUint32(b));
    }
  });

  it('different seeds diverge', () => {
    const a = createRng(1);
    const b = createRng(2);
    const sa = Array.from({ length: 16 }, () => nextUint32(a));
    const sb = Array.from({ length: 16 }, () => nextUint32(b));
    expect(sa).not.toEqual(sb);
  });

  it('cloneRng snapshots position exactly', () => {
    const rng = createRng(777);
    nextUint32(rng);
    nextUint32(rng);
    const snap = cloneRng(rng);
    const fromOrig = Array.from({ length: 5 }, () => nextUint32(rng));
    const fromSnap = Array.from({ length: 5 }, () => nextUint32(snap));
    expect(fromSnap).toEqual(fromOrig);
  });

  it('nextFloat stays in [0, 1)', () => {
    const rng = createRng(42);
    for (let i = 0; i < 1000; i++) {
      const f = nextFloat(rng);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
    }
  });

  it('nextIntBelow stays in range and covers the space', () => {
    const rng = createRng(99);
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i++) {
      const v = nextIntBelow(rng, 6);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(6);
      seen.add(v);
    }
    expect(seen.size).toBe(6);
  });

  it('nextIntRange is inclusive on both ends', () => {
    const rng = createRng(2024);
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 5000; i++) {
      const v = nextIntRange(rng, -3, 3);
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    expect(min).toBe(-3);
    expect(max).toBe(3);
  });
});
