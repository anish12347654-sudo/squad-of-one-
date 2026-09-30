/**
 * Campaign progression + unlock gates (brief sections 5 + 6.1).
 *
 * Pure functions mapping a SaveGame's cleared-level records onto: which levels
 * are unlocked (a linear gate - clear the previous level to open the next),
 * which classes are available (the unlock ramp), total stars, and the "next"
 * level to continue into. The world map UI reads these; nothing here touches
 * the sim or storage.
 */

import type { ClassId } from '@sim/index.js';
import type { CampaignLevel } from '@content/campaign.js';
import type { SaveGame } from './save.js';

/** Per-level unlock + stars view for the world map. */
export interface LevelStatus {
  id: string;
  worldId: string;
  index: number;
  unlocked: boolean;
  cleared: boolean;
  bestStars: number;
}

/**
 * Compute the unlock/status of every campaign level for a save. The first level
 * is always unlocked; each subsequent level unlocks once the previous one is
 * cleared (>= 1 star). This is the linear story gate on the world map.
 */
export function levelStatuses(save: SaveGame, levels: readonly CampaignLevel[]): LevelStatus[] {
  const out: LevelStatus[] = [];
  let prevCleared = true; // first level starts unlocked
  levels.forEach((lvl, i) => {
    const rec = save.levels[lvl.id];
    const cleared = rec?.cleared ?? false;
    const bestStars = rec?.bestStars ?? 0;
    const unlocked = i === 0 ? true : prevCleared;
    out.push({ id: lvl.id, worldId: lvl.worldId, index: i, unlocked, cleared, bestStars });
    prevCleared = cleared;
  });
  return out;
}

/** True if a specific level is currently unlocked. */
export function isLevelUnlocked(save: SaveGame, levels: readonly CampaignLevel[], levelId: string): boolean {
  return levelStatuses(save, levels).find((s) => s.id === levelId)?.unlocked ?? false;
}

/**
 * The set of classes available to the player, from the unlock ramp: a class is
 * available once the player has reached (unlocked) the level that grants it.
 * Ranger + Guardian are always available (granted by the first level).
 */
export function unlockedClasses(save: SaveGame, levels: readonly CampaignLevel[]): Set<ClassId> {
  const available = new Set<ClassId>();
  const statuses = levelStatuses(save, levels);
  levels.forEach((lvl, i) => {
    if (statuses[i]?.unlocked) {
      for (const c of lvl.unlocks) available.add(c);
    }
  });
  // The very first level's unlocks (Ranger, Guardian) are always available.
  const first = levels[0];
  if (first) for (const c of first.unlocks) available.add(c);
  return available;
}

/** Total stars earned across the campaign. */
export function totalStars(save: SaveGame, levels: readonly CampaignLevel[]): number {
  let sum = 0;
  for (const lvl of levels) sum += save.levels[lvl.id]?.bestStars ?? 0;
  return sum;
}

/** Maximum possible stars across the campaign. */
export function maxStars(levels: readonly CampaignLevel[]): number {
  return levels.length * 3;
}

/**
 * The level the "Continue" button should open: the first unlocked-but-uncleared
 * level, or the last level if everything is cleared.
 */
export function nextLevelId(save: SaveGame, levels: readonly CampaignLevel[]): string | null {
  const statuses = levelStatuses(save, levels);
  for (const s of statuses) {
    if (s.unlocked && !s.cleared) return s.id;
  }
  return levels.length > 0 ? levels[levels.length - 1]!.id : null;
}

/** True once the whole campaign is cleared (the final level has >= 1 star). */
export function campaignComplete(save: SaveGame, levels: readonly CampaignLevel[]): boolean {
  const last = levels[levels.length - 1];
  return last ? (save.levels[last.id]?.cleared ?? false) : false;
}
