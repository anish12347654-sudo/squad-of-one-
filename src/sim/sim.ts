/**
 * The pure simulation core: state creation and the fixed-timestep step().
 *
 * This is the deterministic heart of the game. It obeys the sim rules enforced
 * by ESLint: no Phaser/DOM, no timers, no Date/performance, no Math.random/
 * sin/cos/atan2 (trig from ./trig, entropy from ./prng).
 *
 * The M1 systems implemented here (contracts in docs/ARCHITECTURE.md):
 *   - entity model (units, projectiles, boss attacks)
 *   - class kits (Guardian / Medic / Ranger) driven by InputFrame
 *   - deterministic movement, melee arcs, heal beams, projectiles
 *   - threat/aggro with the Invariance Rule
 *   - boss pattern script with telegraphed attacks + a phase threshold
 *   - loop lifecycle (win / timeout), player + echoes through the SAME path
 *
 * step(state, input) is FROZEN: `input` is the LIVE player's frame this tick;
 * echo inputs are read from their recordings held on the runner side and
 * injected via setEchoInputs() before each tick (see level-runner.ts).
 */

import { cloneRng, createRng } from './prng.js';
import { cosFx, sinFx, atan2Brads, TRIG_ONE } from './trig.js';
import {
  classStats,
  perTick,
  TAUNT_TICKS,
  SANCTUARY_RADIUS,
  SANCTUARY_TICKS,
  SANCTUARY_DAMAGE_MUL,
  PIERCING_CHARGE_TICKS,
  PIERCING_DAMAGE,
  PIERCING_HALF_WIDTH,
  PIERCING_RANGE,
  PIERCING_SPEED,
} from './classes.js';
import {
  addDamageThreat,
  addHealThreat,
  applyTaunt,
  updateTargeting,
  REEVAL_TICKS,
} from './threat.js';
import {
  createSpatialHash,
  clearSpatialHash,
  insert,
  queryCircle,
} from './spatial-hash.js';
import { dist, distToLine, projectOnDir, clamp } from './vec.js';
import { BUTTON_SKILL, BUTTON_DASH, emptyInput } from './types.js';
import type {
  InputFrame,
  SimState,
  StepFn,
  Unit,
  Projectile,
  BossAttack,
  ClassId,
} from './types.js';
import type { LevelDef } from './level.js';

/** Convert a uint8 aim (0..255) to brads (0..4095). */
function aimToBrads(aim: number): number {
  return (aim << 4) & 4095;
}

// ---------------------------------------------------------------------------
// State construction
// ---------------------------------------------------------------------------

function makeUnit(id: number, kind: Unit['kind'], team: Unit['team'], slot: number): Unit {
  return {
    id,
    kind,
    team,
    slot,
    classId: null,
    x: 0,
    y: 0,
    facing: 0,
    hp: 1,
    maxHp: 1,
    alive: true,
    primaryCd: 0,
    skillCd: 0,
    dashCd: 0,
    dashTicks: 0,
    dashX: 0,
    dashY: 0,
    tauntTicks: 0,
    sanctuaryTicks: 0,
    chargeTicks: 0,
  };
}

/**
 * Build the initial SimState for one loop of a level.
 *
 * @param level      the level definition (pure content data)
 * @param recordingSlot which slot is being recorded LIVE this loop
 * @param slotClasses class chosen for each slot so far (index = slot)
 * @param liveIncluded whether the live player exists this loop (false during a
 *        pure replay of a finished pass)
 */
