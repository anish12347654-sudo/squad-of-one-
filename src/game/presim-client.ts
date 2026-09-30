/**
 * Main-thread client for the pre-sim Web Worker (contract 3.7).
 *
 * Builds a serializable PreSimRequest from the current runner state, ships it to
 * the worker, and resolves with the PreSimResult. Falls back to running the
 * identical `runPreSim` on the main thread when Workers are unavailable (some
 * headless/test contexts) - the result is bit-identical either way.
 */

import { runPreSim, decodeInputs } from '@sim/index.js';
import type {
  PreSimRequest,
  PreSimResult,
  LevelDef,
  ClassId,
  InputFrame,
  Recording,
} from '@sim/index.js';

/** Build a PreSimRequest from the level + per-slot recordings + plan. */
export function buildPreSimRequest(
  level: LevelDef,
  recordingSlot: number,
  slotClasses: (ClassId | null)[],
  recordings: (Recording | null)[],
): PreSimRequest {
  const slotFrames: (InputFrame[] | null)[] = [];
  const slotPositions: (number[] | null)[] = [];
  const slotAnchors: ({ objectId: number; tick: number }[] | null)[] = [];
  const slotLengths: (number | null)[] = [];
  for (let slot = 0; slot < level.slotCount; slot++) {
    const rec = recordings[slot];
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
    level,
    recordingSlot,
    slotClasses: slotClasses.slice(),
    slotFrames,
    slotPositions,
    slotAnchors,
    slotLengths,
  };
}

/** Decode a serialized RLE recording into per-tick frames (parity helper). */
export function framesFromRle(rle: number[]): InputFrame[] {
  return decodeInputs(Uint8Array.from(rle));
}

export interface PreSimRun {
  result: PreSimResult;
  /** Wall-clock milliseconds the pre-sim took (worker or fallback). */
  elapsedMs: number;
  /** True when it ran in a real Web Worker. */
  usedWorker: boolean;
}

/**
 * Run the pre-sim, preferring a Web Worker. Times out to the main-thread
 * fallback so the planning phase never hangs.
 */
export function runPreSimClient(req: PreSimRequest): Promise<PreSimRun> {
  const start = performance.now();
  if (typeof Worker === 'undefined') {
    const result = runPreSim(req);
    return Promise.resolve({ result, elapsedMs: performance.now() - start, usedWorker: false });
  }
  return new Promise<PreSimRun>((resolve) => {
    let settled = false;
    let worker: Worker | null = null;
    const finishFallback = (): void => {
      if (settled) return;
      settled = true;
      if (worker) worker.terminate();
      const result = runPreSim(req);
      resolve({ result, elapsedMs: performance.now() - start, usedWorker: false });
    };
    try {
      worker = new Worker(new URL('./scrubber-worker.ts', import.meta.url), { type: 'module' });
      const timeout = setTimeout(finishFallback, 2000);
      worker.onmessage = (ev: MessageEvent<PreSimResult>): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        worker?.terminate();
        resolve({ result: ev.data, elapsedMs: performance.now() - start, usedWorker: true });
      };
      worker.onerror = (): void => {
        clearTimeout(timeout);
        finishFallback();
      };
      worker.postMessage(req);
    } catch {
      finishFallback();
    }
  });
}
