/**
 * Web Worker entry for the planning-phase pre-simulation (contract 3.7).
 *
 * It imports the IDENTICAL engine-free sim (`runPreSim` from src/sim) so the
 * hashes it produces are bit-for-bit identical to the main thread. The worker
 * receives a serializable PreSimRequest and posts back the PreSimResult.
 *
 * Vite bundles this as an ES-module worker (see vite.config.ts `worker.format`).
 */

import { runPreSim } from '@sim/index.js';
import type { PreSimRequest, PreSimResult } from '@sim/index.js';

self.onmessage = (ev: MessageEvent<PreSimRequest>): void => {
  const result: PreSimResult = runPreSim(ev.data);
  (self as unknown as Worker).postMessage(result);
};
