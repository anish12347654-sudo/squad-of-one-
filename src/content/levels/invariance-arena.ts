/**
 * A dedicated test arena for the Invariance Rule (brief 3.3).
 *
 * The live player spawns far from the boss and the other slots, well outside
 * every attack radius, so a no-input run cannot interact with anything. The
 * boss's target is the recorded echo, so the world should reproduce the prior
 * loop tick-for-tick when the live player does nothing.
 */

import type { LevelDef, BossPatternStep } from '@sim/index.js';

const SECOND = 60;

const PATTERN: BossPatternStep[] = [
  {
    shape: 'slam',
    telegraphTicks: Math.round(0.8 * SECOND),
    activeTicks: 6,
    recoveryTicks: Math.round(0.6 * SECOND),
    radius: 120,
    halfArc: 0,
    damage: 20,
    maxHpFraction: 1,
  },
];

export const INVARIANCE_ARENA: LevelDef = {
  id: 'invariance-arena',
  halfWidth: 900,
  halfHeight: 900,
  loopLength: 8 * SECOND,
  slotCount: 3,
  spawns: [
    { x: -100, y: 200, facing: 3072 }, // slot 0: an active fighter near the boss
    { x: 820, y: 820, facing: 0 }, // slot 1: far corner (the "no-op" live player)
    { x: -820, y: 820, facing: 0 }, // slot 2: far corner
  ],
  boss: {
    x: 0,
    y: -200,
    maxHp: 5000,
    radius: 46,
    speed: 90,
    phaseThreshold: 0.5,
    pattern: PATTERN,
  },
  starEchoesAlive: 1,
};
