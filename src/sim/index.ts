/**
 * Public surface of the pure simulation layer (FROZEN at M1).
 *
 * Everything a consumer (game/content/tests) needs from the sim is re-exported
 * here so the rest of the codebase never reaches into individual sim modules.
 * See docs/ARCHITECTURE.md "Frozen M1 Contracts".
 */

export * from './prng.js';
export * from './trig.js';
export * from './hash.js';
export * from './vec.js';
export * from './types.js';
export * from './classes.js';
export * from './threat.js';
export * from './recording.js';
export * from './spatial-hash.js';
export * from './level.js';
export * from './boss-pattern.js';
export * from './level-runner.js';
export * from './presim.js';
export {
  createSimState,
  createLevelState,
  cloneSimState,
  step,
  stepMany,
  setEchoInputs,
  setEchoRecordings,
  setBossPattern,
  setLevelMinions,
  countAliveNonParadoxEchoes,
  angleWithin,
  ARENA_HALF,
  BOSS_RADIUS,
  UNIT_RADIUS,
  PHASE1_THRESHOLD,
} from './sim.js';
export type { EchoRecordingMeta } from './sim.js';
