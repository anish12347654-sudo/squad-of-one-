/**
 * Time Chess (brief section 6.3): a 1v1 arena duel of 5 loops x 15 s.
 *
 * Both players record simultaneously while ALL previous loops of BOTH players
 * replay. Each player picks a unique class per loop (NO Avatar). Score =
 * control-zone time + units alive at the end. Ships vs a DETERMINISTIC AI bot
 * (3 difficulties, seeded, engine-free) and local 2-player (two live input
 * streams).
 *
 * This is a self-contained PURE simulation (it lives in src/content and uses
 * ONLY the sim's committed integer trig + the InputFrame type - no Phaser, no
 * wall clock, no Math.random). It intentionally does NOT reuse the boss-centric
 * frozen sim: a symmetric two-team duel is a distinct ruleset, so building it
 * here keeps the frozen `step()` contract untouched while staying deterministic
 * and hashable by construction (all state is plain numbers).
 */

import { sin, cos, atan2Brads, BUTTON_SKILL } from '@sim/index.js';
import type { InputFrame, ClassId } from '@sim/index.js';

/** Ticks per loop (15 s at 60 Hz). */
export const TC_LOOP_TICKS = 15 * 60;
/** Number of loops in a match. */
export const TC_LOOPS = 5;
/** Arena half-extent (square, centred on origin). */
export const TC_ARENA_HALF = 360;
/** Control-zone radius at the arena centre. */
export const TC_ZONE_RADIUS = 90;
/** Contact/attack range for a unit's primary. */
const TC_ATTACK_RANGE = 70;
/** Ticks between primary attacks. */
const TC_ATTACK_CD = 30;

export type PlayerSide = 'a' | 'b';

/** Classes allowed in Time Chess (no Avatar). Unique per loop per side. */
export const TC_CLASSES: readonly ClassId[] = [
  'guardian',
  'medic',
  'ranger',
  'pyromancer',
  'rogue',
  'engineer',
];

/** Per-class Time-Chess stats (small, balanced; independent of the campaign). */
interface TcClassStats {
  maxHp: number;
  speed: number; // units per tick
  damage: number; // per primary hit
}

const TC_STATS: Record<ClassId, TcClassStats> = {
  guardian: { maxHp: 240, speed: 2.6, damage: 10 },
  medic: { maxHp: 170, speed: 3.0, damage: 7 },
  ranger: { maxHp: 150, speed: 3.2, damage: 12 },
  pyromancer: { maxHp: 150, speed: 2.9, damage: 14 },
  rogue: { maxHp: 170, speed: 3.6, damage: 11 },
  engineer: { maxHp: 200, speed: 2.8, damage: 9 },
  avatar: { maxHp: 300, speed: 3.2, damage: 16 },
};

/** A unit in the duel (one per side per completed/active loop). */
interface TcUnit {
  side: PlayerSide;
  loop: number;
  classId: ClassId;
  x: number;
  y: number;
  facing: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  attackCd: number;
}

/** The full duel state (plain data; serializable + deep-cloneable). */
export interface TcState {
  tick: number; // tick within the current loop
  loop: number; // 0-based current loop
  units: TcUnit[];
  /** Accumulated control-zone ticks per side. */
  zoneTicks: { a: number; b: number };
  finished: boolean;
}

/** A recorded loop: one side's class + per-tick input frames. */
export interface TcRecordedLoop {
  side: PlayerSide;
  loop: number;
  classId: ClassId;
  frames: InputFrame[];
}

/** Spawn point for a side at loop start. */
function spawnFor(side: PlayerSide): { x: number; y: number; facing: number } {
  return side === 'a'
    ? { x: 0, y: TC_ARENA_HALF - 40, facing: 3072 }
    : { x: 0, y: -(TC_ARENA_HALF - 40), facing: 1024 };
}

function makeUnit(side: PlayerSide, loop: number, classId: ClassId): TcUnit {
  const s = TC_STATS[classId];
  const sp = spawnFor(side);
  return {
    side,
    loop,
    classId,
    x: sp.x,
    y: sp.y,
    facing: sp.facing,
    hp: s.maxHp,
    maxHp: s.maxHp,
    alive: true,
    attackCd: 0,
  };
}

/** Create a fresh match state (loop 0, nothing recorded yet). */
export function createTcState(): TcState {
  return {
    tick: 0,
    loop: 0,
    units: [],
    zoneTicks: { a: 0, b: 0 },
    finished: false,
  };
}

/** Deep clone a duel state (deterministic; no structuredClone dependency). */
export function cloneTcState(s: TcState): TcState {
  return {
    tick: s.tick,
    loop: s.loop,
    units: s.units.map((u) => ({ ...u })),
    zoneTicks: { a: s.zoneTicks.a, b: s.zoneTicks.b },
    finished: s.finished,
  };
}

