/**
 * Deterministic Time Chess AI bot (brief section 6.3).
 *
 * The bot is a SEEDED, ENGINE-FREE decision function: given the duel state, the
 * unit it controls, the current tick and a difficulty, it returns an InputFrame.
 * For the SAME seed + difficulty it produces bit-identical play on every run
 * (proven by a determinism test). It uses only integer trig from the sim and a
 * tiny local PRNG stepped from the seed + tick, never Math.random or the wall
 * clock.
 *
 * Three difficulties tune how directly the bot pushes the control zone vs.
 * hunts the enemy, and how much deterministic "jitter" it adds so easier bots
 * play looser:
 *   - easy:   drifts, contests the zone loosely, attacks only in range.
 *   - normal: alternates zone control and pursuit.
 *   - hard:   holds the zone aggressively and focuses the nearest enemy.
 */

import { atan2Brads, sin, cos, emptyInput, BUTTON_SKILL } from '@sim/index.js';
import type { InputFrame } from '@sim/index.js';
import { TC_ZONE_RADIUS, type TcState, type PlayerSide } from './time-chess.js';

export type TcDifficulty = 'easy' | 'normal' | 'hard';

interface DiffTuning {
  /** 0..1 bias toward holding the zone (vs chasing the enemy). */
  zoneBias: number;
  /** Deterministic jitter amplitude added to the move heading (brads). */
  jitter: number;
  /** Extra range (units) at which the bot chooses to attack. */
  aggression: number;
}

const TUNING: Record<TcDifficulty, DiffTuning> = {
  easy: { zoneBias: 0.4, jitter: 900, aggression: 0 },
  normal: { zoneBias: 0.65, jitter: 420, aggression: 40 },
  hard: { zoneBias: 0.85, jitter: 120, aggression: 90 },
};

/** A tiny deterministic hash -> uint32 from (seed, tick, salt). */
function mix(seed: number, tick: number, salt: number): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ tick, 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ salt, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/** Nearest living enemy to a point (deterministic tie-break by array order). */
function nearestEnemyTo(state: TcState, side: PlayerSide, x: number, y: number): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  for (const o of state.units) {
    if (!o.alive || o.side === side) continue;
    const dx = o.x - x;
    const dy = o.y - y;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = { x: o.x, y: o.y };
    }
  }
  return best;
}

/**
 * Compute the AI InputFrame for the unit of `side` at (x,y) this tick. Pure and
 * deterministic given (seed, difficulty, state snapshot, tick).
 */
export function tcAiFrame(
  seed: number,
  difficulty: TcDifficulty,
  state: TcState,
  side: PlayerSide,
  x: number,
  y: number,
  tick: number,
): InputFrame {
  const tuning = TUNING[difficulty];

  // Target: blend "toward the zone centre" and "toward the nearest enemy".
  const enemy = nearestEnemyTo(state, side, x, y);
  const distToCentre = Math.sqrt(x * x + y * y);

  // If we're outside the zone, prioritise getting in; the zoneBias controls how
  // strongly we hold once inside.
  let tx: number;
  let ty: number;
  if (distToCentre > TC_ZONE_RADIUS * 0.6 || !enemy) {
    // Head toward centre (with the enemy nudging the direction on hard).
    tx = -x;
    ty = -y;
    if (enemy && tuning.zoneBias < 0.8) {
      tx = tx * tuning.zoneBias + (enemy.x - x) * (1 - tuning.zoneBias);
      ty = ty * tuning.zoneBias + (enemy.y - y) * (1 - tuning.zoneBias);
    }
  } else {
    // Inside the zone: press the enemy so we can knock them out of contention.
    tx = (enemy.x - x) * (1 - tuning.zoneBias) + -x * tuning.zoneBias;
    ty = (enemy.y - y) * (1 - tuning.zoneBias) + -y * tuning.zoneBias;
  }

  let heading = atan2Brads(ty, tx);
  // Deterministic jitter so easier bots wander (seeded by tick, engine-free).
  const r = mix(seed, tick, side === 'a' ? 1 : 2);
  const jitter = ((r % 2001) - 1000) / 1000; // [-1,1]
  heading = (heading + Math.round(jitter * tuning.jitter)) & 4095;

  const dir = { x: cos(heading), y: sin(heading) };
  const moveX = Math.max(-127, Math.min(127, Math.round(dir.x * 127)));
  const moveY = Math.max(-127, Math.min(127, Math.round(dir.y * 127)));

  // Attack when an enemy is within (base range + aggression).
  let buttons = 0;
  if (enemy) {
    const dx = enemy.x - x;
    const dy = enemy.y - y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist <= 70 + tuning.aggression) buttons |= BUTTON_SKILL;
  }

  const f = emptyInput();
  f.moveX = moveX;
  f.moveY = moveY;
  f.aim = (heading >> 4) & 0xff;
  f.aimActive = true;
  f.buttons = buttons;
  return f;
}
