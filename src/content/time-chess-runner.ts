/**
 * Time Chess runner (brief section 6.3): orchestrates the 5-loop duel.
 *
 * Each loop, BOTH sides record simultaneously while every previously recorded
 * loop of BOTH sides replays. The runner routes inputs:
 *   - a prior-loop unit acts from its recorded frames;
 *   - an active (current-loop) unit acts from the live source for its side
 *     (a human InputFrame stream, or the deterministic AI bot).
 *
 * Pure + deterministic: with the same class picks + the same input sources
 * (and, for AI, the same seed + difficulty), the whole match is reproducible.
 * Lives in src/content and uses only the Time-Chess sim + sim types.
 */

import type { InputFrame, ClassId } from '@sim/index.js';
import { emptyInput } from '@sim/index.js';
import {
  beginTcLoop,
  stepTc,
  tcScore,
  aliveCount,
  TC_LOOP_TICKS,
  TC_LOOPS,
  type TcState,
  type TcRecordedLoop,
  type PlayerSide,
} from './time-chess.js';
import { tcAiFrame, type TcDifficulty } from './time-chess-ai.js';

/** A source of live input frames for one side's active unit each tick. */
export type TcInputSource = (state: TcState, side: PlayerSide, x: number, y: number, tick: number) => InputFrame;

/** Wrap the deterministic AI bot as an input source. */
export function aiSource(seed: number, difficulty: TcDifficulty): TcInputSource {
  return (state, side, x, y, tick) => tcAiFrame(seed, difficulty, state, side, x, y, tick);
}

/** A fixed replay source (dev/tests): the same frames every loop. */
export function framesSource(byTick: readonly InputFrame[]): TcInputSource {
  return (_state, _side, _x, _y, tick) => byTick[tick] ?? emptyInput();
}

export interface TcLoopPlan {
  classA: ClassId;
  classB: ClassId;
}

export interface TcMatchResult {
  /** Per-side final score (control-zone ticks + units alive * 100). */
  scoreA: number;
  scoreB: number;
  /** Per-side control-zone ticks and units alive at the end (last loop state). */
  zoneA: number;
  zoneB: number;
  aliveA: number;
  aliveB: number;
  winner: PlayerSide | 'draw';
  /** The recorded loops (both sides), in loop order. */
  recorded: TcRecordedLoop[];
}

/**
 * Run one loop live, recording both sides' active-unit frames. `sourceA` and
 * `sourceB` supply frames for the active units; prior-loop units replay from
 * `recorded`. Returns the finished loop state + the two new recordings.
 */
export function runTcLoop(
  loop: number,
  plan: TcLoopPlan,
  recorded: readonly TcRecordedLoop[],
  sourceA: TcInputSource,
  sourceB: TcInputSource,
): { state: TcState; recA: TcRecordedLoop; recB: TcRecordedLoop } {
  let state = beginTcLoop(loop, plan.classA, plan.classB, recorded);
  const framesA: InputFrame[] = [];
  const framesB: InputFrame[] = [];

  // Index recorded frames by (side, loop) for prior-loop replay.
  const recIndex = new Map<string, TcRecordedLoop>();
  for (const r of recorded) recIndex.set(`${r.side}:${r.loop}`, r);

  for (let tick = 0; tick < TC_LOOP_TICKS && !state.finished; tick++) {
    // Capture the active units' frames BEFORE stepping (so the recording is the
    // exact input applied this tick). We must sample per active unit.
    let frameA = emptyInput();
    let frameB = emptyInput();
    for (const u of state.units) {
      if (u.loop !== loop) continue;
      if (u.side === 'a') frameA = sourceA(state, 'a', u.x, u.y, tick);
      else frameB = sourceB(state, 'b', u.x, u.y, tick);
    }
    framesA.push(frameA);
    framesB.push(frameB);

    state = stepTc(state, (u) => {
      if (u.loop === loop) return u.side === 'a' ? frameA : frameB;
      const rec = recIndex.get(`${u.side}:${u.loop}`);
      if (!rec) return emptyInput();
      return rec.frames[tick] ?? emptyInput();
    });
  }

  const recA: TcRecordedLoop = { side: 'a', loop, classId: plan.classA, frames: framesA };
  const recB: TcRecordedLoop = { side: 'b', loop, classId: plan.classB, frames: framesB };
  return { state, recA, recB };
}

/**
 * Run a full 5-loop match. `plans` gives the (unique per side) class picks per
 * loop. Returns the aggregate result + all recordings. Deterministic given the
 * plans + input sources.
 */
export function runTcMatch(
  plans: readonly TcLoopPlan[],
  sourceA: TcInputSource,
  sourceB: TcInputSource,
): TcMatchResult {
  const recorded: TcRecordedLoop[] = [];
  let last: TcState | null = null;
  const n = Math.min(TC_LOOPS, plans.length);
  for (let loop = 0; loop < n; loop++) {
    const plan = plans[loop]!;
    const { state, recA, recB } = runTcLoop(loop, plan, recorded, sourceA, sourceB);
    recorded.push(recA, recB);
    last = state;
  }
  const state = last ?? beginTcLoop(0, plans[0]?.classA ?? 'guardian', plans[0]?.classB ?? 'ranger', []);
  const scoreA = tcScore(state, 'a');
  const scoreB = tcScore(state, 'b');
  return {
    scoreA,
    scoreB,
    zoneA: state.zoneTicks.a,
    zoneB: state.zoneTicks.b,
    aliveA: aliveCount(state, 'a'),
    aliveB: aliveCount(state, 'b'),
    winner: scoreA === scoreB ? 'draw' : scoreA > scoreB ? 'a' : 'b',
    recorded,
  };
}

/**
 * Build a default set of unique-per-loop class plans for a match. Side A and B
 * each cycle through TC_CLASSES with a small offset so their picks differ and
 * every loop's class is unique for that side.
 */
export function defaultPlans(classesA: readonly ClassId[], classesB: readonly ClassId[]): TcLoopPlan[] {
  const plans: TcLoopPlan[] = [];
  for (let i = 0; i < TC_LOOPS; i++) {
    plans.push({
      classA: classesA[i % classesA.length]!,
      classB: classesB[i % classesB.length]!,
    });
  }
  return plans;
}
