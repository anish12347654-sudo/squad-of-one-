import { describe, it, expect } from 'vitest';
import {
  encodeReplayCode,
  decodeReplayCode,
  bytesToBase64Url,
  base64UrlToBytes,
  SIM_VERSION,
} from '@sim/index.js';
import { emptyInput, BUTTON_SKILL, BUTTON_DASH } from '@sim/index.js';
import type { InputFrame, ReplaySlot } from '@sim/index.js';

/** Deterministic, varied per-tick frames for a slot. */
function frames(count: number, salt: number): InputFrame[] {
  const out: InputFrame[] = [];
  for (let i = 0; i < count; i++) {
    let buttons = 0;
    if ((i + salt) % 20 === 0) buttons |= BUTTON_SKILL;
    if ((i + salt) % 33 === 0) buttons |= BUTTON_DASH;
    out.push({
      moveX: (((i * 7 + salt) % 255) - 127),
      moveY: (((i * 3 + salt) % 255) - 127),
      aim: (i * 5 + salt) % 256,
      aimActive: (i + salt) % 4 === 0,
      buttons,
    });
  }
  return out;
}

const HASH = 0x1234abcd;

describe('base64url', () => {
  it('round-trips arbitrary bytes and stays URL-safe', () => {
    for (let len = 0; len < 260; len += 7) {
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = (i * 37 + 11) & 0xff;
      const s = bytesToBase64Url(bytes);
      expect(s).toMatch(/^[A-Za-z0-9_-]*$/); // no +, /, =
      expect(Array.from(base64UrlToBytes(s))).toEqual(Array.from(bytes));
    }
  });
});

describe('replay code round-trip', () => {
  it('encodes + decodes level id, seed, per-slot class and RLE inputs', () => {
    const slots: ReplaySlot[] = [
      { classId: 'guardian', frames: frames(300, 1) },
      { classId: 'ranger', frames: frames(300, 2) },
      { classId: 'avatar', frames: frames(300, 3) },
    ];
    const code = encodeReplayCode({ contentHash: HASH, levelId: 'w1-boss', seed: 777, score: 3, wonOnSlot: 2, slots });
    const res = decodeReplayCode(code, HASH);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.payload.simVersion).toBe(SIM_VERSION);
    expect(res.payload.contentHash).toBe(HASH >>> 0);
    expect(res.payload.levelId).toBe('w1-boss');
    expect(res.payload.seed).toBe(777);
    expect(res.payload.score).toBe(3);
    expect(res.payload.wonOnSlot).toBe(2);
    expect(res.payload.slots.length).toBe(3);
    for (let s = 0; s < slots.length; s++) {
      expect(res.payload.slots[s]!.classId).toBe(slots[s]!.classId);
      expect(res.payload.slots[s]!.frames).toEqual(slots[s]!.frames);
    }
  });

  it('is stable: encoding the decoded payload yields the same code', () => {
    const slots: ReplaySlot[] = [{ classId: 'rogue', frames: frames(120, 9) }];
    const code = encodeReplayCode({ contentHash: HASH, levelId: 'tut-1', seed: 5, slots });
    const res = decodeReplayCode(code, HASH);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const again = encodeReplayCode({
      contentHash: res.payload.contentHash,
      levelId: res.payload.levelId,
      seed: res.payload.seed,
      score: res.payload.score,
      wonOnSlot: res.payload.wonOnSlot,
      slots: res.payload.slots,
    });
    expect(again).toBe(code);
  });
});

describe('mismatch handling (never desync silently)', () => {
  const slots: ReplaySlot[] = [{ classId: 'medic', frames: frames(60, 4) }];
  const code = encodeReplayCode({ contentHash: HASH, levelId: 'tut-2', seed: 1, slots });

  it('reports a content-hash mismatch instead of returning a playable payload', () => {
    const res = decodeReplayCode(code, HASH + 1);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('version-mismatch');
    if (res.reason !== 'version-mismatch') return;
    expect(res.codeContentHash).toBe(HASH >>> 0);
    expect(res.expectedContentHash).toBe((HASH + 1) >>> 0);
  });

  it('reports a sim-version mismatch', () => {
    const res = decodeReplayCode(code, HASH, SIM_VERSION + 99);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('version-mismatch');
  });

  it('reports malformed for garbage input', () => {
    expect(decodeReplayCode('not-a-real-code!!!', HASH).ok).toBe(false);
    expect(decodeReplayCode('', HASH).ok).toBe(false);
    const shortRes = decodeReplayCode(bytesToBase64Url(new Uint8Array([1, 2, 3])), HASH);
    expect(shortRes.ok).toBe(false);
    if (!shortRes.ok) expect(shortRes.reason).toBe('malformed');
  });

  it('a neutral (all-idle) recording round-trips too', () => {
    const idle: ReplaySlot[] = [{ classId: 'guardian', frames: Array.from({ length: 200 }, () => emptyInput()) }];
    const c = encodeReplayCode({ contentHash: HASH, levelId: 'tut-1', seed: 2, slots: idle });
    const res = decodeReplayCode(c, HASH);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.payload.slots[0]!.frames).toEqual(idle[0]!.frames);
  });
});
