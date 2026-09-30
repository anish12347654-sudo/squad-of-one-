import { describe, it, expect } from 'vitest';
import {
  createLevelState,
  step,
  setEchoInputs,
  setBossPattern,
  createHasher,
  hashValue,
  emptyInput,
  finalizeRecording,
  createRecorder,
  recordTick,
} from '@sim/index.js';
import type { InputFrame, SimState, Unit, ClassId } from '@sim/index.js';
import { INVARIANCE_ARENA } from '@content/index.js';
import { guardianBot } from '@content/bots.js';

/**
 * Invariance Rule (brief 3.3): a live player who gives no input, stays out of
 * everyone's range, and takes no damage changes nothing. The rest of the world
 * reproduces the previous loop tick-for-tick.
 *
 * Setup: slot 0 is an active Guardian fighting the boss. In loop 1 slot 0 is
 * LIVE; we record it. In loop 2 slot 0 replays as an ECHO while slot 1 (a
 * far-corner unit) is the LIVE player giving no input. We hash the WORLD SUBSET
 * that both loops share (boss + slot-0 unit) and assert the sequences match.
 */

/** Hash only the shared world subset: the boss and the slot-0 unit. */
function hashWorldSubset(state: SimState): number {
  const h = createHasher();
  const boss = state.units.find((u) => u.kind === 'boss') as Unit;
  const slot0 = state.units.find((u) => u.slot === 0) as Unit;
  // Hash the fields that describe observable world evolution.
  hashValue(h, {
    bossHp: boss.hp,
    bossX: boss.x,
    bossY: boss.y,
    bossTarget: state.boss.targetId,
    s0x: slot0.x,
    s0y: slot0.y,
    s0hp: slot0.hp,
    attacks: state.attacks.map((a) => ({ x: a.x, y: a.y, t: a.telegraphTicks, f: a.fired })),
  });
  return h.hash >>> 0;
}

const SLOT0_CLASS: ClassId = 'guardian';

describe('Invariance Rule', () => {
  it('a no-input, out-of-range live player reproduces the prior loop tick-for-tick', () => {
    const level = INVARIANCE_ARENA;
    setBossPattern(level.boss.pattern);

    // --- Loop 1: slot 0 LIVE (Guardian bot), no other slots chosen. ---
    const slotClasses1: (ClassId | null)[] = [SLOT0_CLASS, null, null];
    let s1 = createLevelState(level, 0, slotClasses1, true);
    const rec = createRecorder(SLOT0_CLASS);
    const loop1Hashes: number[] = [];
    for (let t = 0; t < level.loopLength; t++) {
      setEchoInputs(new Map());
      const live = s1.units.find((u) => u.kind === 'player') as Unit;
      const input = guardianBot(s1, 0);
      recordTick(rec, input, live.x, live.y);
      s1 = step(s1, input);
      loop1Hashes.push(hashWorldSubset(s1));
      if (s1.outcome !== 'running') break;
    }
    const recording = finalizeRecording(rec);
    expect(recording.length).toBeGreaterThan(0);

    // --- Loop 2: slot 1 LIVE (no input, far corner); slot 0 replays as echo. ---
    const slotClasses2: (ClassId | null)[] = [SLOT0_CLASS, 'ranger', null];
    let s2 = createLevelState(level, 1, slotClasses2, true);
    const loop2Hashes: number[] = [];
    const echoBuf = new Map<number, InputFrame>();
    for (let t = 0; t < loop1Hashes.length; t++) {
      echoBuf.clear();
      const frame = t < recording.frames.length ? (recording.frames[t] as InputFrame) : emptyInput();
      echoBuf.set(0, frame);
      setEchoInputs(echoBuf);
      // Live player (slot 1) gives NO input.
      s2 = step(s2, emptyInput());
      loop2Hashes.push(hashWorldSubset(s2));
    }

    expect(loop2Hashes).toEqual(loop1Hashes);
  });

  it('real interaction (the live player fighting) DOES change the timeline', () => {
    const level = INVARIANCE_ARENA;
    setBossPattern(level.boss.pattern);

    // Baseline: slot 0 echo + slot 1 live no-op (same as the invariance case).
    const slotClasses: (ClassId | null)[] = [SLOT0_CLASS, 'ranger', null];

    // Record slot 0 once.
    setBossPattern(level.boss.pattern);
    let s1 = createLevelState(level, 0, [SLOT0_CLASS, null, null], true);
    const rec = createRecorder(SLOT0_CLASS);
    for (let t = 0; t < level.loopLength; t++) {
      setEchoInputs(new Map());
      const live = s1.units.find((u) => u.kind === 'player') as Unit;
      const input = guardianBot(s1, 0);
      recordTick(rec, input, live.x, live.y);
      s1 = step(s1, input);
      if (s1.outcome !== 'running') break;
    }
    const recording = finalizeRecording(rec);

    function runLoop2(liveActs: boolean): number[] {
      setBossPattern(level.boss.pattern);
      let s = createLevelState(level, 1, slotClasses, true);
      const hashes: number[] = [];
      const echoBuf = new Map<number, InputFrame>();
      for (let t = 0; t < recording.length; t++) {
        echoBuf.clear();
        echoBuf.set(0, (recording.frames[t] as InputFrame) ?? emptyInput());
        setEchoInputs(echoBuf);
        // If liveActs, the live ranger charges toward the boss and shoots.
        const live = s.units.find((u) => u.kind === 'player') as Unit;
        const input: InputFrame = liveActs
          ? guardianBot(s, 1) // aggressive: moves in and taunts/attacks
          : emptyInput();
        void live;
        s = step(s, input);
        hashes.push(hashWorldSubset(s));
      }
      return hashes;
    }

    const passive = runLoop2(false);
    const active = runLoop2(true);
    expect(active).not.toEqual(passive);
  });
});
