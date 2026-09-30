import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  LevelRunner,
  deserializeRecording,
  emptyInput,
  decodeInputs,
} from '@sim/index.js';
import type { ClassId, InputFrame } from '@sim/index.js';
import { ARENA_01 } from '@content/index.js';

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

function loadFixture(): SolutionFixture {
  const here = dirname(fileURLToPath(import.meta.url));
  const raw = readFileSync(join(here, 'arena-01.solution.json'), 'utf8');
  return JSON.parse(raw) as SolutionFixture;
}

/**
 * Re-play a recorded solution through the SAME LevelRunner path a live player
 * uses. For each slot's loop, the "live" input each tick is that slot's
 * recorded frame; other recorded slots run as echoes. Because the runner drives
 * both live and echoes through the identical step(), replaying the recorded
 * inputs must reproduce the recorded win.
 */
function replaySolution(fixture: SolutionFixture): {
  result: string;
  stars: number;
  echoesAlive: number;
} {
  const runner = new LevelRunner(ARENA_01);
  // Pre-decode each slot's recorded input stream.
  const perSlotFrames: (InputFrame[] | null)[] = fixture.recordings.map((r) =>
    r ? decodeInputs(Uint8Array.from(r.rle)) : null,
  );

  let planIndex = 0;
  const maxTicks = ARENA_01.slotCount * (ARENA_01.loopLength + 2);
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

describe('arena-01 solution replay', () => {
  it('the recorded bot solution wins the arena with >= 1 star', () => {
    const fixture = loadFixture();
    const out = replaySolution(fixture);
    expect(out.result).toBe('won');
    expect(out.stars).toBeGreaterThanOrEqual(1);
  });

  it('replay reproduces the recorded star/echo outcome exactly', () => {
    const fixture = loadFixture();
    const out = replaySolution(fixture);
    expect(out.stars).toBe(fixture.stars);
    expect(out.echoesAlive).toBe(fixture.echoesAlive);
  });

  it('every recorded slot round-trips through (de)serialization', () => {
    const fixture = loadFixture();
    for (const rec of fixture.recordings) {
      if (!rec) continue;
      const restored = deserializeRecording(rec);
      expect(restored.length).toBe(rec.length);
      expect(restored.frames.length).toBe(rec.length);
    }
  });
});
