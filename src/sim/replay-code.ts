/**
 * Replay codes (brief section 6.4).
 *
 * A replay code is a compact, portable encoding of everything needed to replay
 * a run deterministically:
 *   { simVersion, contentHash, levelId, seed, slots: [{ classId, rleInputs }] }
 *
 * The payload is packed into a tight binary buffer (levelId + per-slot RLE
 * input streams), then base64url-encoded so it is URL-safe (`/#r=<code>`). The
 * simVersion + contentHash are the compatibility fingerprint: a client that
 * decodes a code MUST compare them against its own before replaying, and refuse
 * (with a clear message) on a mismatch rather than desync silently.
 *
 * This module is PURE (part of src/sim): no DOM, no wall clock, no Math.random.
 * base64url conversion uses only array/string primitives available everywhere.
 */

import { encodeInputs, decodeInputs } from './recording.js';
import { CLASS_IDS } from './classes.js';
import { SIM_VERSION } from './version.js';
import type { ClassId, InputFrame } from './types.js';

/** Magic bytes at the head of a decoded payload: "SQ1R" (Squad-1 Replay). */
const MAGIC = 0x53513152; // 'S','Q','1','R'
/** Payload format version (independent of SIM_VERSION; bump if layout changes). */
const FORMAT = 1;

/** One recorded slot inside a replay code. */
export interface ReplaySlot {
  classId: ClassId;
  /** Decompressed per-tick input frames for this slot. */
  frames: InputFrame[];
}

/** The fully-decoded contents of a replay code. */
export interface ReplayPayload {
  simVersion: number;
  contentHash: number;
  levelId: string;
  seed: number;
  /** The winning-run score (mode-defined); 0 when not applicable. */
  score: number;
  /** Which loop/slot the win landed on (-1 if not applicable). */
  wonOnSlot: number;
  slots: ReplaySlot[];
}

/** Input a caller supplies to build a replay code (simVersion is filled in). */
export interface ReplayInput {
  contentHash: number;
  levelId: string;
  seed: number;
  score?: number;
  wonOnSlot?: number;
  slots: ReplaySlot[];
}

/** Result of decoding: either the payload or a typed mismatch/error. */
export type DecodeResult =
  | { ok: true; payload: ReplayPayload }
  | { ok: false; reason: 'malformed' }
  | {
      ok: false;
      reason: 'version-mismatch';
      /** The versions found in the code, for a clear localized message. */
      codeSimVersion: number;
      codeContentHash: number;
      expectedSimVersion: number;
      expectedContentHash: number;
    };

// ---------------------------------------------------------------------------
// base64url (pure; no Buffer/btoa dependency so it runs in Node + browser + Worker)
// ---------------------------------------------------------------------------

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64URL_LOOKUP: Record<string, number> = (() => {
  const m: Record<string, number> = {};
  for (let i = 0; i < B64URL.length; i++) m[B64URL[i] as string] = i;
  return m;
})();

/** Encode bytes as base64url (no padding). */
export function bytesToBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] as number;
    const b1 = i + 1 < bytes.length ? (bytes[i + 1] as number) : 0;
    const b2 = i + 2 < bytes.length ? (bytes[i + 2] as number) : 0;
    const rem = bytes.length - i;
    out += B64URL[b0 >> 2];
    out += B64URL[((b0 & 0x03) << 4) | (b1 >> 4)];
    if (rem > 1) out += B64URL[((b1 & 0x0f) << 2) | (b2 >> 6)];
    if (rem > 2) out += B64URL[b2 & 0x3f];
  }
  return out;
}

