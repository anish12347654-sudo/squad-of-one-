/**
 * Deterministic solver harness: drives a LevelRunner with scripted bot
 * controllers to produce (and verify) a level's solution replay. Pure and
 * deterministic - used by scripts/record-solutions.ts and the solution tests.
 */

import { LevelRunner, emptyInput } from '@sim/index.js';
import type { ClassId, InputFrame, Recording } from '@sim/index.js';
import type { LevelDef } from '@sim/index.js';
import { ARENA_01_BOTS, type BotController } from './bots.js';

export interface SolveOutcome {
  result: 'won' | 'failed';
  wonOnSlot: number;
  stars: number;
  echoesAlive: number;
  /** The recording captured for each slot that was played. */
  recordings: (Recording | null)[];
  /** The class picked for each slot. */
  slotClasses: (ClassId | null)[];
}

/**
 * Play a level to completion. `plan` chooses the class for each slot in order;
 * `controllers` maps a classId to its bot. The live player each loop is driven
 * by the controller for the slot being recorded.
 */
export function solveLevel(
  level: LevelDef,
  plan: ClassId[],
  controllers: Record<string, BotController> = ARENA_01_BOTS,
): SolveOutcome {
  const runner = new LevelRunner(level);
  let planIndex = 0;

  // Safety bound: at most slotCount loops * loopLength ticks.
  const maxTicks = level.slotCount * (level.loopLength + 2);
  let ticks = 0;

  while (runner.result === 'in_progress' && ticks < maxTicks) {
    if (runner.needsClassChoice()) {
      const cls = plan[planIndex++] ?? plan[plan.length - 1];
      runner.chooseClass(cls as ClassId);
      continue;
    }
    const slot = runner.recordingSlot;
    const cls = runner.slotClasses[slot] as ClassId;
    const controller = controllers[cls];
    const input: InputFrame = controller ? controller(runner.state, slot, runner.state.tick) : emptyInput();
    runner.tickWith(input);
    ticks++;
  }

  const stars = runner.computeStars();
  return {
    result: runner.result === 'won' ? 'won' : 'failed',
    wonOnSlot: runner.wonOnSlot,
    stars: stars.count,
    echoesAlive: stars.echoesAlive,
    recordings: runner.recordings.slice(),
    slotClasses: runner.slotClasses.slice(),
  };
}
