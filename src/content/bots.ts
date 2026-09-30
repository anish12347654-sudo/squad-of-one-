/**
 * Scripted bot controllers used to (a) record the M1 arena's solution replay
 * and (b) drive deterministic tests. Each controller maps (state, slot, tick)
 * to an InputFrame using ONLY the public sim API - the same interface a human
 * or an echo goes through.
 *
 * These are pure and deterministic: no wall clock, no Math.random.
 */

import {
  BUTTON_SKILL,
  BUTTON_DASH,
  BUTTON_INTERACT,
  atan2Brads,
  type InputFrame,
  type SimState,
  type Unit,
} from '@sim/index.js';

function findBoss(state: SimState): Unit | undefined {
  return state.units.find((u) => u.kind === 'boss');
}

function selfUnit(state: SimState, slot: number): Unit | undefined {
  return state.units.find((u) => u.slot === slot && (u.kind === 'player' || u.kind === 'echo'));
}

/** Aim (uint8) from a brads angle. */
function bradsToAim(brads: number): number {
  return (brads >> 4) & 0xff;
}

/** Move toward a target point, returning quantized int8 move components. */
function moveToward(fromX: number, fromY: number, toX: number, toY: number): { moveX: number; moveY: number } {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return { moveX: 0, moveY: 0 };
  return { moveX: Math.round((dx / len) * 127), moveY: Math.round((dy / len) * 127) };
}

/**
 * Guardian bot: rush to melee range of the boss, taunt on cooldown, and hold.
 */
export function guardianBot(state: SimState, slot: number): InputFrame {
  const me = selfUnit(state, slot);
  const boss = findBoss(state);
  if (!me || !boss) return { moveX: 0, moveY: 0, aim: 0, aimActive: false, buttons: 0 };
  const dx = boss.x - me.x;
  const dy = boss.y - me.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const aim = bradsToAim(atan2Brads(dy, dx));
  let buttons = 0;
  // Taunt whenever available so the boss stays on the tank.
  if (me.skillCd <= 0) buttons |= BUTTON_SKILL;
  // Close to just outside the boss body, then stop and bash.
  const desired = 80;
  let moveX = 0;
  let moveY = 0;
  if (dist > desired + 8) {
    const m = moveToward(me.x, me.y, boss.x, boss.y);
    moveX = m.moveX;
    moveY = m.moveY;
  }
  return { moveX, moveY, aim, aimActive: true, buttons };
}

/** Medic bot: hug the tank's area and heal; drop Sanctuary on cooldown. */
export function medicBot(state: SimState, slot: number): InputFrame {
  const me = selfUnit(state, slot);
  const boss = findBoss(state);
  if (!me || !boss) return { moveX: 0, moveY: 0, aim: 0, aimActive: false, buttons: 0 };
  // Sit a safe distance from the boss, behind, healing whoever is hurt.
  const standX = boss.x;
  const standY = boss.y + 300;
  const dist = Math.sqrt((standX - me.x) ** 2 + (standY - me.y) ** 2);
  let moveX = 0;
  let moveY = 0;
  if (dist > 20) {
    const m = moveToward(me.x, me.y, standX, standY);
    moveX = m.moveX;
    moveY = m.moveY;
  }
  let buttons = 0;
  if (me.skillCd <= 0) buttons |= BUTTON_SKILL;
  return { moveX, moveY, aim: 0, aimActive: false, buttons };
}

/** Ranger bot: kite at range and fire; charge Piercing Shot on cooldown. */
export function rangerBot(state: SimState, slot: number): InputFrame {
  const me = selfUnit(state, slot);
  const boss = findBoss(state);
  if (!me || !boss) return { moveX: 0, moveY: 0, aim: 0, aimActive: false, buttons: 0 };
  const dx = boss.x - me.x;
  const dy = boss.y - me.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const aim = bradsToAim(atan2Brads(dy, dx));
  let moveX = 0;
  let moveY = 0;
  // Maintain ~420u standoff.
  const standoff = 420;
  if (dist > standoff + 30) {
    const m = moveToward(me.x, me.y, boss.x, boss.y);
    moveX = m.moveX;
    moveY = m.moveY;
  } else if (dist < standoff - 30) {
    const m = moveToward(boss.x, boss.y, me.x, me.y); // back away
    moveX = m.moveX;
    moveY = m.moveY;
  }
  let buttons = 0;
  if (me.skillCd <= 0) buttons |= BUTTON_SKILL;
  return { moveX, moveY, aim, aimActive: true, buttons };
}

/** Simple dash-happy variant for feel testing (unused by the solution). */
export function dashOccasionally(input: InputFrame, tick: number): InputFrame {
  if (tick % 180 === 90) return { ...input, buttons: input.buttons | BUTTON_DASH };
  return input;
}

export type BotController = (state: SimState, slot: number, tick: number) => InputFrame;

