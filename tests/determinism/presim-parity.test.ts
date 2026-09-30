import { describe, it, expect } from 'vitest';
import {
  runPreSim,
  createLevelState,
  step,
  setEchoInputs,
  setEchoRecordings,
  setBossPattern,
  hashState,
  emptyInput,
  type PreSimRequest,
  type EchoRecordingMeta,
  type InputFrame,
} from '@sim/index.js';
import { ARENA_01 } from '@content/index.js';
import { solveLevel } from '@content/solve.js';

/**
 * Build a PreSimRequest from a solved arena so we have real echo recordings.
 * We plan slot 2 as the "recording" (live-excluded) slot and pre-sim slots 0/1.
 */
function requestFromSolvedArena(recordingSlot: number): PreSimRequest {
  const solved = solveLevel(ARENA_01, ['guardian', 'medic', 'ranger']);
  const slotFrames: (InputFrame[] | null)[] = [];
  const slotPositions: (number[] | null)[] = [];
  const slotAnchors: ({ objectId: number; tick: number }[] | null)[] = [];
  const slotLengths: (number | null)[] = [];
  for (let slot = 0; slot < ARENA_01.slotCount; slot++) {
    const rec = solved.recordings[slot];
    if (rec) {
      slotFrames.push(rec.frames.map((f) => ({ ...f })));
      slotPositions.push(Array.from(rec.positions));
      slotAnchors.push(rec.anchors.map((a) => ({ ...a })));
      slotLengths.push(rec.length);
    } else {
      slotFrames.push(null);
      slotPositions.push(null);
      slotAnchors.push(null);
      slotLengths.push(null);
    }
  }
  return {
    level: ARENA_01,
    recordingSlot,
    slotClasses: solved.slotClasses,
    slotFrames,
    slotPositions,
    slotAnchors,
    slotLengths,
  };
}

/**
 * Reference implementation: run the same loop that runPreSim runs, but driven
 * by hand through the raw frozen step() path on the "main thread". The two hash
 * streams must match tick-for-tick - this is the Worker <-> main-thread parity
 * guarantee (the worker imports the exact same runPreSim).
 */
function referenceHashes(req: PreSimRequest): number[] {
  setBossPattern(req.level.boss.pattern);
  let state = createLevelState(req.level, req.recordingSlot, req.slotClasses, false);
  const echoRec = new Map<number, EchoRecordingMeta>();
  for (let slot = 0; slot < req.level.slotCount; slot++) {
    if (slot === req.recordingSlot) continue;
    const pos = req.slotPositions[slot];
    const anchors = req.slotAnchors[slot];
    const len = req.slotLengths[slot];
    if (pos && anchors && len != null) echoRec.set(slot, { positions: pos, anchors, length: len });
  }
  const hashes: number[] = [];
  const echoBuf = new Map<number, InputFrame>();
  for (let tick = 0; tick < req.level.loopLength; tick++) {
    echoBuf.clear();
    for (let slot = 0; slot < req.level.slotCount; slot++) {
      if (slot === req.recordingSlot) continue;
      const frames = req.slotFrames[slot];
      if (!frames) continue;
      echoBuf.set(slot, tick < frames.length ? (frames[tick] as InputFrame) : emptyInput());
    }
    setEchoInputs(echoBuf);
    setEchoRecordings(echoRec);
    state = step(state, emptyInput());
    hashes.push(hashState(state));
    if (state.outcome !== 'running') break;
  }
  return hashes;
}

describe('pre-sim worker/main-thread parity (contract 3.7)', () => {
  it('runPreSim is deterministic across repeated invocations', () => {
    const req = requestFromSolvedArena(2);
    const a = runPreSim(req);
    const b = runPreSim(req);
    expect(a.hashes).toEqual(b.hashes);
    expect(a.finalBossHp).toBe(b.finalBossHp);
  });

  it('runPreSim hashes match a hand-driven main-thread loop tick-for-tick', () => {
    const req = requestFromSolvedArena(2);
    const pre = runPreSim(req);
    const ref = referenceHashes(req);
    expect(pre.hashes).toEqual(ref);
  });

  it('captures a snapshot every 5 ticks and a final one', () => {
    const req = requestFromSolvedArena(2);
    const pre = runPreSim(req);
    // Snapshots at tick 0, 5, 10, ... plus a final capture.
    expect(pre.snapshots.length).toBeGreaterThan(2);
    for (let i = 1; i < pre.snapshots.length - 1; i++) {
      expect(pre.snapshots[i]!.tick % 5).toBe(0);
    }
    // Every snapshot embeds the determinism hash.
    for (const s of pre.snapshots) expect(typeof s.hash).toBe('number');
    // Ghost paths exist for the two echo slots (0 and 1), not slot 2.
    expect(pre.ghostPaths.map((g) => g.slot).sort()).toEqual([0, 1]);
  });
});
