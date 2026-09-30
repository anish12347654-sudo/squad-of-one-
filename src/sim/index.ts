/**
 * Public surface of the pure simulation layer.
 *
 * Everything a consumer (game/content/tests) needs from the sim is re-exported
 * here so the rest of the codebase never reaches into individual sim modules.
 */

export * from './prng.js';
export * from './trig.js';
export * from './hash.js';
export * from './types.js';
export { createSimState, cloneSimState, step, stepMany } from './sim.js';
