import { describe, it, expect } from 'vitest';
import {
  runTcMatch,
  runTcLoop,
  aiSource,
  framesSource,
  defaultPlans,
  tcAiFrame,
  createTcState,
  beginTcLoop,
  stepTc,
  tcScore,
  aliveCount,
  inZone,
  TC_CLASSES,
  TC_LOOPS,
  TC_LOOP_TICKS,
  type TcDifficulty,
  type TcLoopPlan,
} from '@content/index.js';
import { emptyInput } from '@sim/index.js';

const CLASSES_A = TC_CLASSES;
const CLASSES_B = [...TC_CLASSES.slice(2), ...TC_CLASSES.slice(0, 2)];

function plansFor(): TcLoopPlan[] {
  return defaultPlans(CLASSES_A, CLASSES_B);
}

describe('Time Chess AI determinism', () => {
  const difficulties: TcDifficulty[] = ['easy', 'normal', 'hard'];

  it('produces identical matches for the same seed + difficulty', () => {
    for (const diff of difficulties) {
      const first = runTcMatch(plansFor(), aiSource(42, diff), aiSource(7, diff));
      const second = runTcMatch(plansFor(), aiSource(42, diff), aiSource(7, diff));
      expect(second.scoreA).toBe(first.scoreA);
      expect(second.scoreB).toBe(first.scoreB);
      expect(second.zoneA).toBe(first.zoneA);
      expect(second.zoneB).toBe(first.zoneB);
      expect(second.winner).toBe(first.winner);
      // Recordings are bit-identical.
      expect(second.recorded.map((r) => r.frames)).toEqual(first.recorded.map((r) => r.frames));
    }
  });

  it('different seeds or difficulties diverge', () => {
    const a = runTcMatch(plansFor(), aiSource(1, 'normal'), aiSource(2, 'normal'));
    const b = runTcMatch(plansFor(), aiSource(99, 'normal'), aiSource(2, 'normal'));
    const c = runTcMatch(plansFor(), aiSource(1, 'hard'), aiSource(2, 'hard'));
    expect(a.recorded.map((r) => r.frames)).not.toEqual(b.recorded.map((r) => r.frames));
    expect(a.recorded.map((r) => r.frames)).not.toEqual(c.recorded.map((r) => r.frames));
  });

  it('the AI frame function itself is a pure function of its inputs', () => {
    const state = beginTcLoop(0, 'guardian', 'ranger', []);
    const f1 = tcAiFrame(5, 'hard', state, 'a', 10, 20, 30);
    const f2 = tcAiFrame(5, 'hard', state, 'a', 10, 20, 30);
    expect(f2).toEqual(f1);
  });
});

describe('Time Chess sim structure', () => {
  it('runs exactly 5 loops with growing unit counts', () => {
    const recorded = [];
    let lastUnits = 0;
    const plans = plansFor();
    for (let loop = 0; loop < TC_LOOPS; loop++) {
      const start = beginTcLoop(loop, plans[loop]!.classA, plans[loop]!.classB, recorded);
      // Two active + 2 per prior loop.
      expect(start.units.length).toBe(2 + loop * 2);
      lastUnits = start.units.length;
      const res = runTcLoop(loop, plans[loop]!, recorded, framesSource([]), framesSource([]));
      recorded.push(res.recA, res.recB);
      expect(res.state.tick).toBe(TC_LOOP_TICKS);
    }
    expect(lastUnits).toBe(2 + (TC_LOOPS - 1) * 2);
  });

  it('a unit standing in the centre zone banks control-zone ticks', () => {
    let state = createTcState();
    state = beginTcLoop(0, 'guardian', 'ranger', []);
    // Force side A's active unit to the centre; side B stays put outside.
    for (const u of state.units) {
      if (u.side === 'a') {
        u.x = 0;
        u.y = 0;
      }
    }
    expect(inZone(0, 0)).toBe(true);
    // Idle frames: A is in the zone, B is not.
    for (let i = 0; i < 60; i++) state = stepTc(state, () => emptyInput());
    expect(state.zoneTicks.a).toBeGreaterThan(0);
  });

  it('scoring combines zone ticks and alive units', () => {
    const state = beginTcLoop(0, 'guardian', 'ranger', []);
    state.zoneTicks.a = 500;
    // Both units alive at spawn.
    expect(tcScore(state, 'a')).toBe(500 + aliveCount(state, 'a') * 100);
  });

  it('unique class per loop per side in the default plans', () => {
    const plans = plansFor();
    const aClasses = plans.map((p) => p.classA);
    const bClasses = plans.map((p) => p.classB);
    expect(new Set(aClasses).size).toBe(aClasses.length);
    expect(new Set(bClasses).size).toBe(bClasses.length);
    // No Avatar in Time Chess.
    expect(aClasses).not.toContain('avatar');
    expect(bClasses).not.toContain('avatar');
  });

  it('a full vs-AI match resolves to a winner or draw', () => {
    const res = runTcMatch(plansFor(), aiSource(11, 'normal'), aiSource(22, 'hard'));
    expect(['a', 'b', 'draw']).toContain(res.winner);
    expect(res.scoreA).toBeGreaterThanOrEqual(0);
    expect(res.scoreB).toBeGreaterThanOrEqual(0);
  });
});
