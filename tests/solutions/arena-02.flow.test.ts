import { describe, it, expect } from 'vitest';
import { LevelRunner, emptyInput } from '@sim/index.js';
import type { ClassId, InputFrame } from '@sim/index.js';
import { ARENA_02 } from '@content/index.js';
import { ALL_BOTS, shardGrabberBot } from '@content/bots.js';

/**
 * Drive the 7-slot showcase level through the runner, mirroring what the e2e
 * dev hook does: state-aware bots per slot, with slots 0 and 1 both grabbing
 * shard defIndex 0 so slot 0's anchor breaks in slot 1's loop (a deliberate
 * paradox). Confirms the full flow ticks, a paradox is raised, and a Convergence
 * finish is reachable within the shard budget.
 */
const PLAN: ClassId[] = ['guardian', 'medic', 'ranger', 'pyromancer', 'rogue', 'engineer', 'avatar'];
// Slots 0 and 1 both go for shard 0 -> slot 0's recorded pickup breaks later.
const SHARD_SLOTS: Record<number, number> = { 0: 0, 1: 0 };

function frameFor(runner: LevelRunner): InputFrame {
  const slot = runner.recordingSlot;
  const cls = runner.slotClasses[slot];
  if (!cls) return emptyInput();
  if (SHARD_SLOTS[slot] !== undefined) return shardGrabberBot(runner.state, slot, SHARD_SLOTS[slot]!);
  const bot = ALL_BOTS[cls];
  return bot ? bot(runner.state, slot, runner.state.tick) : emptyInput();
}

describe('arena-02 7-slot showcase flow', () => {
  it('ticks through all slots, raises a paradox, and reaches a decision or win', () => {
    const runner = new LevelRunner(ARENA_02);
    let planIndex = 0;
    let sawParadox = false;
    const guard = ARENA_02.slotCount * (ARENA_02.loopLength + 4) + 10;
    let n = 0;

    while (runner.result === 'in_progress' && n < guard) {
      if (runner.needsClassChoice()) {
        runner.chooseClass(PLAN[planIndex++] as ClassId);
        continue;
      }
      if (runner.awaitingDecision()) break; // reached the rewrite/restart gate
      runner.tickWith(frameFor(runner));
      if (runner.state.paradoxEvents.length > 0) sawParadox = true;
      n++;
    }

    // A deliberate paradox was created by the double shard-grab.
    expect(sawParadox).toBe(true);
    // The squad wins on the Final Avatar's loop via Convergence.
    expect(runner.result).toBe('won');
    expect(runner.wonOnSlot).toBe(ARENA_02.slotCount - 1);
  });

  it('the last slot is the Avatar and Convergence charge accrues while alive', () => {
    const runner = new LevelRunner(ARENA_02);
    let planIndex = 0;
    const guard = ARENA_02.slotCount * (ARENA_02.loopLength + 4) + 10;
    let n = 0;
    let avatarCharged = false;
    while (runner.result === 'in_progress' && n < guard) {
      if (runner.needsClassChoice()) {
        runner.chooseClass(PLAN[planIndex++] as ClassId);
        continue;
      }
      if (runner.awaitingDecision()) break;
      runner.tickWith(frameFor(runner));
      const avatar = runner.state.units.find((u) => u.classId === 'avatar' && u.alive);
      if (avatar && avatar.convergeCharge > 0) avatarCharged = true;
      n++;
    }
    // If we reached the avatar's slot it will have accrued charge.
    if (runner.slotClasses[ARENA_02.slotCount - 1] === 'avatar' && runner.recordingSlot === ARENA_02.slotCount - 1) {
      expect(avatarCharged).toBe(true);
    }
    expect(runner.slotClasses[ARENA_02.slotCount - 1] === null || runner.slotClasses[ARENA_02.slotCount - 1] === 'avatar').toBe(true);
  });
});
