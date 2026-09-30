/**
 * M1 arena "The Proving Ground" - the single vertical-slice level.
 *
 * Pure content data authored against the frozen sim API. Three slots, a 20 s
 * loop, one boss ("The Warden") with a telegraphed pattern and a phase-1
 * threshold at 50% HP. Spawn zones sit apart and clear of the boss so nothing
 * overlaps (there are no hazards or interactables in M1).
 */

import type { LevelDef, BossPatternStep } from '@sim/index.js';

const SECOND = 60;

/**
 * Boss pattern script. Cycles slam -> cone -> charge; the charge is phase-2
 * only (gated to <= 50% HP) so the fight escalates past the threshold.
 */
const WARDEN_PATTERN: BossPatternStep[] = [
  {
    shape: 'slam',
    telegraphTicks: Math.round(0.9 * SECOND),
    activeTicks: 6,
    recoveryTicks: Math.round(0.8 * SECOND),
    radius: 130,
    halfArc: 0,
    damage: 26,
    maxHpFraction: 1,
  },
  {
    shape: 'cone',
    telegraphTicks: Math.round(0.8 * SECOND),
    activeTicks: 6,
    recoveryTicks: Math.round(0.7 * SECOND),
    radius: 260,
    halfArc: 640, // ~56 deg half-arc
    damage: 22,
    maxHpFraction: 1,
  },
  {
    shape: 'charge',
    telegraphTicks: Math.round(0.7 * SECOND),
    activeTicks: 8,
    recoveryTicks: Math.round(0.9 * SECOND),
    radius: 620, // lane length
    halfArc: 60, // lane half-width in units
    damage: 30,
    maxHpFraction: 0.5, // phase 2 only
  },
];

export const ARENA_01: LevelDef = {
  id: 'arena-01',
  halfWidth: 500,
  halfHeight: 500,
  loopLength: 20 * SECOND, // 1200 ticks = 20 s
  slotCount: 3,
  spawns: [
    { x: -220, y: 260, facing: 3072 }, // bottom-left, facing up
    { x: 0, y: 300, facing: 3072 }, // bottom-centre, facing up
    { x: 220, y: 260, facing: 3072 }, // bottom-right, facing up
  ],
  boss: {
    x: 0,
    y: -220,
    maxHp: 1300,
    radius: 46,
    speed: 90,
    phaseThreshold: 0.5,
    pattern: WARDEN_PATTERN,
  },
  starEchoesAlive: 1,
};
