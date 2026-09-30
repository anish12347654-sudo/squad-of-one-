/**
 * Simulation version (brief section 6.4).
 *
 * A single monotonic integer that identifies the simulation *rules*: the
 * `step()` semantics, entity model, class stats, threat constants, and the
 * recording/RLE layout. It is embedded in every shared replay code so a client
 * can refuse to replay a code produced by an incompatible sim (which would
 * otherwise desync silently). Bump this whenever a change alters deterministic
 * playback of an existing recording.
 *
 * This lives in the pure sim layer and is a plain constant - no wall clock, no
 * randomness. M0-M3 shipped with the frozen contracts; M4 is the first version
 * that pins the number explicitly for the replay-share feature.
 */

/** The current simulation version. Increment on any determinism-affecting change. */
export const SIM_VERSION = 1;