// ---------------------------------------------------------------------------
// M2 bots (used by the 7-slot showcase flow + e2e). All pure + deterministic.
// ---------------------------------------------------------------------------

/** Generic ranged attacker: keep a standoff, fire on cooldown, skill when up. */
function rangedBot(state: SimState, slot: number, standoff: number): InputFrame {
  const me = selfUnit(state, slot);
  const boss = findBoss(state);
  if (!me || !boss) return { moveX: 0, moveY: 0, aim: 0, aimActive: false, buttons: 0 };
  const dx = boss.x - me.x;
  const dy = boss.y - me.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const aim = bradsToAim(atan2Brads(dy, dx));
  let moveX = 0;
  let moveY = 0;
  if (dist > standoff + 30) {
    const m = moveToward(me.x, me.y, boss.x, boss.y);
    moveX = m.moveX;
    moveY = m.moveY;
  } else if (dist < standoff - 30) {
    const m = moveToward(boss.x, boss.y, me.x, me.y);
    moveX = m.moveX;
    moveY = m.moveY;
  }
  let buttons = 0;
  if (me.skillCd <= 0) buttons |= BUTTON_SKILL;
  return { moveX, moveY, aim, aimActive: true, buttons };
}

/** Generic melee attacker: rush to melee range and swing, skill on cooldown. */
function meleeBot(state: SimState, slot: number, reach: number): InputFrame {
  const me = selfUnit(state, slot);
  const boss = findBoss(state);
  if (!me || !boss) return { moveX: 0, moveY: 0, aim: 0, aimActive: false, buttons: 0 };
  const dx = boss.x - me.x;
  const dy = boss.y - me.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const aim = bradsToAim(atan2Brads(dy, dx));
  let moveX = 0;
  let moveY = 0;
  if (dist > reach) {
    const m = moveToward(me.x, me.y, boss.x, boss.y);
    moveX = m.moveX;
    moveY = m.moveY;
  }
  let buttons = 0;
  if (me.skillCd <= 0) buttons |= BUTTON_SKILL;
  return { moveX, moveY, aim, aimActive: true, buttons };
}

export function pyromancerBot(state: SimState, slot: number): InputFrame {
  return rangedBot(state, slot, 380);
}
export function engineerBot(state: SimState, slot: number): InputFrame {
  return rangedBot(state, slot, 260);
}
export function rogueBot(state: SimState, slot: number): InputFrame {
  return meleeBot(state, slot, 70);
}

/** Avatar bot: rush the boss, fire Convergence the moment it is charged. */
export function avatarBot(state: SimState, slot: number): InputFrame {
  const me = selfUnit(state, slot);
  const boss = findBoss(state);
  if (!me || !boss) return { moveX: 0, moveY: 0, aim: 0, aimActive: false, buttons: 0 };
  const f = meleeBot(state, slot, 90);
  let buttons = f.buttons;
  // Skill = Convergence; the sim only fires it when fully charged.
  buttons |= BUTTON_SKILL;
  return { ...f, buttons };
}

/**
 * A bot that walks to a specific interactable (by defIndex), grabs it, then
 * fights at range. Used to author anchor recordings for paradox demos/e2e.
 */
export function shardGrabberBot(state: SimState, slot: number, defIndex: number): InputFrame {
  const me = selfUnit(state, slot);
  if (!me) return { moveX: 0, moveY: 0, aim: 0, aimActive: false, buttons: 0 };
  const target = state.interactables.find((i) => i.defIndex === defIndex);
  if (target && !(target.taken && target.kind === 'shard')) {
    const d = Math.sqrt((target.x - me.x) ** 2 + (target.y - me.y) ** 2);
    if (d > target.radius - 6) {
      const m = moveToward(me.x, me.y, target.x, target.y);
      return { moveX: m.moveX, moveY: m.moveY, aim: 0, aimActive: false, buttons: 0 };
    }
    return { moveX: 0, moveY: 0, aim: 0, aimActive: false, buttons: BUTTON_INTERACT };
  }
  return rangedBot(state, slot, 360);
}

/** All class bots, keyed by classId (for the showcase level solver + e2e). */
export const ALL_BOTS: Record<string, BotController> = {
  guardian: (s, slot) => guardianBot(s, slot),
  medic: (s, slot) => medicBot(s, slot),
  ranger: (s, slot) => rangerBot(s, slot),
  pyromancer: (s, slot) => pyromancerBot(s, slot),
  rogue: (s, slot) => rogueBot(s, slot),
  engineer: (s, slot) => engineerBot(s, slot),
  avatar: (s, slot) => avatarBot(s, slot),
};

/** The M1 solution: Guardian tanks, Ranger DPS, Medic sustains. */
export const ARENA_01_BOTS: Record<string, BotController> = {
  guardian: (s, slot) => guardianBot(s, slot),
  medic: (s, slot) => medicBot(s, slot),
  ranger: (s, slot) => rangerBot(s, slot),
};
