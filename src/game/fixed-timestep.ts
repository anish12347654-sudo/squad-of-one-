/**
 * Fixed-timestep accumulator runner.
 *
 * Lives in src/game (NOT src/sim) because it reads wall-clock frame deltas -
 * which are non-deterministic - and turns them into a whole number of
 * deterministic sim ticks. The pure sim never sees real time.
 *
 * Policy (see docs/ARCHITECTURE.md):
 *   - Accumulate the real frame delta.
 *   - While >= one tick, run step() with the current input and subtract a tick.
 *   - Cap at MAX_TICKS_PER_FRAME ticks per frame: when the machine falls behind
 *     we SLOW DOWN (drop the leftover accumulator) rather than skip ticks, so
 *     the simulation never fast-forwards or loses determinism.
 *   - Expose the fractional leftover as `alpha` for render interpolation.
 */

import { step, TICK_DT_SECONDS } from '@sim/index.js';
import type { InputFrame, SimState } from '@sim/index.js';

/** Maximum sim ticks advanced in a single animation frame. */
export const MAX_TICKS_PER_FRAME = 5;

export interface FixedTimestepRunner {
  /** The authoritative current sim state. */
  readonly state: SimState;
  /** State from the previous tick, for render interpolation. */
  readonly previous: SimState;
  /** Interpolation factor in [0, 1) between `previous` and `state`. */
  readonly alpha: number;
  /**
   * Advance the runner by a real frame delta (seconds). `provideInput` is
   * called once per tick to obtain the input for that tick. Returns the number
   * of ticks actually run this frame.
   */
  advance(deltaSeconds: number, provideInput: (tick: number) => InputFrame): number;
}

/**
 * Create a fixed-timestep runner around an initial sim state.
 *
 * @param initial the starting sim state (ownership is taken).
 * @param cloneState a deep-clone function for snapshotting the previous tick.
 */
export function createFixedTimestepRunner(
  initial: SimState,
  cloneState: (s: SimState) => SimState,
): FixedTimestepRunner {
  let current = initial;
  let previous = cloneState(initial);
  let accumulator = 0;
  let alpha = 0;

  return {
    get state(): SimState {
      return current;
    },
    get previous(): SimState {
      return previous;
    },
    get alpha(): number {
      return alpha;
    },
    advance(deltaSeconds: number, provideInput: (tick: number) => InputFrame): number {
      // Guard against negative or absurd deltas (tab switches, breakpoints).
      const dt = deltaSeconds > 0 ? deltaSeconds : 0;
      accumulator += dt;

      let ticks = 0;
      while (accumulator >= TICK_DT_SECONDS && ticks < MAX_TICKS_PER_FRAME) {
        previous = cloneState(current);
        current = step(current, provideInput(current.tick));
        accumulator -= TICK_DT_SECONDS;
        ticks += 1;
      }

      // Fell behind: drop the backlog so we slow down instead of spiralling.
      if (accumulator >= TICK_DT_SECONDS) {
        accumulator = 0;
      }

      alpha = accumulator / TICK_DT_SECONDS;
      return ticks;
    },
  };
}
