/**
 * Economy + progression math (brief section 7): XP/levels, per-class mastery,
 * and the soft currency "Chrono Shards" earned by play.
 *
 * Pure functions only - no state, no I/O. The save layer stores the resulting
 * totals; this module computes rewards and level thresholds deterministically
 * so tests can assert exact numbers.
 *
 * HARD RULES: shards are earned ONLY through play (there is no purchase path in
 * this module and the monetization adapter is cosmetic/consumable-free by
 * contract). Rewards depend on stars, not spend.
 */

/** Stars a level can award (contract 3.1). */
export type StarCount = 0 | 1 | 2 | 3;

/** XP awarded for finishing a level, by stars earned. */
export const XP_BY_STARS: Readonly<Record<StarCount, number>> = {
  0: 0,
  1: 40,
  2: 70,
  3: 110,
};

/** Chrono Shards awarded for finishing a level, by stars earned. */
export const SHARDS_BY_STARS: Readonly<Record<StarCount, number>> = {
  0: 0,
  1: 15,
  2: 30,
  3: 55,
};

/** Per-class mastery XP awarded when a class is used in a winning loop. */
export const MASTERY_XP_PER_WIN = 25;

/**
 * First-clear bonus: the first time a level is beaten it grants extra shards.
 * Prevents grinding the same level as the optimal shard farm (replays give the
 * reduced, repeat amount) while keeping progress feeling generous.
 */
export const FIRST_CLEAR_SHARD_BONUS = 25;

/** Reward for one level completion. */
export interface LevelReward {
  xp: number;
  shards: number;
  masteryXp: number;
}

/**
 * Compute the reward for finishing a level.
 * @param stars       stars earned (0..3)
 * @param firstClear  true if this is the first ever clear of the level
 */
export function levelReward(stars: StarCount, firstClear: boolean): LevelReward {
  const xp = XP_BY_STARS[stars];
  let shards = SHARDS_BY_STARS[stars];
  if (firstClear && stars > 0) shards += FIRST_CLEAR_SHARD_BONUS;
  const masteryXp = stars > 0 ? MASTERY_XP_PER_WIN : 0;
  return { xp, shards, masteryXp };
}

/**
 * XP required to advance FROM account level `level` to `level+1`.
 * A gentle quadratic curve: 100 * level (level 1->2 needs 100, 2->3 needs 200).
 */
export function xpForNextLevel(level: number): number {
  const l = Math.max(1, Math.floor(level));
  return 100 * l;
}

/** Account progress derived from a total XP pool. */
export interface AccountProgress {
  level: number;
  /** XP accumulated toward the next level. */
  xpIntoLevel: number;
  /** XP needed to reach the next level. */
  xpForNext: number;
}

/** Derive account level + progress from a lifetime XP total. Deterministic. */
export function accountProgress(totalXp: number): AccountProgress {
  let level = 1;
  let remaining = Math.max(0, Math.floor(totalXp));
  // Cap the loop so a corrupt/huge value cannot spin forever.
  while (level < 999) {
    const need = xpForNextLevel(level);
    if (remaining < need) break;
    remaining -= need;
    level += 1;
  }
  return { level, xpIntoLevel: remaining, xpForNext: xpForNextLevel(level) };
}

/** Mastery tier thresholds (cumulative mastery XP) -> tier index. */
export const MASTERY_TIER_THRESHOLDS: readonly number[] = [0, 100, 250, 500, 900];

/** Mastery tier (0..5) for a given cumulative mastery XP. */
export function masteryTier(masteryXp: number): number {
  const x = Math.max(0, Math.floor(masteryXp));
  let tier = 0;
  for (let i = 0; i < MASTERY_TIER_THRESHOLDS.length; i++) {
    if (x >= MASTERY_TIER_THRESHOLDS[i]!) tier = i + 1;
  }
  return tier;
}