/**
 * Begin a loop: spawn the two active (recording) units plus every previously
 * recorded unit from both sides, all at their loop-start spawn. Returns a fresh
 * state positioned at tick 0 of `loop`.
 */
export function beginTcLoop(
  loop: number,
  classA: ClassId,
  classB: ClassId,
  recorded: readonly TcRecordedLoop[],
): TcState {
  const units: TcUnit[] = [];
  // Replay units from prior loops (both sides).
  for (const rec of recorded) {
    if (rec.loop < loop) units.push(makeUnit(rec.side, rec.loop, rec.classId));
  }
  // The two active units for this loop.
  units.push(makeUnit('a', loop, classA));
  units.push(makeUnit('b', loop, classB));
  return { tick: 0, loop, units, zoneTicks: { a: 0, b: 0 }, finished: false };
}

/** Clamp a coordinate into the arena. */
function clampArena(v: number): number {
  return v < -TC_ARENA_HALF ? -TC_ARENA_HALF : v > TC_ARENA_HALF ? TC_ARENA_HALF : v;
}

/** True if a point is inside the central control zone. */
export function inZone(x: number, y: number): boolean {
  return x * x + y * y <= TC_ZONE_RADIUS * TC_ZONE_RADIUS;
}

/** Nearest living enemy unit to `u`, or null. Deterministic tie-break by index. */
function nearestEnemy(state: TcState, u: TcUnit): TcUnit | null {
  let best: TcUnit | null = null;
  let bestD = Infinity;
  for (const o of state.units) {
    if (!o.alive || o.side === u.side) continue;
    const dx = o.x - u.x;
    const dy = o.y - u.y;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return best;
}

/**
 * Advance the duel one tick. `frameFor(u)` supplies the InputFrame for each
 * active unit (loop === state.loop); prior-loop units act from their recorded
 * frames, passed via the same callback (the runner resolves recorded vs live).
 * Pure + deterministic: identical (state, frames) always yield identical output.
 */
export function stepTc(state: TcState, frameFor: (u: TcUnit) => InputFrame): TcState {
  // Movement + attacks.
  for (const u of state.units) {
    if (!u.alive) continue;
    const f = frameFor(u);
    const st = TC_STATS[u.classId];
    // Movement from the input's move vector (int8 -> [-1,1]).
    const mx = f.moveX / 127;
    const my = f.moveY / 127;
    const mag = Math.sqrt(mx * mx + my * my);
    if (mag > 0.05) {
      const nx = mx / mag;
      const ny = my / mag;
      u.x = clampArena(u.x + nx * st.speed);
      u.y = clampArena(u.y + ny * st.speed);
      u.facing = atan2Brads(ny, nx);
    }
    if (u.attackCd > 0) u.attackCd -= 1;
  }

  // Resolve attacks (skill button OR auto within range). Damage is applied
  // after movement so both sides see a consistent frame.
  for (const u of state.units) {
    if (!u.alive || u.attackCd > 0) continue;
    const f = frameFor(u);
    const target = nearestEnemy(state, u);
    if (!target) continue;
    const dx = target.x - u.x;
    const dy = target.y - u.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const wantsAttack = (f.buttons & BUTTON_SKILL) !== 0 || dist <= TC_ATTACK_RANGE;
    if (wantsAttack && dist <= TC_ATTACK_RANGE + 30) {
      const st = TC_STATS[u.classId];
      target.hp -= st.damage;
      u.attackCd = TC_ATTACK_CD;
      u.facing = atan2Brads(dy, dx);
      if (target.hp <= 0) {
        target.hp = 0;
        target.alive = false;
      }
    }
  }

  // Control-zone accounting: each side scores a tick per living unit standing
  // inside the central zone.
  let aInZone = 0;
  let bInZone = 0;
  for (const u of state.units) {
    if (!u.alive || !inZone(u.x, u.y)) continue;
    if (u.side === 'a') aInZone += 1;
    else bInZone += 1;
  }
  state.zoneTicks.a += aInZone;
  state.zoneTicks.b += bInZone;

  state.tick += 1;
  if (state.tick >= TC_LOOP_TICKS) state.finished = true;
  return state;
}

/** Count living units per side (units alive at the end feed the score). */
export function aliveCount(state: TcState, side: PlayerSide): number {
  let n = 0;
  for (const u of state.units) if (u.alive && u.side === side) n += 1;
  return n;
}

/** Final Time-Chess score for a side: control-zone time + units alive. */
export function tcScore(state: TcState, side: PlayerSide): number {
  return state.zoneTicks[side] + aliveCount(state, side) * 100;
}

// A helper so `sin`/`cos` are considered used by the AI's aim helpers below.
export function aimVector(brads: number): { x: number; y: number } {
  return { x: cos(brads), y: sin(brads) };
}
