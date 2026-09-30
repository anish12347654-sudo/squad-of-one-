/**
 * Planning-phase pre-simulation (contract 3.7).
 *
 * Runs one loop of a level with all the CURRENT echoes and NO live player,
 * exactly through the frozen pure `step()` path, capturing a snapshot every
 * `SNAPSHOT_EVERY` ticks plus the per-tick FNV-1a hash. The timeline scrubber
 * reads these snapshots; the hashes are the determinism fingerprint used to
 * prove the Web Worker (which imports THIS module) reproduces the main thread
 * bit-for-bit.
 *
 * This module is PURE (part of src/sim): it only uses the sim API, so it runs
 * identically on the main thread and inside a Web Worker.
 */

import {
  createLevelState,
  step,
  setEchoInputs,
  setEchoRecordings,
  setBossPattern,
  setLevelMinions,
  cloneSimState,
  type EchoRecordingMeta,
} from './sim.js';
import { hashState } from './hash.js';
import { emptyInput } from './types.js';
import type { InputFrame, SimState, ClassId, ParadoxEvent } from './types.js';
import type { LevelDef } from './level.js';

/** Snapshot cadence: keep one snapshot every N ticks (contract 3.7). */
export const SNAPSHOT_EVERY = 5;

/** A lightweight, serializable per-echo/boss readout for the scrubber. */
export interface ScrubUnit {
  slot: number;
  kind: 'echo' | 'boss';
  classId: ClassId | null;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  paradox: boolean;
}

export interface ScrubTelegraph {
  shape: 'slam' | 'cone' | 'charge';
  x: number;
  y: number;
  radius: number;
  angle: number;
  halfArc: number;
  telegraph: boolean;
}

/** One captured frame of the pre-sim (every SNAPSHOT_EVERY ticks). */
export interface ScrubSnapshot {
  tick: number;
  bossHp: number;
  bossMaxHp: number;
  units: ScrubUnit[];
  telegraphs: ScrubTelegraph[];
  /** FNV-1a hash of the full sim state at this tick (determinism fingerprint). */
  hash: number;
}

/** Per-echo recorded ghost path (world positions), for the toggleable overlay. */
export interface GhostPath {
  slot: number;
  classId: ClassId | null;
  /** Flattened x,y per recorded tick. */
  points: number[];
}

/** The complete pre-sim result the scrubber consumes. */
export interface PreSimResult {
  levelId: string;
  loopLength: number;
  snapshots: ScrubSnapshot[];
  ghostPaths: GhostPath[];
  paradoxEvents: ParadoxEvent[];
  finalBossHp: number;
  bossMaxHp: number;
  /** Per-tick hashes (index = tick) for main-thread <-> worker parity checks. */
  hashes: number[];
}

/** The serializable request a caller (or the worker) needs to run a pre-sim. */
export interface PreSimRequest {
  level: LevelDef;
  /** The slot being planned/recorded (excluded from the pre-sim as "live"). */
  recordingSlot: number;
  slotClasses: (ClassId | null)[];
  /** Per-slot recorded input frames (decompressed), index = slot. */
  slotFrames: (InputFrame[] | null)[];
  /** Per-slot recorded positions (Float64 flattened), for paradox + ghosts. */
  slotPositions: (number[] | null)[];
  /** Per-slot recorded anchors, index = slot. */
  slotAnchors: ({ objectId: number; tick: number }[] | null)[];
  /** Per-slot recording length in ticks. */
  slotLengths: (number | null)[];
}

function snapshotOf(state: SimState): ScrubSnapshot {
  const units: ScrubUnit[] = [];
  let bossHp = 0;
  let bossMaxHp = 0;
  for (const u of state.units) {
    if (u.kind === 'boss') {
      bossHp = u.hp;
      bossMaxHp = u.maxHp;
      units.push({
        slot: -1,
        kind: 'boss',
        classId: null,
        x: u.x,
        y: u.y,
        hp: u.hp,
        maxHp: u.maxHp,
        alive: u.alive,
        paradox: false,
      });
    } else if (u.kind === 'echo') {
      units.push({
        slot: u.slot,
        kind: 'echo',
        classId: u.classId,
        x: u.x,
        y: u.y,
        hp: u.hp,
        maxHp: u.maxHp,
        alive: u.alive,
        paradox: u.paradox,
      });
    }
  }
  const telegraphs: ScrubTelegraph[] = state.attacks.map((a) => ({
    shape: a.shape,
    x: a.x,
    y: a.y,
    radius: a.radius,
    angle: a.angle,
    halfArc: a.halfArc,
    telegraph: a.telegraphTicks > 0,
  }));
  return {
    tick: state.tick,
    bossHp,
    bossMaxHp,
    units,
    telegraphs,
    hash: hashState(state),
  };
}

/**
 * Run the full pre-sim. Deterministic and engine-free; identical on the main
 * thread and in a Web Worker. Captures a snapshot every SNAPSHOT_EVERY ticks and
 * the per-tick hash sequence.
 */
export function runPreSim(req: PreSimRequest): PreSimResult {
  setBossPattern(req.level.boss.pattern);
  setLevelMinions(req.level.minions ?? []);
  // No live player: build the state with liveIncluded=false so the recording
  // slot spawns nothing; every OTHER recorded slot spawns as an echo.
  let state = createLevelState(req.level, req.recordingSlot, req.slotClasses, false);

  // Echo recording metadata for paradox detection.
  const echoRec = new Map<number, EchoRecordingMeta>();
  for (let slot = 0; slot < req.level.slotCount; slot++) {
    if (slot === req.recordingSlot) continue;
    const pos = req.slotPositions[slot];
    const anchors = req.slotAnchors[slot];
    const len = req.slotLengths[slot];
    if (pos && anchors && len != null) {
      echoRec.set(slot, { positions: pos, anchors, length: len });
    }
  }

  const snapshots: ScrubSnapshot[] = [];
  const hashes: number[] = [];

  // Capture the initial state (tick 0) too.
  snapshots.push(snapshotOf(state));

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

    if (state.tick % SNAPSHOT_EVERY === 0) {
      snapshots.push(snapshotOf(state));
    }
    if (state.outcome !== 'running') break;
  }

  // Ensure the final tick is captured for "final boss HP".
  const last = snapshots[snapshots.length - 1];
  if (!last || last.tick !== state.tick) snapshots.push(snapshotOf(state));

  const ghostPaths: GhostPath[] = [];
  for (let slot = 0; slot < req.level.slotCount; slot++) {
    if (slot === req.recordingSlot) continue;
    const pos = req.slotPositions[slot];
    if (!pos) continue;
    ghostPaths.push({ slot, classId: req.slotClasses[slot] ?? null, points: pos.slice() });
  }

  const boss = state.units.find((u) => u.kind === 'boss');
  return {
    levelId: req.level.id,
    loopLength: req.level.loopLength,
    snapshots,
    ghostPaths,
    paradoxEvents: state.paradoxEvents.map((e) => ({ ...e })),
    finalBossHp: boss ? boss.hp : 0,
    bossMaxHp: boss ? boss.maxHp : 0,
    hashes,
  };
}

/** Convenience for tests: clone a state deep (re-export for symmetry). */
export { cloneSimState };
