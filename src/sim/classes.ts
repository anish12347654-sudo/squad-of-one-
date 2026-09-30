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

// ---------------------------------------------------------------------------
// M2 classes (brief section 4). Numbers from the brief; tuned lightly for feel.
// ---------------------------------------------------------------------------

export const PYROMANCER: ClassStats = {
  id: 'pyromancer',
  maxHp: 150,
  speed: 185,
  damageTakenMul: 1,
  primaryCd: Math.round(0.8 * SECOND), // fire orb / 0.8 s
  meleeRange: 0,
  meleeHalfArc: 0,
  primaryDamage: 30, // 30 dmg in 50u radius
  healPerTick: 0,
  healRange: 0,
  projectileSpeed: 300, // 300 u/s
  projectileRange: 520,
  skillCd: 12 * SECOND, // Meteor cd 12 s
  dashCd: DASH_CD,
  dashTicks: DASH_TICKS,
  dashDistance: DASH_DISTANCE,
};

export const ROGUE: ClassStats = {
  id: 'rogue',
  maxHp: 170,
  speed: 230,
  damageTakenMul: 1,
  primaryCd: Math.round(0.4 * SECOND), // twin slash / 0.4 s
  meleeRange: 45, // 45u reach
  meleeHalfArc: 512, // ~45 deg half-arc, wide slash
  primaryDamage: 14, // 2 x 14 dmg (applied twice; x2 from behind)
  healPerTick: 0,
  healRange: 0,
  projectileSpeed: 0,
  projectileRange: 0,
  skillCd: 6 * SECOND, // Shadow Step cd 6 s
  dashCd: DASH_CD,
  dashTicks: DASH_TICKS,
  dashDistance: DASH_DISTANCE,
};

export const ENGINEER: ClassStats = {
  id: 'engineer',
  maxHp: 200,
  speed: 180,
  damageTakenMul: 1,
  primaryCd: Math.round(0.3 * SECOND), // bolt / 0.3 s
  meleeRange: 0,
  meleeHalfArc: 0,
  primaryDamage: 12, // 12 dmg
  healPerTick: 0,
  healRange: 0,
  projectileSpeed: 640,
  projectileRange: 300, // range 300u
  skillCd: 12 * SECOND, // Turret cd 12 s
  dashCd: DASH_CD,
  dashTicks: DASH_TICKS,
  dashDistance: DASH_DISTANCE,
};

export const AVATAR: ClassStats = {
  id: 'avatar',
  maxHp: 300,
  speed: 210,
  damageTakenMul: 0.85,
  primaryCd: Math.round(0.35 * SECOND), // chrono blade / 0.35 s
  meleeRange: 70, // melee + short wave
  meleeHalfArc: 448,
  primaryDamage: 25, // 25 dmg
  healPerTick: 0,
  healRange: 0,
  projectileSpeed: 520, // short wave projectile
  projectileRange: 200,
  skillCd: 1, // Convergence is charge-gated, not cd-gated (see sim)
  dashCd: DASH_CD,
  dashTicks: DASH_TICKS,
  dashDistance: DASH_DISTANCE,
};

const TABLE: Record<ClassId, ClassStats> = {
  guardian: GUARDIAN,
  medic: MEDIC,
  ranger: RANGER,
  pyromancer: PYROMANCER,
  rogue: ROGUE,
  engineer: ENGINEER,
  avatar: AVATAR,
};

export const CLASS_IDS: readonly ClassId[] = [
  'guardian',
  'medic',
  'ranger',
  'pyromancer',
  'rogue',
  'engineer',
  'avatar',
];

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

// --- M2 skill tuning (frozen additive) ---

/** Pyromancer fire orb: AoE radius on impact. */
export const FIRE_ORB_RADIUS = 50;
/** Pyromancer Meteor: land delay, damage, AoE radius. */
export const METEOR_FUSE_TICKS = Math.round(1.2 * SECOND);
export const METEOR_DAMAGE = 220;
export const METEOR_RADIUS = 120;

/** Rogue twin slash: bonus multiplier when striking from behind the target. */
export const ROGUE_BACKSTAB_MUL = 2;
/** Rogue Shadow Step: dash distance, dash ticks, invulnerable-hit charges. */
export const SHADOW_STEP_DISTANCE = 220;
export const SHADOW_STEP_TICKS = Math.round(0.3 * SECOND);
export const SHADOW_STEP_INVULN_HITS = 3;

/** Engineer Turret: lifetime, HP, damage, fire cadence, deploy offset. */
export const TURRET_LIFE_TICKS = 10 * SECOND;
export const TURRET_HP = 120;
export const TURRET_DAMAGE = 10;
export const TURRET_FIRE_CD = Math.round(0.5 * SECOND);
export const TURRET_RANGE = 360;
export const TURRET_PROJECTILE_SPEED = 620;

/**
 * Avatar Convergence: base charge time (ticks) and the extra charge rate per
 * alive echo. At tick T the charge advances by 1 + CONVERGE_PER_ECHO * echoes,
 * so more alive echoes fill the bar faster (contract 3.6).
 */
export const CONVERGENCE_CHARGE = 8 * SECOND;
export const CONVERGE_PER_ECHO = 0.5;
/** Convergence fires for this many ticks; each alive echo beams the boss. */
export const CONVERGENCE_FIRE_TICKS = Math.round(0.9 * SECOND);
/** Per-tick beam damage from each alive echo during Convergence. */
export const CONVERGENCE_BEAM_DPS = 90;
/** Avatar passive: damage multiplier bonus per alive non-paradox echo. */
export const AVATAR_DAMAGE_PER_ECHO = 0.2;

// --- Paradox tuning (contract 3.4) ---

/** Anchor tolerance: a recorded interaction must be possible within +/-N ticks. */
export const PARADOX_ANCHOR_TOLERANCE = 5;
/** Path divergence distance threshold in units. */
export const PARADOX_DIVERGE_DIST = 12;
/** Consecutive diverged ticks before a paradox triggers. */
export const PARADOX_DIVERGE_TICKS = 20;
/** Glitch telegraph duration before a paradox echo turns fully hostile. */
export const PARADOX_TELEGRAPH_TICKS = Math.round(0.5 * SECOND);
/** A hostile paradox echo attacks the nearest non-paradox unit within this range. */
export const PARADOX_AGGRO_RANGE = 400;
