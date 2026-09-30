/**
 * Campaign structure (brief sections 5, 6.1, 8): worlds, the 19-level unlock
 * ramp, per-world palette/hazard/musical-scale/boss-intro metadata, objective
 * types, story dialogue keys and star targets.
 *
 * This is a PRESENTATION + progression wrapper around the pure `LevelDef` the
 * sim consumes. The sim never reads it: it authors campaign flow (which level
 * unlocks next, which classes are available, which story panel shows) and the
 * cosmetic world theming. Every user-facing string is an i18n key, never a
 * literal (enforced by the no-hard-coded-strings test on the UI layer).
 */

import type { ClassId, LevelDef } from '@sim/index.js';

/** The four objective types (brief section 5). */
export type ObjectiveType = 'boss' | 'survive' | 'heist' | 'build';

/** A world groups levels and owns the palette / hazard / scale / intro card. */
export interface WorldTheme {
  id: string;
  /** i18n key for the world name shown on the map + intro card. */
  nameKey: string;
  /** Background + accent palette (0xRRGGBB) for the render/UI layers. */
  palette: {
    bg: number;
    floor: number;
    accent: number;
    hazard: number;
  };
  /** Hazard flavour hint the render layer themes (visual only). */
  hazard: 'none' | 'gears' | 'sandstorm' | 'freeze';
  /**
   * Musical scale key the adaptive audio engine selects for this world
   * (semitone offsets from the root). Presentation only.
   */
  musicalScale: readonly number[];
  /** i18n key for this world's boss intro title-card line. */
  bossIntroKey: string;
}

/** One handcrafted campaign level: the sim LevelDef plus campaign metadata. */
export interface CampaignLevel {
  id: string;
  worldId: string;
  /** i18n key for the level's display name. */
  nameKey: string;
  objective: ObjectiveType;
  /** The pure sim definition. */
  def: LevelDef;
  /** Classes newly unlocked by reaching this level (cumulative across ramp). */
  unlocks: ClassId[];
  /** Story dialogue keys shown before the level (1-3 lines). */
  storyKeys: readonly string[];
  /**
   * i18n key for the short tutorial panel introducing a new element on this
   * level, or null if it introduces nothing new.
   */
  tutorialKey: string | null;
  /**
   * A reference bot plan (classIds per slot) proven to win with >= 1 star. The
   * solution recorder + solution test drive this plan; the game does not read
   * it. Kept alongside the level so balance + solvability stay together.
   */
  solutionPlan: ClassId[];
  /** Stars needed on the world map to consider the level "mastered" (3). */
  starMax: 3;
}
