import { describe, it, expect } from 'vitest';
import {
  encodeInputs,
  decodeInputs,
  createRecorder,
  recordTick,
  finalizeRecording,
  serializeRecording,
  deserializeRecording,
} from '@sim/recording.js';
import { emptyInput, BUTTON_SKILL, BUTTON_DASH, BUTTON_INTERACT } from '@sim/types.js';
import type { InputFrame } from '@sim/types.js';

function varyingInputs(n: number): InputFrame[] {
  const out: InputFrame[] = [];
  for (let i = 0; i < n; i++) {
    // Long runs of identical frames interleaved with changes to exercise RLE.
    const phase = Math.floor(i / 40);
    out.push({
      moveX: phase % 2 === 0 ? 100 : -60,
      moveY: phase % 3 === 0 ? -127 : 0,
      aim: (phase * 17) % 256,
      aimActive: phase % 2 === 1,
      buttons: i % 40 === 0 ? BUTTON_SKILL | BUTTON_DASH : 0,
    });
  }
  return out;
}

describe('recording RLE round-trip', () => {
  it('encodes and decodes an input stream exactly', () => {
    const frames = varyingInputs(500);
    const encoded = encodeInputs(frames);
    const decoded = decodeInputs(encoded);
    expect(decoded).toEqual(frames);
  });

  it('compresses long identical runs (smaller than raw 5 bytes/frame)', () => {
    const frames = Array.from({ length: 1200 }, () => emptyInput());
    const encoded = encodeInputs(frames);
    // 1200 identical frames should collapse to header + a couple of runs.
    expect(encoded.length).toBeLessThan(1200 * 5);
    expect(decodeInputs(encoded)).toEqual(frames);
  });

  it('preserves int8 range and button bits', () => {
    const frames: InputFrame[] = [
      { moveX: -127, moveY: 127, aim: 255, aimActive: true, buttons: BUTTON_INTERACT },
      { moveX: 127, moveY: -127, aim: 0, aimActive: false, buttons: BUTTON_SKILL | BUTTON_DASH },
    ];
    expect(decodeInputs(encodeInputs(frames))).toEqual(frames);
  });

  it('records ticks and finalizes, then serializes round-trip', () => {
    const rec = createRecorder('ranger');
    const frames = varyingInputs(120);
    frames.forEach((f, i) => recordTick(rec, f, i * 2, i * 3));
    const finalized = finalizeRecording(rec);
    expect(finalized.length).toBe(120);
    expect(finalized.frames).toEqual(frames);
    expect(finalized.positions[0]).toBe(0);
    expect(finalized.positions[2]).toBe(2);

    const round = deserializeRecording(serializeRecording(finalized));
    expect(round.classId).toBe('ranger');
    expect(round.frames).toEqual(finalized.frames);
    expect(Array.from(round.positions)).toEqual(Array.from(finalized.positions));
  });
});
