/**
 * Class kit stats for the pure sim (M1 subset: Guardian, Medic, Ranger).
 *
 * These are the numbers the deterministic sim reads every tick, so they live in
 * src/sim as frozen constant data (part of the M1 contract). Presentation-only
 * facts (display name, colour, sound, blurb) live in src/content/classes.ts and
 * never touch the sim. All durations are in TICKS (60 = 1 second).
 *
 * Numbers come from brief section 4; tuned lightly for feel.
 */

import type { ClassId } from './types.js';

export interface ClassStats {
  id: ClassId;
  maxHp: number;
  /** Movement speed in units per second. */
  speed: number;
  /** Fraction of incoming damage removed by a class passive (Guardian tank). */
  damageTakenMul: number;

  // Primary attack.
  /** Ticks between primary attacks. */
  primaryCd: number;
  /** Melee arc reach (Guardian) or 0 if not melee. */
  meleeRange: number;
  /** Melee arc half-width in brads (Guardian). */
  meleeHalfArc: number;
  /** Primary damage (Guardian bash / Ranger arrow). 0 for the Medic. */
  primaryDamage: number;
  /** Heal-per-tick for the Medic beam (0 for others). */
  healPerTick: number;
  /** Heal beam range (Medic). */
  healRange: number;
  /** Ranger arrow: projectile speed (u/s), range, else 0. */
  projectileSpeed: number;
  projectileRange: number;

  // Skill.
  /** Ticks of skill cooldown. */
  skillCd: number;

  // Dash (shared).
  /** Ticks of dash cooldown. */
  dashCd: number;
  /** Ticks the dash movement lasts. */
  dashTicks: number;
  /** Total dash distance in units (spread across dashTicks). */
  dashDistance: number;
}

const SECOND = 60;

/** Convert units/second to units/tick. */
export function perTick(unitsPerSecond: number): number {
  return unitsPerSecond / SECOND;
}

/** Shared dash: ~120 u over 0.2 s, 3 s cooldown (brief section 4). */
const DASH_TICKS = Math.round(0.2 * SECOND); // 12
const DASH_DISTANCE = 120;
const DASH_CD = 3 * SECOND;

export const GUARDIAN: ClassStats = {
  id: 'guardian',
  maxHp: 400,
  speed: 150,
  damageTakenMul: 0.7, // takes 30% less damage
  primaryCd: Math.round(0.6 * SECOND), // 36
  meleeRange: 60,
  meleeHalfArc: 256, // ~22.5 deg half-arc (4096 brads per turn)
  primaryDamage: 20,
  healPerTick: 0,
  healRange: 0,
  projectileSpeed: 0,
  projectileRange: 0,
  skillCd: 8 * SECOND,
  dashCd: DASH_CD,
  dashTicks: DASH_TICKS,
  dashDistance: DASH_DISTANCE,
};

export const MEDIC: ClassStats = {
  id: 'medic',
  maxHp: 180,
  speed: 190,
  damageTakenMul: 1,
  primaryCd: 1, // continuous beam: re-applies every tick
  meleeRange: 0,
  meleeHalfArc: 0,
  primaryDamage: 0,
  healPerTick: 30 / SECOND, // 30 HP/s
  healRange: 260,
  projectileSpeed: 0,
  projectileRange: 0,
  skillCd: 10 * SECOND,
  dashCd: DASH_CD,
  dashTicks: DASH_TICKS,
  dashDistance: DASH_DISTANCE,
};

export const RANGER: ClassStats = {
  id: 'ranger',
  maxHp: 160,
  speed: 200,
  damageTakenMul: 1,
  primaryCd: Math.round(0.35 * SECOND), // 21
  meleeRange: 0,
  meleeHalfArc: 0,
  primaryDamage: 18,
  healPerTick: 0,
  healRange: 0,
  projectileSpeed: 520,
  projectileRange: 600,
  skillCd: 7 * SECOND,
  dashCd: DASH_CD,
  dashTicks: DASH_TICKS,
  dashDistance: DASH_DISTANCE,
};

const TABLE: Record<ClassId, ClassStats> = {
  guardian: GUARDIAN,
  medic: MEDIC,
  ranger: RANGER,
};

export const CLASS_IDS: readonly ClassId[] = ['guardian', 'medic', 'ranger'];

export function classStats(id: ClassId): ClassStats {
  return TABLE[id];
}

// --- Skill tuning (frozen) ---

/** Guardian Taunt: forces boss aggro for this many ticks. */
export const TAUNT_TICKS = 4 * SECOND;
/** Medic Sanctuary: zone radius, buff duration, damage multiplier. */
export const SANCTUARY_RADIUS = 110;
export const SANCTUARY_TICKS = 3 * SECOND;
export const SANCTUARY_DAMAGE_MUL = 0.5;
/** Ranger Piercing Shot: charge time, damage, line half-width. */
export const PIERCING_CHARGE_TICKS = 1 * SECOND;
export const PIERCING_DAMAGE = 120;
export const PIERCING_HALF_WIDTH = 24;
export const PIERCING_RANGE = 700;
export const PIERCING_SPEED = 900;