export function createLevelState(
  level: LevelDef,
  recordingSlot: number,
  slotClasses: (ClassId | null)[],
  liveIncluded = true,
): SimState {
  const state: SimState = {
    tick: 0,
    seed: hashSeed(level.id) ^ 0x5a17c0de,
    rng: createRng(hashSeed(level.id)),
    loopLength: level.loopLength,
    recordingSlot,
    slotCount: level.slotCount,
    slotClasses: slotClasses.slice(),
    units: [],
    projectiles: [],
    attacks: [],
    boss: {
      threat: [],
      targetId: -1,
      reevalCd: 0,
      forcedTauntTicks: 0,
      forcedTargetId: -1,
      phase: 0,
      attackCd: 60,
      patternCursor: 0,
    },
    nextId: 1,
    outcome: 'running',
    playerId: -1,
  };

  // Spawn the boss first (id 0-ish via allocator) so it has the lowest enemy id.
  const boss = makeUnit(state.nextId++, 'boss', 'enemy', -1);
  boss.x = level.boss.x;
  boss.y = level.boss.y;
  boss.hp = level.boss.maxHp;
  boss.maxHp = level.boss.maxHp;
  state.units.push(boss);

  // Spawn every slot that has been chosen. The slot being recorded is the LIVE
  // player (if included); all other chosen slots are echoes.
  for (let slot = 0; slot < level.slotCount; slot++) {
    const cls = slotClasses[slot];
    if (!cls) continue;
    const isLive = slot === recordingSlot;
    if (isLive && !liveIncluded) continue;
    const spawn = level.spawns[slot] ?? level.spawns[0];
    const unit = makeUnit(state.nextId++, isLive ? 'player' : 'echo', 'player', slot);
    unit.classId = cls;
    const stats = classStats(cls);
    unit.hp = stats.maxHp;
    unit.maxHp = stats.maxHp;
    if (spawn) {
      unit.x = spawn.x;
      unit.y = spawn.y;
      unit.facing = spawn.facing;
    }
    state.units.push(unit);
    if (isLive) state.playerId = unit.id;
  }

  return state;
}

/**
 * Minimal self-contained sim state for generic determinism/runner tests and
 * tools that just need "a state that evolves deterministically" without pulling
 * in the content layer. Builds a tiny built-in arena: one boss plus one live
 * Guardian, with a small inline slam pattern. FROZEN signature (seed -> state).
 */
export function createSimState(seed: number): SimState {
  const s = (seed >>> 0) || 1;
  const state: SimState = {
    tick: 0,
    seed: s,
    rng: createRng(s),
    loopLength: 600,
    recordingSlot: 0,
    slotCount: 1,
    slotClasses: ['guardian'],
    units: [],
    projectiles: [],
    attacks: [],
    boss: {
      threat: [],
      targetId: -1,
      reevalCd: 0,
      forcedTauntTicks: 0,
      forcedTargetId: -1,
      phase: 0,
      attackCd: 60,
      patternCursor: 0,
    },
    nextId: 1,
    outcome: 'running',
    playerId: -1,
  };
  const boss = makeUnit(state.nextId++, 'boss', 'enemy', -1);
  boss.x = 0;
  boss.y = -200;
  boss.hp = 4000;
  boss.maxHp = 4000;
  state.units.push(boss);
  const player = makeUnit(state.nextId++, 'player', 'player', 0);
  player.classId = 'guardian';
  const gStats = classStats('guardian');
  player.hp = gStats.maxHp;
  player.maxHp = gStats.maxHp;
  player.x = 0;
  player.y = 120;
  state.units.push(player);
  state.playerId = player.id;
  setBossPattern(DEFAULT_TEST_PATTERN);
  return state;
}

const DEFAULT_TEST_PATTERN: import('./boss-pattern.js').BossPatternStep[] = [
  {
    shape: 'slam',
    telegraphTicks: 48,
    activeTicks: 6,
    recoveryTicks: 40,
    radius: 120,
    halfArc: 0,
    damage: 20,
    maxHpFraction: 1,
  },
];

