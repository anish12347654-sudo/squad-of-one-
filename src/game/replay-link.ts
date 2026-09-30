/**
 * Replay-link helpers (brief section 6.4): the game-layer glue between a played
 * run and a portable `/#r=<code>` replay code.
 *
 * The encode/decode is PURE (src/sim/replay-code.ts). This module wires it to
 * the impure bits: reading a finished LevelRunner's recordings to build a code,
 * and turning a decoded payload into the per-slot data GameScene needs to play
 * a run back deterministically. The compatibility gate (simVersion +
 * contentHash) lives in the pure decoder, so mismatches surface as a typed
 * result here and are shown as a clear localized message - never a silent
 * desync.
 */

import {
  encodeReplayCode,
  decodeReplayCode,
  encodeInputs,
  type DecodeResult,
  type ReplaySlot,
} from '@sim/index.js';
import type { LevelRunner, ClassId, InputFrame } from '@sim/index.js';
import { contentHash } from '@content/index.js';

/** The `/#r=` URL fragment prefix. */
export const REPLAY_HASH_PREFIX = 'r=';

/**
 * Build a replay code from a finished, WON LevelRunner. Encodes the level id,
 * seed, per-slot class + RLE inputs, plus the score fields (stars / winning
 * slot) so "Beat this run" knows the target.
 */
export function buildReplayCode(runner: LevelRunner): string {
  const slots: ReplaySlot[] = [];
  for (let s = 0; s < runner.level.slotCount; s++) {
    const rec = runner.recordings[s];
    const cls = runner.slotClasses[s];
    if (!rec || !cls) continue;
    slots.push({ classId: cls, frames: rec.frames });
  }
  const stars = runner.computeStars();
  return encodeReplayCode({
    contentHash: contentHash(),
    levelId: runner.level.id,
    seed: runner.state.seed >>> 0,
    score: stars.count,
    wonOnSlot: runner.wonOnSlot,
    slots,
  });
}

/** Decode a code with THIS build's content hash / sim version. */
export function decodeForThisBuild(code: string): DecodeResult {
  return decodeReplayCode(code, contentHash());
}

/** Per-slot playback data GameScene consumes to replay a run. */
export interface ReplayPlayback {
  levelId: string;
  score: number;
  wonOnSlot: number;
  /** classId per slot (index = slot). */
  slotClasses: ClassId[];
  /** Decompressed frames per slot (index = slot). */
  slotFrames: InputFrame[][];
}

/** Turn a successful decode into ordered per-slot playback data. */
export function playbackFrom(result: Extract<DecodeResult, { ok: true }>): ReplayPlayback {
  const slotClasses: ClassId[] = [];
  const slotFrames: InputFrame[][] = [];
  for (const slot of result.payload.slots) {
    slotClasses.push(slot.classId);
    slotFrames.push(slot.frames);
  }
  return {
    levelId: result.payload.levelId,
    score: result.payload.score,
    wonOnSlot: result.payload.wonOnSlot,
    slotClasses,
    slotFrames,
  };
}

/**
 * Round-trip a set of slots to a code and back (used by the "copy code" button
 * so a shared code always matches what will replay). Kept tiny + pure-ish.
 */
export function encodeSlots(
  levelId: string,
  seed: number,
  slots: { classId: ClassId; frames: InputFrame[] }[],
): string {
  // Validate the RLE encodes cleanly before publishing the code.
  for (const s of slots) encodeInputs(s.frames);
  return encodeReplayCode({ contentHash: contentHash(), levelId, seed, slots });
}
