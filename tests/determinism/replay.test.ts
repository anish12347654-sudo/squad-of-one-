import { describe, it, expect } from 'vitest';
import { createSimState, cloneSimState, step } from '@sim/sim.js';
import { hashState } from '@sim/hash.js';
import { emptyInput } from '@sim/types.js';
import type { InputFrame } from '@sim/types.js';

/** Build a deterministic, varied input stream (no randomness of its own). */
function makeInputs(count: number): InputFrame[] {
  const inputs: InputFrame[] = [];
  for (let i = 0; i < count; i++) {
    inputs.push({
      moveX: ((i * 7) % 255) - 127,
      moveY: ((i * 13) % 255) - 127,
      aim: (i * 5) % 256,
      aimActive: i % 3 === 0,
      buttons: i % 4,
    });
  }
  return inputs;
}

/** Run the sim and collect a per-tick hash sequence. */
function runAndHash(seed: number, inputs: readonly InputFrame[]): number[] {
  let state = createSimState(seed);
  const hashes: number[] = [];
  for (const input of inputs) {
    state = step(state, input);
    hashes.push(hashState(state));
  }
  return hashes;
}

describe('simulation determinism', () => {
  it('produces identical per-tick hash sequences for the same inputs twice', () => {
    const inputs = makeInputs(600);
    const first = runAndHash(0xc0ffee, inputs);
    const second = runAndHash(0xc0ffee, inputs);
    expect(second).toEqual(first);
  });

  it('diverges for different seeds', () => {
    const inputs = makeInputs(120);
    const a = runAndHash(1, inputs);
    const b = runAndHash(2, inputs);
    expect(a).not.toEqual(b);
  });

  it('diverges for different inputs', () => {
    const a = runAndHash(5, makeInputs(120));
    const bInputs = makeInputs(120);
    bInputs[50] = { ...(bInputs[50] as InputFrame), moveX: 42 };
    const b = runAndHash(5, bInputs);
    expect(a).not.toEqual(b);
  });

  it('a cloned state continues identically to the original (snapshot/fork)', () => {
    const inputs = makeInputs(200);
    let state = createSimState(0xabcdef);
    for (let i = 0; i < 100; i++) {
      state = step(state, inputs[i] as InputFrame);
    }
    const fork = cloneSimState(state);
    const continueHashes: number[] = [];
    const forkHashes: number[] = [];
    for (let i = 100; i < 200; i++) {
      state = step(state, inputs[i] as InputFrame);
      continueHashes.push(hashState(state));
    }
    // The fork must not have advanced when the original stepped.
    expect(fork.tick).toBe(100);
    let forkState = fork;
    for (let i = 100; i < 200; i++) {
      forkState = step(forkState, inputs[i] as InputFrame);
      forkHashes.push(hashState(forkState));
    }
    expect(forkHashes).toEqual(continueHashes);
  });

  it('state survives a JSON round-trip mid-run with an identical hash', () => {
    const inputs = makeInputs(80);
    let state = createSimState(0x1234);
    for (let i = 0; i < 40; i++) {
      state = step(state, inputs[i] as InputFrame);
    }
    const serialized = JSON.parse(JSON.stringify(state));
    expect(hashState(serialized)).toBe(hashState(state));
  });

  it('neutral input is stable and deterministic', () => {
    const neutral = Array.from({ length: 300 }, () => emptyInput());
    expect(runAndHash(7, neutral)).toEqual(runAndHash(7, neutral));
  });
});
