/**
 * The pure simulation core: state creation and the fixed-timestep step().
 *
 * This module is the deterministic heart of the game. It obeys the sim rules
 * enforced by ESLint: no Phaser/DOM, no timers, no Date/performance, no
 * Math.random/sin/cos/atan2 (trig comes from ./trig, entropy from ./prng).
 */

import { createRng, cloneRng, nextIntBelow } from './prng.js';
import { cosFx, sinFx, TRIG_ONE, TRIG_TABLE_SIZE } from './trig.js';
import { emptyInput } from './types.js';
import type { InputFrame, SimState, StepFn } from './types.js';

/** Deterministically build the initial simulation state from a seed. */
export function createSimState(seed: number): SimState {
  return {
    tick: 0,
    seed: seed >>> 0,
    rng: createRng(seed),
    demo: { x: 0, y: 0, rolls: 0 },
  };
}

/** Deep clone of sim state (for snapshots, interpolation, replay forks). */
export function cloneSimState(state: SimState): SimState {
  return {
    tick: state.tick,
    seed: state.seed,
    rng: cloneRng(state.rng),
    demo: { x: state.demo.x, y: state.demo.y, rolls: state.demo.rolls },
  };
}

/**
 * The pure per-tick update. At M0 it drives a tiny deterministic system that
 * exercises every core primitive (RNG draw + fixed-point trig + input), so the
 * determinism tests have real state evolution to hash. Later milestones replace
 * the body with the real game systems while keeping this exact signature.
 */
export const step: StepFn = (state, input) => {
  // 1) Draw a bounded RNG value; RNG state advances inside state.rng.
  const roll = nextIntBelow(state.rng, TRIG_TABLE_SIZE);
  state.demo.rolls += 1;

  // 2) Combine input with the roll to pick a drift angle (brads).
  const inputAngle = input.aimActive ? (input.aim << 4) & (TRIG_TABLE_SIZE - 1) : 0;
  const angle = (roll + inputAngle) & (TRIG_TABLE_SIZE - 1);

  // 3) Advance a fixed-point position using the committed trig tables only.
  //    Speed is scaled by input magnitude so inputs affect the hash stream.
  const speed = 1 + (Math.abs(input.moveX) + Math.abs(input.moveY));
  state.demo.x += Math.trunc((cosFx(angle) * speed) / TRIG_ONE);
  state.demo.y += Math.trunc((sinFx(angle) * speed) / TRIG_ONE);

  // 4) Advance the tick counter last so it always reflects completed ticks.
  state.tick += 1;
  return state;
};

/** Run `count` ticks with neutral input; convenience for tests/tools. */
export function stepMany(state: SimState, inputs: readonly InputFrame[]): SimState {
  let s = state;
  for (const input of inputs) {
    s = step(s, input);
  }
  return s;
}

export { emptyInput };
export type { InputFrame, SimState, StepFn };
