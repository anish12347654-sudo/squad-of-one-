/**
 * Deterministic parity harness (brief section 10, gate 2). Plays a campaign
 * level to completion with the reference bots and records the per-tick state
 * hash sequence plus the final hash. Because it is PURE (only the sim + content
 * bots + committed trig tables), running it in Node (Vitest) and in a real
 * browser (Playwright, via a dev hook) MUST produce byte-identical hashes - the
 * Node-vs-browser hash-parity gate.
 */

import { LevelRunner, hashState, type ClassId, type InputFrame } from '@sim/index.js';
import { campaignLevelById } from './levels/campaign-levels.js';
import { ALL_BOTS } from './bots.js';

export interface ParityResult {
  levelId: string;
  plan: ClassId[];
  result: string;
  wonOnSlot: number;
  stars: number;
  finalTick: number;
  finalHash: number;
  /** Every Nth per-tick hash (sampled to keep the fixture compact). */
  sampleHashes: number[];
  sampleEvery: number;
}

function neutral(): InputFrame {
  return { moveX: 0, moveY: 0, aim: 0, aimActive: false, buttons: 0 };
}

/**
 * Run `levelId` with the reference bot per recorded slot, hashing the state
 * after every tick. `sampleEvery` controls how many per-tick hashes are kept in
 * `sampleHashes` (the full sequence would bloat the fixture, but the final hash
 * plus a stride-sampled sequence still catches any mid-run divergence).
 */
export function runParity(levelId: string, plan: ClassId[], sampleEvery = 30): ParityResult {
  const lvl = campaignLevelById(levelId);
  if (!lvl) throw new Error(`unknown level ${levelId}`);
  const runner = new LevelRunner(lvl.def);
  const sampleHashes: number[] = [];
  let tickCounter = 0;
  let guard = 0;
  const maxTicks = lvl.def.slotCount * (lvl.def.loopLength + 8) + 16;

  while (runner.result === 'in_progress' && guard < maxTicks) {
    guard++;
    if (runner.needsClassChoice()) {
      const slot = runner.recordingSlot;
      const cls = plan[slot] ?? plan[plan.length - 1];
      if (!cls) break;
      runner.chooseClass(cls);
      continue;
    }
    if (runner.awaitingDecision()) break;
    const slot = runner.recordingSlot;
    const cls = runner.slotClasses[slot];
    const bot = cls ? ALL_BOTS[cls] : undefined;
    const frame = bot ? bot(runner.state, slot, runner.state.tick) : neutral();
    runner.tickWith(frame);
    if (tickCounter % sampleEvery === 0) sampleHashes.push(hashState(runner.state) >>> 0);
    tickCounter++;
  }

  return {
    levelId,
    plan,
    result: runner.result,
    wonOnSlot: runner.wonOnSlot,
    stars: runner.computeStars().count,
    finalTick: runner.state.tick,
    finalHash: hashState(runner.state) >>> 0,
    sampleHashes,
    sampleEvery,
  };
}

/** The fixed level + plan used by the Node-vs-browser parity gate. */
export const PARITY_LEVEL = 'w1-boss';
// 5 slots: Avatar must be the last slot (last-slot-only rule at 5+ slots).
export const PARITY_PLAN: ClassId[] = ['guardian', 'medic', 'ranger', 'pyromancer', 'avatar'];
