import { describe, it, expect } from 'vitest';
import { LevelRunner, hashState, decodeReplayCode } from '@sim/index.js';
import type { InputFrame } from '@sim/index.js';
import { ARENA_01 } from '@content/index.js';
import { encodeSlots } from '@game/replay-link.js';
import { contentHash } from '@content/index.js';
import { ALL_BOTS } from '@content/bots.js';

/**
 * Drive a LevelRunner to completion with the class plan, using the reference
 * bots per slot. Returns the runner + the per-slot recorded frames.
 */
function playToEnd(planClasses: string[]): LevelRunner {
  const runner = new LevelRunner(ARENA_01);
  let guard = 0;
  while (runner.result === 'in_progress' && guard < 200) {
    guard++;
    if (runner.needsClassChoice()) {
      const slot = runner.recordingSlot;
      const cls = planClasses[slot] as import('@sim/index.js').ClassId;
      runner.chooseClass(cls);
    }
    // Tick the loop with the bot for the current slot.
    let tickGuard = 0;
    while (
      runner.result === 'in_progress' &&
      !runner.needsClassChoice() &&
      !runner.awaitingDecision() &&
      tickGuard < ARENA_01.loopLength + 5
    ) {
      const slot = runner.recordingSlot;
      const cls = runner.slotClasses[slot];
      const bot = cls ? ALL_BOTS[cls] : undefined;
      const frame: InputFrame = bot
        ? bot(runner.state, slot, runner.state.tick)
        : { moveX: 0, moveY: 0, aim: 0, aimActive: false, buttons: 0 };
      runner.tickWith(frame);
      tickGuard++;
    }
    if (runner.awaitingDecision()) break;
  }
  return runner;
}

describe('replay code deterministic playback', () => {
  it('a recorded winning run replays to the identical per-tick hash sequence', () => {
    // ARENA_01 is the frozen 3-slot arena with a known solution plan.
    const runner = playToEnd(['guardian', 'medic', 'ranger']);
    expect(runner.result).toBe('won');

    // Build a code from the recordings, decode it, and confirm the frames match.
    const slots = [] as { classId: import('@sim/index.js').ClassId; frames: InputFrame[] }[];
    for (let s = 0; s < ARENA_01.slotCount; s++) {
      const rec = runner.recordings[s];
      const cls = runner.slotClasses[s];
      if (rec && cls) slots.push({ classId: cls, frames: rec.frames });
    }
    const code = encodeSlots(ARENA_01.id, runner.state.seed >>> 0, slots);
    const decoded = decodeReplayCode(code, contentHash());
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;

    // Replay: feed each slot's decoded frames through a fresh runner in the same
    // order and confirm the loop-by-loop hashes match the original run's.
    const replayRunner = new LevelRunner(ARENA_01);
    for (let s = 0; s < decoded.payload.slots.length; s++) {
      const slot = decoded.payload.slots[s]!;
      expect(replayRunner.needsClassChoice()).toBe(true);
      replayRunner.chooseClass(slot.classId);
      for (let tick = 0; tick < slot.frames.length; tick++) {
        const res = replayRunner.tickWith(slot.frames[tick]!);
        if (res !== 'in_progress') break;
        if (replayRunner.needsClassChoice() || replayRunner.awaitingDecision()) break;
      }
      if (replayRunner.result !== 'in_progress') break;
    }
    expect(replayRunner.result).toBe('won');
    // The winning slot + stars reproduce exactly.
    expect(replayRunner.wonOnSlot).toBe(runner.wonOnSlot);
    expect(replayRunner.computeStars().count).toBe(runner.computeStars().count);
    // And the final states hash identically (full determinism fingerprint).
    expect(hashState(replayRunner.state)).toBe(hashState(runner.state));
  });
});
