/**
 * Core simulation types shared across the pure sim layer.
 *
 * Everything here is plain data: serializable, cloneable, and hashable. No
 * class instances with hidden state, no references to render objects.
 */

import type { RngState } from './prng.js';

/** Fixed simulation rate. The sim advances in whole ticks of 1/60 s. */
export const TICK_RATE_HZ = 60;
/** Seconds per tick (for the runner's accumulator; never used inside step()). */
export const TICK_DT_SECONDS = 1 / TICK_RATE_HZ;
/** Fixed-point milliseconds per tick used for integer time math in the sim. */
export const TICK_DT_MS = 1000 / TICK_RATE_HZ;

/**
 * A single frame of player input, quantized to the wire format described in
 * docs/ARCHITECTURE.md. Kept minimal at M0; content layers extend meaning.
 */
export interface InputFrame {
  /** Movement X in [-127, 127]. */
  moveX: number;
  /** Movement Y in [-127, 127]. */
  moveY: number;
  /** Aim direction in brads reduced to a uint8 (0..255). */
  aim: number;
  /** True when the aim stick is actively held. */
  aimActive: boolean;
  /** Button bitmask (uint8): bit0 = primary, bit1 = ability, etc. */
  buttons: number;
}

/** An empty/neutral input frame. */
export function emptyInput(): InputFrame {
  return { moveX: 0, moveY: 0, aim: 0, aimActive: false, buttons: 0 };
}

/**
 * The root simulation state. At M0 this is deliberately small - just enough to
 * exercise the PRNG, hashing and tick contract. Later milestones grow it with
 * entities, spatial hash, etc., but the invariants hold from day one:
 *   - fully serializable (structuredClone / JSON safe)
 *   - RNG state lives here (no module-level RNG)
 *   - deterministic given (state, inputs)
 */
export interface SimState {
  /** Monotonic tick counter since the run started. */
  tick: number;
  /** The seed the run was created from (for reproduction/debug). */
  seed: number;
  /** Serializable PRNG state. */
  rng: RngState;
  /** A small demo accumulator advanced each tick to give hashing something. */
  demo: {
    /** Fixed-point position advanced by a deterministic drift each tick. */
    x: number;
    y: number;
    /** Count of RNG draws taken, to show RNG state travels with the sim. */
    rolls: number;
  };
}

/**
 * The pure tick function contract: given the current state and the input for
 * this tick, return the NEXT state. Implementations must be pure with respect
 * to the outside world - the only entropy source is state.rng.
 *
 * Implementations may mutate the passed-in state and return it, or return a new
 * object; the runner treats the return value as authoritative.
 */
export type StepFn = (state: SimState, input: InputFrame) => SimState;
