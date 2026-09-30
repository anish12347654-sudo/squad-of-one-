import { describe, it, expect } from 'vitest';
import { hashState, hashToHex, createHasher, hashNumber } from '@sim/hash.js';

describe('FNV-1a state hashing', () => {
  it('is stable and deterministic for the same value', () => {
    const v = { tick: 42, pos: [1.5, -2.25], flags: { a: true, b: false }, name: 'boss' };
    expect(hashState(v)).toBe(hashState(v));
  });

  it('is order-independent for object keys (total-order traversal)', () => {
    const a = { x: 1, y: 2, z: 3 };
    const b = { z: 3, y: 2, x: 1 };
    expect(hashState(a)).toBe(hashState(b));
  });

  it('is stable across JSON serialization round-trips', () => {
    const original = {
      tick: 1000,
      rng: { a: 1, b: 2, c: 3, d: 4 },
      entities: [
        { id: 1, x: 12.5, y: -7.75, hp: 100 },
        { id: 2, x: 0, y: 0, hp: 42 },
      ],
      meta: { seed: 0xabc, done: false },
    };
    const roundTripped = JSON.parse(JSON.stringify(original));
    expect(hashState(roundTripped)).toBe(hashState(original));
  });

  it('quantizes numbers so sub-grid float noise does not change the hash', () => {
    // Default scale is 1/1024; a perturbation well under half a grid step
    // (1/2048) must round to the same quantum.
    const base = { v: 3.5 };
    const jittered = { v: 3.5 + 1 / 4096 };
    expect(hashState(jittered)).toBe(hashState(base));
  });

  it('detects real differences', () => {
    expect(hashState({ v: 1 })).not.toBe(hashState({ v: 2 }));
    expect(hashState({ v: 1 })).not.toBe(hashState({ w: 1 }));
  });

  it('handles NaN/Infinity deterministically', () => {
    expect(hashState({ v: NaN })).toBe(hashState({ v: NaN }));
    expect(hashState({ v: Infinity })).toBe(hashState({ v: Infinity }));
    expect(hashState({ v: Infinity })).not.toBe(hashState({ v: -Infinity }));
  });

  it('hashToHex renders an 8-char hex digest', () => {
    const h = createHasher();
    hashNumber(h, 12345);
    const hex = hashToHex(h.hash);
    expect(hex).toMatch(/^[0-9a-f]{8}$/);
  });
});
