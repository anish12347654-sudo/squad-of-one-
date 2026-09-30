import { describe, it, expect } from 'vitest';
import { createFixedTimestepRunner, MAX_TICKS_PER_FRAME } from '@game/fixed-timestep.js';
import { createSimState, cloneSimState } from '@sim/sim.js';
import { emptyInput } from '@sim/types.js';
import { TICK_DT_SECONDS } from '@sim/types.js';

const neutral = () => emptyInput();

describe('fixed-timestep runner', () => {
  it('runs exactly one tick per tick-length frame', () => {
    const runner = createFixedTimestepRunner(createSimState(1), cloneSimState);
    const ran = runner.advance(TICK_DT_SECONDS, neutral);
    expect(ran).toBe(1);
    expect(runner.state.tick).toBe(1);
  });

  it('accumulates sub-tick deltas until a whole tick is due', () => {
    const runner = createFixedTimestepRunner(createSimState(1), cloneSimState);
    expect(runner.advance(TICK_DT_SECONDS / 2, neutral)).toBe(0);
    expect(runner.state.tick).toBe(0);
    expect(runner.advance(TICK_DT_SECONDS / 2 + 1e-9, neutral)).toBe(1);
    expect(runner.state.tick).toBe(1);
  });

  it('caps ticks per frame and drops the backlog (slows down, never skips)', () => {
    const runner = createFixedTimestepRunner(createSimState(1), cloneSimState);
    // A huge delta would demand many ticks; the runner must cap.
    const ran = runner.advance(TICK_DT_SECONDS * 100, neutral);
    expect(ran).toBe(MAX_TICKS_PER_FRAME);
    expect(runner.state.tick).toBe(MAX_TICKS_PER_FRAME);
    // Backlog dropped: next full-tick frame advances exactly one tick.
    const next = runner.advance(TICK_DT_SECONDS, neutral);
    expect(next).toBe(1);
  });

  it('exposes alpha in [0,1) for interpolation', () => {
    const runner = createFixedTimestepRunner(createSimState(1), cloneSimState);
    runner.advance(TICK_DT_SECONDS * 1.5, neutral);
    expect(runner.alpha).toBeGreaterThanOrEqual(0);
    expect(runner.alpha).toBeLessThan(1);
    expect(runner.alpha).toBeCloseTo(0.5, 5);
  });

  it('ignores negative deltas', () => {
    const runner = createFixedTimestepRunner(createSimState(1), cloneSimState);
    expect(runner.advance(-5, neutral)).toBe(0);
    expect(runner.state.tick).toBe(0);
  });

  it('keeps previous state one tick behind current', () => {
    const runner = createFixedTimestepRunner(createSimState(1), cloneSimState);
    runner.advance(TICK_DT_SECONDS * 2, neutral);
    expect(runner.state.tick).toBe(2);
    expect(runner.previous.tick).toBe(1);
  });
});
