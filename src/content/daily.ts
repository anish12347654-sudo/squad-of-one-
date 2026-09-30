/**
 * Daily Paradox (brief section 6.2).
 *
 * The calendar DATE - computed OUTSIDE the sim - is turned into a seed that
 * deterministically picks ONE campaign level plus TWO distinct modifiers. The
 * same date always yields the same challenge for every player, but the sim
 * itself never sees the wall clock: the caller passes in a date string, this
 * pure module derives the seed + selection, and the modified level is played
 * through the identical frozen `step()` path.
 *
 * Score = win time bonus + echoes alive + rewrites bonus + early victory bonus
 * (brief 6.2). Higher is better. A local best is kept in the save (see the
 * Daily scene). This module is PURE: no Date, no Math.random - the caller
 * supplies today's date key.
 */

import type { LevelDef, ClassId } from '@sim/index.js';
import { CAMPAIGN_LEVELS } from './levels/campaign-levels.js';
import { MODIFIERS, applyModifiers, type Modifier } from './modifiers.js';

/** A resolved daily challenge: the seed, the base + modified level and mods. */
export interface DailyChallenge {
  /** The date key this challenge was derived from (YYYY-MM-DD). */
  dateKey: string;
  /** The 32-bit seed derived from the date (outside the sim). */
  seed: number;
  /** The chosen campaign level id. */
  levelId: string;
  /** The two chosen modifiers (distinct). */
  modifiers: Modifier[];
  /** The transformed level definition to play. */
  def: LevelDef;
  /** Combined echo starting-HP scale from the modifiers. */
  echoStartHpScale: number;
  /** Fixed slate of classes used for a Daily's auto-plan (unique per slot). */
  classPlan: ClassId[];
}

/** FNV-1a over a string -> 32-bit seed. Deterministic, engine-free. */
export function seedFromDateKey(dateKey: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < dateKey.length; i++) {
    h ^= dateKey.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A tiny deterministic LCG stepping a 32-bit state (outside the sim). */
function nextRand(state: number): { value: number; state: number } {
  const s = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  return { value: s, state: s };
}

/**
 * The date key for a JS Date in UTC (YYYY-MM-DD). This is the ONLY spot that
 * reads a Date, and it lives in content (not the sim). Callers in tests pass an
 * explicit key so nothing depends on the wall clock there.
 */
export function dateKeyOf(date: Date): string {
  const y = date.getUTCFullYear();
  const m = `${date.getUTCMonth() + 1}`.padStart(2, '0');
  const d = `${date.getUTCDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Levels eligible for the Daily (boss objective, at least 3 slots for depth). */
function eligibleLevels(): readonly { id: string; def: LevelDef; plan: ClassId[] }[] {
  return CAMPAIGN_LEVELS.filter(
    (l) => (l.def.objective ?? 'boss') === 'boss' && l.def.slotCount >= 3,
  ).map((l) => ({ id: l.id, def: l.def, plan: l.solutionPlan.slice() }));
}

/**
 * Resolve the Daily challenge for a date key. Deterministic: the same key
 * always selects the same level + the same two distinct modifiers.
 */
export function resolveDaily(dateKey: string): DailyChallenge {
  const seed = seedFromDateKey(dateKey);
  const levels = eligibleLevels();

  let state = seed;
  let r = nextRand(state);
  const level = levels[r.value % levels.length]!;
  state = r.state;

  // Pick two DISTINCT modifiers deterministically.
  r = nextRand(state);
  const iA = r.value % MODIFIERS.length;
  state = r.state;
  r = nextRand(state);
  let iB = r.value % MODIFIERS.length;
  if (iB === iA) iB = (iB + 1) % MODIFIERS.length;
  state = r.state;

  const modifiers = [MODIFIERS[iA]!, MODIFIERS[iB]!];
  const { def, echoStartHpScale } = applyModifiers(level.def, modifiers);

  // The class plan is the level's proven plan, trimmed to the (possibly
  // reduced) slot count so a five-slots modifier still yields a valid plan.
  const classPlan = level.plan.slice(0, def.slotCount);

  return {
    dateKey,
    seed,
    levelId: level.id,
    modifiers,
    def,
    echoStartHpScale,
    classPlan,
  };
}

// ---------------------------------------------------------------------------
// Scoring (brief 6.2): win time + echoes alive + rewrites + early victory.
// ---------------------------------------------------------------------------

export interface DailyRunResult {
  won: boolean;
  /** Tick the loop was won on (fewer = faster within the loop). */
  winTick: number;
  /** Loop length in ticks (for the time bonus). */
  loopLength: number;
  /** Alive non-paradox echoes at the win. */
  echoesAlive: number;
  /** Rewrites used (fewer = better). */
  rewritesUsed: number;
  /** Slot the win landed on (earlier = earlier victory). */
  wonOnSlot: number;
  /** Total slots (to detect an early victory). */
  slotCount: number;
}

/** Weights for the Daily score (tuned so a clean, fast, full-squad win shines). */
export const DAILY_SCORE = {
  base: 1000,
  perEchoAlive: 250,
  timeBonusMax: 800,
  perRewritePenalty: 150,
  earlyVictoryBonus: 500,
} as const;

/**
 * Compute the Daily score for a finished run. A loss scores 0. The time bonus
 * rewards winning earlier within the final loop; echoes-alive and an early
 * victory add on top; each rewrite used costs a little.
 */
export function scoreDaily(r: DailyRunResult): number {
  if (!r.won) return 0;
  const timeFrac = r.loopLength > 0 ? Math.max(0, 1 - r.winTick / r.loopLength) : 0;
  const timeBonus = Math.round(timeFrac * DAILY_SCORE.timeBonusMax);
  const echoBonus = r.echoesAlive * DAILY_SCORE.perEchoAlive;
  const rewritePenalty = r.rewritesUsed * DAILY_SCORE.perRewritePenalty;
  const early = r.wonOnSlot >= 0 && r.wonOnSlot < r.slotCount - 1 ? DAILY_SCORE.earlyVictoryBonus : 0;
  return Math.max(0, DAILY_SCORE.base + timeBonus + echoBonus + early - rewritePenalty);
}