/** Decode a base64url string (no padding) back to bytes. Throws on bad chars. */
export function base64UrlToBytes(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9\-_]/g, '');
  const len = clean.length;
  const outLen = Math.floor((len * 6) / 8);
  const out = new Uint8Array(outLen);
  let bits = 0;
  let acc = 0;
  let oi = 0;
  for (let i = 0; i < len; i++) {
    const v = B64URL_LOOKUP[clean[i] as string];
    if (v === undefined) throw new Error('bad base64url char');
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[oi++] = (acc >> bits) & 0xff;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Encode / decode
// ---------------------------------------------------------------------------

/** Map a ClassId to a stable small integer (index into CLASS_IDS). */
function classToByte(id: ClassId): number {
  const idx = CLASS_IDS.indexOf(id);
  if (idx < 0) throw new Error(`unknown class ${id}`);
  return idx;
}

function byteToClass(b: number): ClassId {
  const id = CLASS_IDS[b];
  if (!id) throw new Error(`bad class byte ${b}`);
  return id;
}

/** Encode a replay into a base64url code string. Fills in SIM_VERSION. */
export function encodeReplayCode(input: ReplayInput): string {
  const levelBytes = new TextEncoder().encode(input.levelId);
  const slotBufs = input.slots.map((s) => encodeInputs(s.frames));

  // Header size: magic(4) format(1) simVersion(4) contentHash(4) seed(4)
  //   score(4) wonOnSlot(2 signed) levelIdLen(2) + levelBytes
  //   slotCount(1) then per slot: classByte(1) rleLen(4) + rleBytes
  let size = 4 + 1 + 4 + 4 + 4 + 4 + 2 + 2 + levelBytes.length + 1;
  for (const buf of slotBufs) size += 1 + 4 + buf.length;

  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  let off = 0;
  view.setUint32(off, MAGIC, true); off += 4;
  out[off] = FORMAT; off += 1;
  view.setUint32(off, SIM_VERSION >>> 0, true); off += 4;
  view.setUint32(off, input.contentHash >>> 0, true); off += 4;
  view.setUint32(off, input.seed >>> 0, true); off += 4;
  view.setUint32(off, (input.score ?? 0) >>> 0, true); off += 4;
  view.setInt16(off, input.wonOnSlot ?? -1, true); off += 2;
  view.setUint16(off, levelBytes.length, true); off += 2;
  out.set(levelBytes, off); off += levelBytes.length;
  out[off] = input.slots.length; off += 1;
  for (let i = 0; i < input.slots.length; i++) {
    out[off] = classToByte(input.slots[i]!.classId); off += 1;
    const buf = slotBufs[i]!;
    view.setUint32(off, buf.length, true); off += 4;
    out.set(buf, off); off += buf.length;
  }
  return bytesToBase64Url(out);
}

/**
 * Decode a replay code. Returns a typed result: `malformed` for garbage, or a
 * `version-mismatch` (still parsed the header) so the caller can show a clear
 * message and NEVER replay incompatible data. On `ok` the payload is safe to
 * replay against the given (expectedSimVersion, expectedContentHash).
 */
export function decodeReplayCode(
  code: string,
  expectedContentHash: number,
  expectedSimVersion: number = SIM_VERSION,
): DecodeResult {
  let bytes: Uint8Array;
  try {
    bytes = base64UrlToBytes(code.trim());
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (bytes.length < 25) return { ok: false, reason: 'malformed' };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let off = 0;
  try {
    if (view.getUint32(off, true) !== MAGIC) return { ok: false, reason: 'malformed' };
    off += 4;
    const format = bytes[off] as number; off += 1;
    if (format !== FORMAT) return { ok: false, reason: 'malformed' };
    const simVersion = view.getUint32(off, true); off += 4;
    const contentHash = view.getUint32(off, true); off += 4;
    const seed = view.getUint32(off, true); off += 4;
    const score = view.getUint32(off, true); off += 4;
    const wonOnSlot = view.getInt16(off, true); off += 2;
    const levelLen = view.getUint16(off, true); off += 2;
    if (off + levelLen > bytes.length) return { ok: false, reason: 'malformed' };
    const levelId = new TextDecoder().decode(bytes.subarray(off, off + levelLen));
    off += levelLen;

    // Compatibility gate: refuse to replay incompatible codes (no silent desync).
    if (simVersion !== (expectedSimVersion >>> 0) || contentHash !== (expectedContentHash >>> 0)) {
      return {
        ok: false,
        reason: 'version-mismatch',
        codeSimVersion: simVersion,
        codeContentHash: contentHash,
        expectedSimVersion: expectedSimVersion >>> 0,
        expectedContentHash: expectedContentHash >>> 0,
      };
    }

    const slotCount = bytes[off] as number; off += 1;
    const slots: ReplaySlot[] = [];
    for (let i = 0; i < slotCount; i++) {
      if (off + 5 > bytes.length) return { ok: false, reason: 'malformed' };
      const classId = byteToClass(bytes[off] as number); off += 1;
      const rleLen = view.getUint32(off, true); off += 4;
      if (off + rleLen > bytes.length) return { ok: false, reason: 'malformed' };
      const rle = bytes.subarray(off, off + rleLen); off += rleLen;
      slots.push({ classId, frames: decodeInputs(new Uint8Array(rle)) });
    }

    return {
      ok: true,
      payload: { simVersion, contentHash, levelId, seed, score, wonOnSlot, slots },
    };
  } catch {
    return { ok: false, reason: 'malformed' };
  }
}
