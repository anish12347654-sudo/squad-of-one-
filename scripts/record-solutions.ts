/**
 * record-solutions.ts - records scripted-bot solution replays for each level and
 * writes them as level-solution test fixtures under tests/solutions/.
 *
 * Each fixture stores the per-slot class plan plus the RLE-compressed input
 * recording captured by playing the level's bot controllers through the pure
 * sim. The solution test re-plays the fixture and asserts a win with >= 1 star.
 *
 * Regenerate with `npm run record:solutions`.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { solveLevel } from '../src/content/solve.js';
import { serializeRecording } from '../src/sim/index.js';
import type { ClassId } from '../src/sim/index.js';
import { ARENA_01, CAMPAIGN_LEVELS } from '../src/content/index.js';
import { ALL_BOTS } from '../src/content/bots.js';
import type { LevelDef } from '../src/sim/index.js';
import type { BotController } from '../src/content/bots.js';

interface LevelSolution {
  id: string;
  levelId: string;
  plan: ClassId[];
  bots?: Record<string, BotController>;
}

const SOLUTIONS: LevelSolution[] = [
  { id: 'arena-01', levelId: 'arena-01', plan: ['guardian', 'medic', 'ranger'] },
  // All 19 campaign levels, each with its proven reference plan (section 10).
  ...CAMPAIGN_LEVELS.map((l) => ({
    id: l.id,
    levelId: l.id,
    plan: [...l.solutionPlan],
    bots: ALL_BOTS,
  })),
];

const LEVELS: Record<string, LevelDef> = {
  'arena-01': ARENA_01,
  ...Object.fromEntries(CAMPAIGN_LEVELS.map((l) => [l.id, l.def])),
};

function main(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const outDir = join(here, '..', 'tests', 'solutions');
  mkdirSync(outDir, { recursive: true });

  let wrote = 0;
  for (const sol of SOLUTIONS) {
    const level = LEVELS[sol.levelId];
    if (!level) {
      console.warn(`record-solutions: unknown level ${sol.levelId}, skipping`);
      continue;
    }
    const outcome = sol.bots ? solveLevel(level, sol.plan, sol.bots) : solveLevel(level, sol.plan);
    if (outcome.result !== 'won') {
      throw new Error(`record-solutions: bot failed to solve ${sol.id} (result=${outcome.result})`);
    }
    const fixture = {
      id: sol.id,
      levelId: sol.levelId,
      plan: sol.plan,
      wonOnSlot: outcome.wonOnSlot,
      stars: outcome.stars,
      echoesAlive: outcome.echoesAlive,
      recordings: outcome.recordings.map((r, slot) =>
        r ? { slot, ...serializeRecording(r) } : null,
      ),
    };
    const path = join(outDir, `${sol.id}.solution.json`);
    writeFileSync(path, JSON.stringify(fixture, null, 2) + '\n');
    console.log(
      `record-solutions: ${sol.id} -> won on slot ${outcome.wonOnSlot}, ${outcome.stars} star(s), ${outcome.echoesAlive} echoes alive`,
    );
    wrote++;
  }

  if (wrote === 0) {
    console.log('record-solutions: nothing to record.');
  }
}

main();
