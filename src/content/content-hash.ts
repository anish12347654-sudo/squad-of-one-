/**
 * Content hash (brief section 6.4).
 *
 * A single 32-bit fingerprint of the *gameplay content* that affects
 * deterministic replay: the pure `LevelDef` of every campaign level (arena
 * dimensions, loop length, slot count, spawns, boss stats + pattern,
 * interactables and minion schedules). It is embedded in every replay code
 * next to the sim version; a client refuses to replay a code whose content
 * hash differs (which would otherwise desync silently as the level layout
 * changed underneath the recording).
 *
 * Presentation-only campaign metadata (i18n keys, story, unlocks, tutorials,
 * cosmetics) is deliberately EXCLUDED - it never changes deterministic
 * playback, so re-theming a level must not invalidate existing replay codes.
 *
 * Uses the sim's own FNV-1a `hashState` over a canonical JSON view of the
 * level defs, so it is stable, order-independent and matches the determinism
 * fingerprint machinery.
 */

import { hashState } from '@sim/index.js';
import type { LevelDef } from '@sim/index.js';
import { CAMPAIGN_LEVELS } from './levels/campaign-levels.js';

/** The sim-facing fields of a LevelDef that affect deterministic replay. */
function levelFingerprint(def: LevelDef): unknown {
  return {
    id: def.id,
    halfWidth: def.halfWidth,
    halfHeight: def.halfHeight,
    loopLength: def.loopLength,
    slotCount: def.slotCount,
    spawns: def.spawns,
    boss: def.boss,
    starEchoesAlive: def.starEchoesAlive,
    objective: def.objective ?? 'boss',
    interactables: def.interactables ?? [],
    minions: def.minions ?? [],
    echoHpScale: def.echoHpScale ?? 1,
  };
}

let cached: number | null = null;

/**
 * Compute (and cache) the content hash across all campaign level defs, plus any
 * extra ad-hoc levels (e.g. Daily-modified levels) the caller wants included.
 * The base hash covers the frozen campaign; Daily runs derive their own level
 * from campaign data + typed modifiers, so their hash equals the base hash (the
 * modifiers travel inside the replay/daily payload, not the content set).
 */
export function contentHash(): number {
  if (cached !== null) return cached;
  const view = CAMPAIGN_LEVELS.map((l) => levelFingerprint(l.def));
  cached = hashState(view);
  return cached;
}

/** Hash a single arbitrary LevelDef (used by tests + Daily determinism checks). */
export function hashLevelDef(def: LevelDef): number {
  return hashState(levelFingerprint(def));
}
