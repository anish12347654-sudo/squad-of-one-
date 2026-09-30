/**
 * M2 arena "The Convergence" - a 7-slot showcase level.
 *
 * Seven recording slots (the last is always the Final Avatar, per section 4), a
 * 20 s loop, the Warden boss with an escalating pattern, and two Time Shards
 * placed as interactables so a rewrite in a changed world can break an anchor
 * (paradox). Pure content data authored against the frozen sim API.
 */

import type { LevelDef, BossPatternStep } from '@sim/index.js';

const SECOND = 60;

const WARDEN_PATTERN: BossPatternStep[] = [
  {
    shape: 'slam',
    telegraphTicks: Math.round(0.9 * SECOND),
    activeTicks: 6,
    recoveryTicks: Math.round(0.7 * SECOND),
    radius: 130,
    halfArc: 0,
    damage: 24,
    maxHpFraction: 1,
  },
  {
    shape: 'cone',
    telegraphTicks: Math.round(0.8 * SECOND),
    activeTicks: 6,
    recoveryTicks: Math.round(0.6 * SECOND),
    radius: 280,
    halfArc: 640,
    damage: 20,
    maxHpFraction: 1,
  },
  {
    shape: 'charge',
    telegraphTicks: Math.round(0.7 * SECOND),
    activeTicks: 8,
    recoveryTicks: Math.round(0.8 * SECOND),
    radius: 640,
    halfArc: 64,
    damage: 28,
    maxHpFraction: 0.5,
  },
];

export const ARENA_02: LevelDef = {
  id: 'arena-02',
  halfWidth: 520,
  halfHeight: 520,
  loopLength: 20 * SECOND,
  slotCount: 7,
  spawns: [
    { x: -300, y: 300, facing: 3072 },
    { x: -180, y: 340, facing: 3072 },
    { x: -60, y: 360, facing: 3072 },
    { x: 60, y: 360, facing: 3072 },
    { x: 180, y: 340, facing: 3072 },
    { x: 300, y: 300, facing: 3072 },
    { x: 0, y: 240, facing: 3072 }, // last slot = Avatar
  ],
  boss: {
    x: 0,
    y: -240,
    // Tuned so the squad cannot burst it down before the Final Avatar's loop:
    // the Convergence ultimate is the intended finisher for this showcase level.
    maxHp: 9000,
    radius: 46,
    speed: 90,
    phaseThreshold: 0.5,
    pattern: WARDEN_PATTERN,
  },
  starEchoesAlive: 2,
  interactables: [
    { kind: 'shard', x: -140, y: 40, radius: 42 },
    { kind: 'shard', x: 140, y: 40, radius: 42 },
  ],
};
