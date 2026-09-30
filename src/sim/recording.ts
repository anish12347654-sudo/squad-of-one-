/**
 * Input recording + RLE compression (brief sections 3.2, 9.5).
 *
 * FROZEN AT M1. A recording is one InputFrame per tick plus, for later paradox
 * detection (M2), the echo's position per tick and an anchor list (object id +
 * tick for every pickup/interaction). In M1 there are no pickups yet, so the
 * anchor list is empty but the field is part of the frozen shape.
 *
 * Wire packing per frame (see docs/ARCHITECTURE.md):
 *   moveX  int8   [-127,127]
 *   moveY  int8   [-127,127]
 *   aim    uint8  [0,255]
 *   flags  uint8  bit0 = aimActive, remaining bits reserved
 *   buttons uint8 bitmask (skill/dash/interact)
 * => 5 bytes/frame, then run-length compressed over identical consecutive
 *    frames as (count:uint16, 5 bytes) pairs.
 */

import { emptyInput } from './types.js';
import type { InputFrame } from './types.js';

/** Bytes used to pack one InputFrame. */
export const FRAME_BYTES = 5;

/** A recorded past self: the input stream plus data reserved for paradoxes. */
export interface Recording {
  /** The class this slot played. */
  classId: import('./types.js').ClassId;
  /** Number of ticks recorded (== loop length). */
  length: number;
  /** One InputFrame per tick (decompressed form used at runtime). */
  frames: InputFrame[];
  /**
   * Echo position per tick: positions[2*t] = x, positions[2*t+1] = y. Used ONLY
   * for paradox detection in M2; the sim recomputes real positions from inputs.
   */
  positions: Float64Array;
  /** Anchors: pickups/interactions as {objectId, tick}. Empty in M1. */
  anchors: { objectId: number; tick: number }[];
}

/** Clamp to int8 range. */
function toInt8(v: number): number {
  const n = Math.round(v);
  return n < -127 ? -127 : n > 127 ? 127 : n;
}

/** Pack a frame's 5 bytes into `buf` at `off`. */
function packFrame(buf: Uint8Array, off: number, f: InputFrame): void {
  // int8 stored as unsigned byte via two's complement.
  buf[off] = toInt8(f.moveX) & 0xff;
  buf[off + 1] = toInt8(f.moveY) & 0xff;
  buf[off + 2] = f.aim & 0xff;
  buf[off + 3] = f.aimActive ? 1 : 0;
  buf[off + 4] = f.buttons & 0xff;
}

/** Read a signed int8 out of an unsigned byte. */
function fromInt8(byte: number): number {
  return byte < 128 ? byte : byte - 256;
}

function unpackFrame(buf: Uint8Array, off: number): InputFrame {
  return {
    moveX: fromInt8(buf[off] as number),
    moveY: fromInt8(buf[off + 1] as number),
    aim: buf[off + 2] as number,
    aimActive: (buf[off + 3] as number) !== 0,
    buttons: buf[off + 4] as number,
  };
}

function framesEqual(a: InputFrame, b: InputFrame): boolean {
  return (
    a.moveX === b.moveX &&
    a.moveY === b.moveY &&
    a.aim === b.aim &&
    a.aimActive === b.aimActive &&
    a.buttons === b.buttons
  );
}

/**
 * RLE-encode an InputFrame stream into a Uint8Array. Layout:
 *   [uint32 frameCount]
 *   repeated: [uint16 runLength][5 bytes frame]
 * Big runs of identical frames (idle, held movement) collapse to a few bytes.
 */
export function encodeInputs(frames: readonly InputFrame[]): Uint8Array {
  const runs: { count: number; frame: InputFrame }[] = [];
  for (const f of frames) {
    const last = runs[runs.length - 1];
    if (last && last.count < 0xffff && framesEqual(last.frame, f)) {
      last.count += 1;
    } else {
      runs.push({ count: 1, frame: f });
    }
  }
  const buf = new Uint8Array(4 + runs.length * (2 + FRAME_BYTES));
  const view = new DataView(buf.buffer);
  view.setUint32(0, frames.length, true);
  let off = 4;
  for (const run of runs) {
    view.setUint16(off, run.count, true);
    off += 2;
    packFrame(buf, off, run.frame);
    off += FRAME_BYTES;
  }
  return buf;
}

/** Decode an RLE input stream back into a full per-tick frame array. */
export function decodeInputs(buf: Uint8Array): InputFrame[] {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const total = view.getUint32(0, true);
  const frames: InputFrame[] = [];
  let off = 4;
  while (frames.length < total && off + 2 + FRAME_BYTES <= buf.length) {
    const count = view.getUint16(off, true);
    off += 2;
    const f = unpackFrame(buf, off);
    off += FRAME_BYTES;
    for (let i = 0; i < count && frames.length < total; i++) {
      frames.push({ ...f });
    }
  }
  // Pad defensively if a truncated buffer under-ran (should not happen).
  while (frames.length < total) frames.push(emptyInput());
  return frames;
}

/** A recorder accumulates one frame per tick during the live pass. */
export interface Recorder {
  classId: import('./types.js').ClassId;
  frames: InputFrame[];
  positions: number[];
  anchors: { objectId: number; tick: number }[];
}

export function createRecorder(classId: import('./types.js').ClassId): Recorder {
  return { classId, frames: [], positions: [], anchors: [] };
}

/** Record one tick: the input applied and the resulting echo position. */
export function recordTick(rec: Recorder, input: InputFrame, x: number, y: number): void {
  rec.frames.push({ ...input });
  rec.positions.push(x, y);
}

/** Record a pickup/interaction anchor (M2 paradox detection). */
export function recordAnchor(rec: Recorder, objectId: number, tick: number): void {
  rec.anchors.push({ objectId, tick });
}

/** Finalize a recorder into an immutable Recording. */
export function finalizeRecording(rec: Recorder): Recording {
  return {
    classId: rec.classId,
    length: rec.frames.length,
    frames: rec.frames.map((f) => ({ ...f })),
    positions: Float64Array.from(rec.positions),
    anchors: rec.anchors.map((a) => ({ ...a })),
  };
}

/** Round-trippable serialization of a recording (typed-array friendly). */
export interface SerializedRecording {
  classId: import('./types.js').ClassId;
  length: number;
  /** Base64-free: plain number array of the RLE bytes for JSON portability. */
  rle: number[];
  positions: number[];
  anchors: { objectId: number; tick: number }[];
}

export function serializeRecording(rec: Recording): SerializedRecording {
  return {
    classId: rec.classId,
    length: rec.length,
    rle: Array.from(encodeInputs(rec.frames)),
    positions: Array.from(rec.positions),
    anchors: rec.anchors.map((a) => ({ ...a })),
  };
}

export function deserializeRecording(s: SerializedRecording): Recording {
  return {
    classId: s.classId,
    length: s.length,
    frames: decodeInputs(Uint8Array.from(s.rle)),
    positions: Float64Array.from(s.positions),
    anchors: s.anchors.map((a) => ({ ...a })),
  };
}
