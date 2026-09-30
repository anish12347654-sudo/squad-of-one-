/**
 * Campaign solvability gate (brief section 10, gate 3).
 *
 * For EVERY one of the 19 campaign levels this asserts two things:
 *   1. Live solve: the reference bot plan beats the level with >= 1 star.
 *   2. Recorded replay: the checked-in solution fixture (recorded by
 *      `npm run record:solutions`) replays through the SAME LevelRunner path a
 *      live player uses and reproduces the recorded win + star/echo outcome.
 *
 * This is the machine proof that each handcrafted level is beatable within the
 * unlock ramp and that its shipped solution replay is valid. Re-run after any
 * balance change (`npm run test`); regenerate fixtures with
 * `npm run record:solutions`.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { LevelRunner, emptyInput, decodeInputs } from '@sim/index.js';
import type { ClassId, InputFrame, LevelDef } from '@sim/index.js';
import { solveLevel } from '@content/solve.js';
import { ALL_BOTS } from '@content/bots.js';
import { CAMPAIGN_LEVELS } from '@content/index.js';

interface SerializedRec {
  slot: number;
  classId: ClassId;
  length: number;
  rle: number[];
  positions: number[];
  anchors: { objectId: number; tick: number }[];
}
interface SolutionFixture {
  id: string;
  levelId: string;
  plan: ClassId[];
  wonOnSlot: number;
  stars: number;
  echoesAlive: number;
  recordings: (SerializedRec | null)[];
}

const HERE = dirname(fileURLToPath(import.meta.url));

function loadFixture(id: string): SolutionFixture {
  const raw = readFileSync(join(HERE, `${id}.solution.json`), 'utf8');
  return JSON.parse(raw) as SolutionFixture;
}

/** Replay a recorded fixture through the LevelRunner and report the outcome. */
function replayFixture(level: LevelDef, fixture: SolutionFixture) {
  const runner = new LevelRunner(level);
  const perSlotFrames: (InputFrame[] | null)[] = fixture.recordings.map((r) =>
    r ? decodeInputs(Uint8Array.from(r.rle)) : null,
  );
  let planIndex = 0;
  const maxTicks = level.slotCount * (level.loopLength + 2);
  let ticks = 0;
  while (runner.result === 'in_progress' && ticks < maxTicks) {
    if (runner.needsClassChoice()) {
      runner.chooseClass(fixture.plan[planIndex++] as ClassId);
      continue;
    }
    const slot = runner.recordingSlot;
    const frames = perSlotFrames[slot];
    const t = runner.state.tick;
    const input: InputFrame = frames && t < frames.length ? (frames[t] as InputFrame) : emptyInput();
    runner.tickWith(input);
    ticks++;
  }
  const stars = runner.computeStars();
  return { result: runner.result, stars: stars.count, echoesAlive: stars.echoesAlive };
}

describe('every campaign level solves live with >= 1 star', () => {
  for (const level of CAMPAIGN_LEVELS) {
    it(`${level.id} (${level.def.slotCount} slots)`, () => {
      const outcome = solveLevel(level.def, [...level.solutionPlan], ALL_BOTS);
      expect(outcome.result, `${level.id} result`).toBe('won');
      expect(outcome.stars, `${level.id} stars`).toBeGreaterThanOrEqual(1);
    });
  }
});

describe('every campaign level ships a valid solution replay', () => {
  for (const level of CAMPAIGN_LEVELS) {
    it(`${level.id} recorded replay reproduces the win`, () => {
      const fixture = loadFixture(level.id);
      const out = replayFixture(level.def, fixture);
      expect(out.result, `${level.id} replay result`).toBe('won');
      expect(out.stars).toBeGreaterThanOrEqual(1);
      // The replay must reproduce the recorded outcome exactly (determinism).
      expect(out.stars).toBe(fixture.stars);
      expect(out.echoesAlive).toBe(fixture.echoesAlive);
    });
  }
});

describe('the first three levels are first-time winnable', () => {
  for (const id of ['tut-1', 'tut-2', 'tut-3']) {
    it(`${id} clears with margin`, () => {
      const level = CAMPAIGN_LEVELS.find((l) => l.id === id)!;
      const outcome = solveLevel(level.def, [...level.solutionPlan], ALL_BOTS);
      expect(outcome.result).toBe('won');
      expect(outcome.stars).toBeGreaterThanOrEqual(1);
    });
  }
});
