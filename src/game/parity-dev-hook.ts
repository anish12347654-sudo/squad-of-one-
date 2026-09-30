/**
 * Dev/e2e-only parity hook (brief section 10, gate 2). Runs the PURE parity
 * harness in the browser and exposes the result on `window.__SQUAD_DET` so the
 * Playwright parity spec can compare the browser hashes against the committed
 * Node fixture (Node-vs-browser hash parity on the same replay).
 *
 * Gated by the caller behind `__DEV_TOOLS__`; touches only window; never used by
 * live play.
 */

import { runParity, PARITY_LEVEL, PARITY_PLAN, type ParityResult } from '@content/index.js';

export interface SquadDetGlobal {
  /** Run the fixed parity level+plan and return the hash result. */
  run(sampleEvery?: number): ParityResult;
  level: string;
  plan: string[];
}

declare global {
  interface Window {
    __SQUAD_DET?: SquadDetGlobal;
  }
}

export function installParityDevHook(): void {
  if (typeof window === 'undefined') return;
  window.__SQUAD_DET = {
    run: (sampleEvery = 30) => runParity(PARITY_LEVEL, PARITY_PLAN, sampleEvery),
    level: PARITY_LEVEL,
    plan: PARITY_PLAN,
  };
}
