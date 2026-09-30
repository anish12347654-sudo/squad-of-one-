/**
 * Deterministic seeded PRNG for the pure simulation.
 *
 * Algorithm: sfc32 (Small Fast Counter, 32-bit) seeded via mulberry32. sfc32
 * has a large state, good statistical quality, and is trivially serializable as
 * four uint32s - which lets us keep the RNG state INSIDE the sim state so that
 * replays and multiplayer lockstep stay bit-exact.
 *
 * There is intentionally NO module-level mutable RNG. Callers pass and receive
 * the state explicitly (or mutate a state object they own).
 */

/** Serializable RNG state: four unsigned 32-bit integers. */
export interface RngState {
  a: number;
  b: number;
  c: number;
  d: number;
}

/** mulberry32 - used only to expand a single 32-bit seed into sfc32 state. */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return function next(): number {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

/**
 * Create sfc32 state from a 32-bit seed. The seed is expanded through mulberry32
 * and the generator is warmed up so early outputs are well mixed.
 */
export function createRng(seed: number): RngState {
  const gen = mulberry32(seed >>> 0);
  const state: RngState = {
    a: gen() >>> 0,
    b: gen() >>> 0,
    c: gen() >>> 0,
    d: gen() >>> 0,
  };
  // Warm up to discard correlated initial outputs.
  for (let i = 0; i < 16; i++) {
    nextUint32(state);
  }
  return state;
}

/** Deep copy of RNG state (for forking / snapshotting). */
export function cloneRng(state: RngState): RngState {
  return { a: state.a, b: state.b, c: state.c, d: state.d };
}

/**
 * Advance the sfc32 generator in place and return the next uint32.
 * Mutates `state` so the RNG position stays part of sim state.
 */
export function nextUint32(state: RngState): number {
  const a = state.a >>> 0;
  const b = state.b >>> 0;
  const c = state.c >>> 0;
  const d = state.d >>> 0;

  const t = (a + b) | 0;
  const nextD = (d + 1) | 0;
  const cRot = (c << 21) | (c >>> 11);
  const result = (t + d) | 0;

  state.a = b ^ (b >>> 9);
  state.b = (c + (c << 3)) | 0;
  state.c = (cRot + result) | 0;
  state.d = nextD;

  return result >>> 0;
}

/** Next float in [0, 1) with 32 bits of entropy. */
export function nextFloat(state: RngState): number {
  return nextUint32(state) / 0x1_0000_0000;
}

/**
 * Uniform integer in [0, boundExclusive) using rejection sampling to avoid
 * modulo bias. boundExclusive must be a positive integer.
 */
export function nextIntBelow(state: RngState, boundExclusive: number): number {
  const bound = Math.trunc(boundExclusive);
  if (bound <= 0) return 0;
  // Largest multiple of `bound` that fits in uint32 range.
  const limit = 0x1_0000_0000 - (0x1_0000_0000 % bound);
  let x: number;
  do {
    x = nextUint32(state);
  } while (x >= limit);
  return x % bound;
}

/** Uniform integer in [minInclusive, maxInclusive]. */
export function nextIntRange(state: RngState, minInclusive: number, maxInclusive: number): number {
  const lo = Math.trunc(minInclusive);
  const hi = Math.trunc(maxInclusive);
  if (hi <= lo) return lo;
  return lo + nextIntBelow(state, hi - lo + 1);
}