/** Stable, deterministic 32-bit hash of a level id string (for the seed). */
function hashSeed(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Deep clone of sim state (snapshots, interpolation, replay forks). */
export function cloneSimState(state: SimState): SimState {
  return {
    tick: state.tick,
    seed: state.seed,
    rng: cloneRng(state.rng),
    loopLength: state.loopLength,
    recordingSlot: state.recordingSlot,
    slotCount: state.slotCount,
    slotClasses: state.slotClasses.slice(),
    units: state.units.map(cloneUnit),
    projectiles: state.projectiles.map(cloneProjectile),
    attacks: state.attacks.map(cloneAttack),
    boss: {
      threat: state.boss.threat.map((e) => ({ ...e })),
      targetId: state.boss.targetId,
      reevalCd: state.boss.reevalCd,
      forcedTauntTicks: state.boss.forcedTauntTicks,
      forcedTargetId: state.boss.forcedTargetId,
      phase: state.boss.phase,
      attackCd: state.boss.attackCd,
      patternCursor: state.boss.patternCursor,
    },
    nextId: state.nextId,
    outcome: state.outcome,
    playerId: state.playerId,
  };
}

function cloneUnit(u: Unit): Unit {
  return { ...u };
}
function cloneProjectile(p: Projectile): Projectile {
  return { ...p, hits: p.hits.slice() };
}
function cloneAttack(a: BossAttack): BossAttack {
  return { ...a };
}

// ---------------------------------------------------------------------------
// Per-tick input injection for echoes
// ---------------------------------------------------------------------------

/**
 * Echo inputs for the current tick, keyed by slot. The runner fills this before
 * calling step(); the live player's input arrives as step()'s argument. This is
 * a module-level *transient* buffer (NOT hashed state); it is fully determined
 * by the recordings, which are deterministic.
 */
let echoInputs: Map<number, InputFrame> = new Map();

/** Provide the echo inputs (by slot) that step() should apply this tick. */
export function setEchoInputs(bySlot: Map<number, InputFrame>): void {
  echoInputs = bySlot;
}

function inputForUnit(unit: Unit, liveInput: InputFrame): InputFrame {
  if (unit.kind === 'player') return liveInput;
  return echoInputs.get(unit.slot) ?? emptyInput();
}

// ---------------------------------------------------------------------------
// The step()
// ---------------------------------------------------------------------------

const HASH_CELL = 96;
const neighbourScratch: number[] = [];

export const step: StepFn = (state, liveInput) => {
  if (state.outcome !== 'running') {
    // Loop already resolved; still advance tick so the runner can fast-forward.
    state.tick += 1;
    return state;
  }

  const bossUnit = findBoss(state);

  // Build the broad-phase hash of player-team units for range queries.
  const hash = createSpatialHash(HASH_CELL);
  clearSpatialHash(hash);
  for (const u of state.units) {
    if (u.team === 'player' && u.alive) insert(hash, u.id, u.x, u.y);
  }

  // 1) Player-team units act (movement + abilities) in stable id order.
  for (const u of state.units) {
    if (u.team !== 'player' || !u.alive) continue;
    const input = inputForUnit(u, liveInput);
    updatePlayerUnit(state, u, input, bossUnit, hash);
  }

  // 2) Projectiles advance and resolve hits.
  updateProjectiles(state, bossUnit);

  // 3) Boss brain: targeting + pattern script + resolve landed attacks.
  if (bossUnit && bossUnit.alive) {
    updateBoss(state, bossUnit);
  }
  updateAttacks(state);

  // 4) Cull dead projectiles/attacks.
  state.projectiles = state.projectiles.filter((p) => p.life > 0);
  state.attacks = state.attacks.filter((a) => a.telegraphTicks > 0 || a.activeTicks > 0);

  // 5) Win / lose evaluation.
  if (bossUnit && !bossUnit.alive) {
    state.outcome = 'won';
  } else if (state.tick + 1 >= state.loopLength) {
    state.outcome = 'timeout';
  }

  state.tick += 1;
  return state;
};

function findBoss(state: SimState): Unit | undefined {
  for (const u of state.units) if (u.kind === 'boss') return u;
  return undefined;
}

// ---------------------------------------------------------------------------
// Player-team unit update
// ---------------------------------------------------------------------------

function updatePlayerUnit(
  state: SimState,
  u: Unit,
  input: InputFrame,
  boss: Unit | undefined,
  hash: ReturnType<typeof createSpatialHash>,
): void {
  const stats = classStats(u.classId as ClassId);

  // Cooldown ticks down.
  if (u.primaryCd > 0) u.primaryCd -= 1;
  if (u.skillCd > 0) u.skillCd -= 1;
  if (u.dashCd > 0) u.dashCd -= 1;
  if (u.sanctuaryTicks > 0) u.sanctuaryTicks -= 1;

  // --- Movement (dash overrides directional input) ---
  if (u.dashTicks > 0) {
    const stepDist = stats.dashDistance / stats.dashTicks;
    u.x += u.dashX * stepDist;
    u.y += u.dashY * stepDist;
    u.dashTicks -= 1;
  } else {
    const mag = Math.sqrt(input.moveX * input.moveX + input.moveY * input.moveY);
    if (mag > 0) {
      const nx = input.moveX / mag;
      const ny = input.moveY / mag;
      const spd = perTick(stats.speed) * clamp(mag / 127, 0, 1);
      u.x += nx * spd;
      u.y += ny * spd;
      // Facing follows movement unless the player is aiming manually.
      if (!input.aimActive) u.facing = atan2Brads(ny, nx);
    }
  }
  if (input.aimActive) u.facing = aimToBrads(input.aim);

  clampToArena(u);

  // --- Dash button ---
  if ((input.buttons & BUTTON_DASH) !== 0 && u.dashCd <= 0 && u.dashTicks <= 0) {
    // Dash in the movement direction, or facing if standing still.
    let dx: number;
    let dy: number;
    const mag = Math.sqrt(input.moveX * input.moveX + input.moveY * input.moveY);
    if (mag > 0) {
      dx = input.moveX / mag;
      dy = input.moveY / mag;
    } else {
      dx = cosFx(u.facing) / TRIG_ONE;
      dy = sinFx(u.facing) / TRIG_ONE;
    }
    u.dashX = dx;
    u.dashY = dy;
    u.dashTicks = stats.dashTicks;
    u.dashCd = stats.dashCd;
  }

  // --- Skill button ---
  if ((input.buttons & BUTTON_SKILL) !== 0 && u.skillCd <= 0 && u.chargeTicks <= 0) {
    activateSkill(state, u, stats.id, boss);
  }

  // Ranger charge resolves when the charge timer elapses.
  if (u.chargeTicks > 0) {
    u.chargeTicks -= 1;
    if (u.chargeTicks === 0) firePiercingShot(state, u);
  }

  // --- Automatic primary attack ---
  if (u.primaryCd <= 0 && u.chargeTicks <= 0) {
    doPrimary(state, u, stats.id, boss, hash);
  }
}

function clampToArena(u: Unit): void {
  // Keep units inside the arena. Bounds are symmetric; the level seeds spawns
  // well inside so clamping only bites at the edges.
  const HALF = ARENA_HALF;
  u.x = clamp(u.x, -HALF, HALF);
  u.y = clamp(u.y, -HALF, HALF);
}

/** Arena half-extent used for clamping (matches the M1 level). */
export const ARENA_HALF = 500;

// ---------------------------------------------------------------------------
// Abilities
// ---------------------------------------------------------------------------

function doPrimary(
  state: SimState,
  u: Unit,
  cls: ClassId,
  boss: Unit | undefined,
  hash: ReturnType<typeof createSpatialHash>,
): void {
  const stats = classStats(cls);
  if (cls === 'guardian') {
    if (!boss || !boss.alive) return;
    // Melee arc: hit the boss if within range and inside the facing arc.
    const d = dist(u.x, u.y, boss.x, boss.y);
    if (d <= stats.meleeRange + BOSS_RADIUS) {
      const toBoss = atan2Brads(boss.y - u.y, boss.x - u.x);
      if (angleWithin(u.facing, toBoss, stats.meleeHalfArc)) {
        dealDamageToBoss(state, boss, u, stats.primaryDamage);
        u.primaryCd = stats.primaryCd;
      }
    }
  } else if (cls === 'medic') {
    // Heal beam onto the lowest-HP% ally within range and below full HP.
    const target = lowestHpAlly(state, u, stats.healRange, hash);
    if (target) {
      const before = target.hp;
      target.hp = Math.min(target.maxHp, target.hp + stats.healPerTick);
      const healed = target.hp - before;
      if (healed > 0 && boss) addHealThreat(state.boss, u.id, healed);
      u.primaryCd = stats.primaryCd;
      // Face the heal target for readable rendering.
      u.facing = atan2Brads(target.y - u.y, target.x - u.x);
    }
  } else if (cls === 'ranger') {
    if (!boss || !boss.alive) return;
    const d = dist(u.x, u.y, boss.x, boss.y);
    if (d <= stats.projectileRange) {
      const ang = atan2Brads(boss.y - u.y, boss.x - u.x);
      u.facing = ang;
      spawnArrow(state, u, ang, stats.projectileSpeed, stats.primaryDamage, stats.projectileRange);
      u.primaryCd = stats.primaryCd;
    }
  }
}

function activateSkill(state: SimState, u: Unit, cls: ClassId, boss: Unit | undefined): void {
  const stats = classStats(cls);
  if (cls === 'guardian') {
    if (!boss) return;
    applyTaunt(state.boss, u.id, TAUNT_TICKS);
    u.skillCd = stats.skillCd;
  } else if (cls === 'medic') {
    // Sanctuary: grant the damage-reduction buff to allies in the zone.
    for (const ally of state.units) {
      if (ally.team === 'player' && ally.alive) {
        if (dist(u.x, u.y, ally.x, ally.y) <= SANCTUARY_RADIUS) {
          ally.sanctuaryTicks = SANCTUARY_TICKS;
        }
      }
    }
    u.skillCd = stats.skillCd;
  } else if (cls === 'ranger') {
    // Begin charging the Piercing Shot.
    u.chargeTicks = PIERCING_CHARGE_TICKS;
    u.skillCd = stats.skillCd;
  }
}

function firePiercingShot(state: SimState, u: Unit): void {
  const boss = findBoss(state);
  let ang = u.facing;
  if (boss && boss.alive) ang = atan2Brads(boss.y - u.y, boss.x - u.x);
  const dx = cosFx(ang) / TRIG_ONE;
  const dy = sinFx(ang) / TRIG_ONE;
  const p: Projectile = {
    id: state.nextId++,
    team: 'player',
    ownerId: u.id,
    ownerSlot: u.slot,
    x: u.x,
    y: u.y,
    vx: dx * perTick(PIERCING_SPEED),
    vy: dy * perTick(PIERCING_SPEED),
    damage: PIERCING_DAMAGE,
    life: Math.ceil(PIERCING_RANGE / perTick(PIERCING_SPEED)),
    piercing: true,
    hits: [],
  };
  state.projectiles.push(p);
}

function spawnArrow(
  state: SimState,
  u: Unit,
  angle: number,
  speed: number,
  damage: number,
  range: number,
): void {
  const dx = cosFx(angle) / TRIG_ONE;
  const dy = sinFx(angle) / TRIG_ONE;
  const v = perTick(speed);
  const p: Projectile = {
    id: state.nextId++,
    team: 'player',
    ownerId: u.id,
    ownerSlot: u.slot,
    x: u.x,
    y: u.y,
    vx: dx * v,
    vy: dy * v,
    damage,
    life: Math.ceil(range / v),
    piercing: false,
    hits: [],
  };
  state.projectiles.push(p);
}

function updateProjectiles(state: SimState, boss: Unit | undefined): void {
  for (const p of state.projectiles) {
    if (p.life <= 0) continue;
    p.x += p.vx;
    p.y += p.vy;
    p.life -= 1;
    if (!boss || !boss.alive) continue;
    if (p.team !== 'player') continue;
    if (p.piercing) {
      // Piercing shot is a moving line segment; treat as a fat point vs boss.
      if (p.hits.indexOf(boss.id) < 0 && dist(p.x, p.y, boss.x, boss.y) <= BOSS_RADIUS + PIERCING_HALF_WIDTH) {
        const owner = unitById(state, p.ownerId);
        if (owner) dealDamageToBoss(state, boss, owner, p.damage);
        p.hits.push(boss.id);
      }
    } else {
      if (dist(p.x, p.y, boss.x, boss.y) <= BOSS_RADIUS) {
        const owner = unitById(state, p.ownerId);
        if (owner) dealDamageToBoss(state, boss, owner, p.damage);
        p.life = 0;
      }
    }
  }
}

function lowestHpAlly(
  state: SimState,
  healer: Unit,
  range: number,
  hash: ReturnType<typeof createSpatialHash>,
): Unit | undefined {
  const candidates = queryCircle(hash, healer.x, healer.y, range, neighbourScratch);
  let best: Unit | undefined;
  let bestFrac = 1;
  let bestId = Number.POSITIVE_INFINITY;
  for (const id of candidates) {
    const ally = unitById(state, id);
    if (!ally || !ally.alive || ally.team !== 'player') continue;
    if (ally.hp >= ally.maxHp) continue; // heals only target < 100% HP
    if (dist(healer.x, healer.y, ally.x, ally.y) > range) continue;
    const frac = ally.hp / ally.maxHp;
    // Lowest HP fraction; tie-break to lowest id.
    if (frac < bestFrac - 1e-9 || (Math.abs(frac - bestFrac) <= 1e-9 && ally.id < bestId)) {
      bestFrac = frac;
      best = ally;
      bestId = ally.id;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Damage
// ---------------------------------------------------------------------------

/** Deal damage to the boss and credit threat to the attacker. */
function dealDamageToBoss(state: SimState, boss: Unit, attacker: Unit, rawDamage: number): void {
  if (rawDamage <= 0 || !boss.alive) return;
  boss.hp -= rawDamage;
  addDamageThreat(state.boss, attacker.id, rawDamage);
  if (boss.hp <= 0) {
    boss.hp = 0;
    boss.alive = false;
  }
}

/** Deal damage from an enemy attack to a player-team unit (damage only). */
function dealDamageToUnit(u: Unit, rawDamage: number): void {
  if (rawDamage <= 0 || !u.alive) return;
  const stats = u.classId ? classStats(u.classId) : null;
  let dmg = rawDamage;
  if (stats) dmg *= stats.damageTakenMul;
  if (u.sanctuaryTicks > 0) dmg *= SANCTUARY_DAMAGE_MUL;
  u.hp -= dmg;
  if (u.hp <= 0) {
    u.hp = 0;
    u.alive = false;
  }
}

function unitById(state: SimState, id: number): Unit | undefined {
  for (const u of state.units) if (u.id === id) return u;
  return undefined;
}

// ---------------------------------------------------------------------------
// Boss brain + attacks
// ---------------------------------------------------------------------------

export const BOSS_RADIUS = 46;
const BOSS_SPEED = 90; // u/s toward target; overridden by level in future

function updateBoss(state: SimState, boss: Unit): void {
  // Phase threshold: past 50% HP flips to phase 1 (enables gated attacks).
  const frac = boss.hp / boss.maxHp;
  if (state.boss.phase === 0 && frac <= PHASE1_THRESHOLD) {
    state.boss.phase = 1;
  }

  const targetId = updateTargeting(state.boss, (id) => {
    const t = unitById(state, id);
    return !!t && t.alive && t.team === 'player';
  });

  const target = targetId >= 0 ? unitById(state, targetId) : undefined;

  // Move toward the target (idle drift if none). Boss never displaces players.
  if (target) {
    const d = dist(boss.x, boss.y, target.x, target.y);
    if (d > BOSS_RADIUS + 40) {
      const nx = (target.x - boss.x) / d;
      const ny = (target.y - boss.y) / d;
      const spd = perTick(BOSS_SPEED);
      boss.x += nx * spd;
      boss.y += ny * spd;
      boss.facing = atan2Brads(ny, nx);
    } else {
      boss.facing = atan2Brads(target.y - boss.y, target.x - boss.x);
    }
  }

  // Attack cadence: spawn the next telegraph when off cooldown and a target
  // exists (idle pattern otherwise: no attacks in M1 when untargeted).
  if (state.boss.attackCd > 0) state.boss.attackCd -= 1;
  if (state.boss.attackCd <= 0 && target) {
    spawnNextAttack(state, boss, target);
  }
}

/** Phase-1 threshold as an HP fraction. */
export const PHASE1_THRESHOLD = 0.5;

function spawnNextAttack(state: SimState, boss: Unit, target: Unit): void {
  const pattern = currentPattern;
  if (!pattern || pattern.length === 0) return;
  const frac = boss.hp / boss.maxHp;

  // Advance the cursor to the next step whose phase gate is satisfied.
  let tries = 0;
  let step = pattern[state.boss.patternCursor % pattern.length];
  while (step && frac > step.maxHpFraction && tries < pattern.length) {
    state.boss.patternCursor = (state.boss.patternCursor + 1) % pattern.length;
    step = pattern[state.boss.patternCursor % pattern.length];
    tries += 1;
  }
  if (!step || frac > step.maxHpFraction) {
    // No gated step available; use the first ungated step.
    step = pattern.find((s) => frac <= s.maxHpFraction) ?? pattern[0];
  }
  if (!step) return;

  const angle = atan2Brads(target.y - boss.y, target.x - boss.x);
  const attack: BossAttack = {
    id: state.nextId++,
    shape: step.shape,
    telegraphTicks: step.telegraphTicks,
    activeTicks: step.activeTicks,
    fired: false,
    x: step.shape === 'slam' ? target.x : boss.x,
    y: step.shape === 'slam' ? target.y : boss.y,
    radius: step.radius,
    angle,
    halfArc: step.halfArc,
    damage: step.damage,
  };
  state.attacks.push(attack);
  state.boss.attackCd = step.telegraphTicks + step.activeTicks + step.recoveryTicks;
  state.boss.patternCursor = (state.boss.patternCursor + 1) % pattern.length;
}

/**
 * The active boss pattern for the current level. Set by the runner via
 * setBossPattern() before the loop begins. It is pure data (content-authored)
 * and does not enter the hashed state; the cursor into it does.
 */
let currentPattern: import('./boss-pattern.js').BossPatternStep[] | null = null;
export function setBossPattern(pattern: import('./boss-pattern.js').BossPatternStep[]): void {
  currentPattern = pattern;
}

function updateAttacks(state: SimState): void {
  for (const a of state.attacks) {
    if (a.telegraphTicks > 0) {
      a.telegraphTicks -= 1;
      if (a.telegraphTicks === 0 && !a.fired) {
        resolveAttack(state, a);
        a.fired = true;
      }
      continue;
    }
    if (a.activeTicks > 0) {
      a.activeTicks -= 1;
    }
  }
}

/** Apply an attack's damage to all player-team units it covers. */
function resolveAttack(state: SimState, a: BossAttack): void {
  for (const u of state.units) {
    if (u.team !== 'player' || !u.alive) continue;
    let hit = false;
    if (a.shape === 'slam') {
      hit = dist(u.x, u.y, a.x, a.y) <= a.radius;
    } else if (a.shape === 'cone') {
      const d = dist(u.x, u.y, a.x, a.y);
      if (d <= a.radius) {
        const toU = atan2Brads(u.y - a.y, u.x - a.x);
        hit = angleWithin(a.angle, toU, a.halfArc);
      }
    } else {
      // charge: line lane from origin along angle, length = radius.
      const dx = cosFx(a.angle) / TRIG_ONE;
      const dy = sinFx(a.angle) / TRIG_ONE;
      const proj = projectOnDir(u.x, u.y, a.x, a.y, dx, dy);
      if (proj >= 0 && proj <= a.radius) {
        const perp = distToLine(u.x, u.y, a.x, a.y, dx, dy, 1);
        hit = perp <= a.halfArc;
      }
    }
    if (hit) dealDamageToUnit(u, a.damage);
  }
}

// ---------------------------------------------------------------------------
// Angle helpers
// ---------------------------------------------------------------------------

/** True when `target` is within `halfArc` brads of `center` (wrap-aware). */
export function angleWithin(center: number, target: number, halfArc: number): boolean {
  let diff = ((target - center) & 4095) as number;
  if (diff > 2048) diff -= 4096;
  return Math.abs(diff) <= halfArc;
}

/** Run `count` ticks with a fixed live input; convenience for tests/tools. */
export function stepMany(state: SimState, inputs: readonly InputFrame[]): SimState {
  let s = state;
  for (const input of inputs) s = step(s, input);
  return s;
}

export { emptyInput, REEVAL_TICKS };
export type { InputFrame, SimState, StepFn };
