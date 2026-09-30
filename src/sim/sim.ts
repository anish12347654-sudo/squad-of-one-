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
  FIRE_ORB_RADIUS,
  METEOR_FUSE_TICKS,
  METEOR_DAMAGE,
  METEOR_RADIUS,
  ROGUE_BACKSTAB_MUL,
  SHADOW_STEP_DISTANCE,
  SHADOW_STEP_TICKS,
  SHADOW_STEP_INVULN_HITS,
  TURRET_LIFE_TICKS,
  TURRET_HP,
  TURRET_DAMAGE,
  TURRET_FIRE_CD,
  TURRET_RANGE,
  TURRET_PROJECTILE_SPEED,
  CONVERGENCE_CHARGE,
  CONVERGE_PER_ECHO,
  CONVERGENCE_FIRE_TICKS,
  CONVERGENCE_BEAM_DPS,
  AVATAR_DAMAGE_PER_ECHO,
  PARADOX_ANCHOR_TOLERANCE,
  PARADOX_DIVERGE_DIST,
  PARADOX_DIVERGE_TICKS,
  PARADOX_TELEGRAPH_TICKS,
  PARADOX_AGGRO_RANGE,
  MINION_RADIUS,
  CORE_DEFAULT_HP,
  MINION_MELEE_TELEGRAPH,
  MINION_MELEE_CD,
  MINION_MELEE_RANGE,
  CASTER_STANDOFF,
  CASTER_TELEGRAPH,
  CASTER_CD,
  CASTER_BOLT_SPEED,
  CASTER_BOLT_RANGE,
  BOMBER_TELEGRAPH,
  BOMBER_AOE_RADIUS,
  BOMBER_TRIGGER_RANGE,
  HEALER_STANDOFF,
  HEALER_RANGE,
  HEALER_CD,
  SPLITTER_CHILDREN,
  SPLITTER_CHILD_HP_FRACTION,
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
import { BUTTON_SKILL, BUTTON_DASH, BUTTON_INTERACT, emptyInput } from './types.js';
import type {
  InputFrame,
  SimState,
  StepFn,
  Unit,
  Projectile,
  BossAttack,
  Turret,
  Interactable,
  ParadoxCause,
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
    dashSpeed: 0,
    tauntTicks: 0,
    sanctuaryTicks: 0,
    chargeTicks: 0,
    paradox: false,
    paradoxTelegraph: 0,
    divergedTicks: 0,
    invulnTicks: 0,
    invulnHits: 0,
    convergeCharge: 0,
    convergeFireTicks: 0,
    allyBuffCount: 0,
    enemyKind: null,
    attackCd: 0,
    attackTelegraph: 0,
    telegraphTotal: 0,
    shieldHp: 0,
    splitGen: 0,
    moveSpeed: 0,
    contactDamage: 0,
    healPower: 0,
    carryingCore: -1,
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
    turrets: [],
    interactables: [],
    paradoxEvents: [],
    objective: level.objective ?? 'boss',
  };

  // Interactables (Time Shards / levers / plates / doors / build pads / cores).
  if (level.interactables) {
    level.interactables.forEach((it, idx) => {
      const isCore = it.kind === 'core';
      state.interactables.push({
        id: state.nextId++,
        defIndex: idx,
        kind: it.kind,
        x: it.x,
        y: it.y,
        radius: it.radius,
        taken: false,
        takenBySlot: -1,
        takenAtTick: -1,
        active: it.kind === 'core' ? true : false,
        linkedTo: it.linkedTo ?? -1,
        hp: isCore ? (it.hp ?? CORE_DEFAULT_HP) : 0,
        buildNeeded: it.buildNeeded ?? 0,
        goalX: it.goalX ?? it.x,
        goalY: it.goalY ?? it.y,
      });
    });
  }

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
    const hpScale = level.echoHpScale && level.echoHpScale > 0 ? level.echoHpScale : 1;
    unit.maxHp = stats.maxHp;
    unit.hp = Math.max(1, Math.round(stats.maxHp * hpScale));
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
    turrets: [],
    interactables: [],
    paradoxEvents: [],
    objective: 'boss',
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
    turrets: state.turrets.map((t) => ({ ...t })),
    interactables: state.interactables.map((i) => ({ ...i })),
    paradoxEvents: state.paradoxEvents.map((e) => ({ ...e })),
    objective: state.objective,
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

/**
 * Per-slot recording metadata used ONLY for paradox detection (contract 3.4).
 * It is the recorded reality an echo is trying to reproduce: its position per
 * tick and its anchors (recorded pickups/interactions). Like echoInputs this is
 * transient scratch, fully derived from the deterministic recordings; it is not
 * hashed. The paradox verdicts it produces (unit.paradox, divergedTicks) ARE
 * hashed state, so determinism is preserved.
 */
export interface EchoRecordingMeta {
  /** positions[2t]=x, positions[2t+1]=y (the recorded path). */
  positions: Float64Array | number[];
  /** Recorded anchors: {objectId, tick}. objectId is a stable interactable id. */
  anchors: { objectId: number; tick: number }[];
  /** Length in ticks of the recording. */
  length: number;
}

let echoRecordings: Map<number, EchoRecordingMeta> = new Map();

/** Provide per-slot recording metadata for paradox detection this loop. */
export function setEchoRecordings(bySlot: Map<number, EchoRecordingMeta>): void {
  echoRecordings = bySlot;
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

  // M3: spawn any scheduled minions for this tick + update plate presence.
  spawnScheduledMinions(state);
  updatePresencePlates(state);

  // Build the broad-phase hash of player-team units for range queries.
  const hash = createSpatialHash(HASH_CELL);
  clearSpatialHash(hash);
  for (const u of state.units) {
    if (u.team === 'player' && u.alive) insert(hash, u.id, u.x, u.y);
  }

  // 0) Paradox detection + Avatar passive bookkeeping run first so this tick's
  // behaviour (hostile targeting, damage scaling) reflects the current verdict.
  const aliveEchoes = countAliveNonParadoxEchoes(state);
  for (const u of state.units) {
    if (u.classId === 'avatar') u.allyBuffCount = aliveEchoes;
  }

  // 1) Player-team units AND paradox echoes act (movement + abilities) in
  // stable id order. A paradox echo has team 'enemy' but is still processed
  // here so its telegraph counts down and it acts on its hostile kit.
  for (const u of state.units) {
    if (u.kind === 'boss' || u.kind === 'projectile' || !u.alive) continue;
    if (u.team !== 'player' && !u.paradox) continue;
    // Detect paradox before acting (needs pre-move position vs recording).
    detectParadox(state, u);
    countdownParadoxTelegraph(u);
    const input = inputForUnit(u, liveInput);
    if (u.paradox && u.paradoxTelegraph <= 0) {
      updateParadoxUnit(state, u, bossUnit, hash);
    } else if (u.team === 'player') {
      updatePlayerUnit(state, u, input, bossUnit, hash);
    }
    // A paradox echo mid-telegraph does nothing (frozen in its glitch).
  }

  // 2) Turrets act.
  updateTurrets(state, bossUnit);

  // 3) Projectiles advance and resolve hits (now team-aware for paradox).
  updateProjectiles(state, bossUnit);

  // 3b) Minions (non-boss enemies) act after projectiles, before the boss, in
  // stable id order. Deterministic generic AI reacts to enemyKind.
  updateMinions(state, bossUnit);

  // 4) Boss brain: targeting + pattern script + resolve landed attacks.
  if (bossUnit && bossUnit.alive) {
    updateBoss(state, bossUnit);
  }
  updateAttacks(state);

  // 4b) M3 objective mechanics: build pads fill, cores get carried to goals,
  // core HP is defended, doors open with linked plates/levers.
  updateObjectiveMechanics(state);

  // 5) Cull dead projectiles/attacks/turrets, and split dying splitters.
  if (state.units.some((u) => u.kind === 'minion')) handleMinionDeaths(state);
  state.projectiles = state.projectiles.filter((p) => p.life > 0);
  state.attacks = state.attacks.filter((a) => a.telegraphTicks > 0 || a.activeTicks > 0);
  state.turrets = state.turrets.filter((t) => t.life > 0 && t.hp > 0);

  // 6) Win / lose evaluation - objective-aware (M3).
  evaluateOutcome(state, bossUnit);

  state.tick += 1;
  return state;
};

// ---------------------------------------------------------------------------
// M3 objective-aware outcome evaluation
// ---------------------------------------------------------------------------

/**
 * Decide the loop outcome for the current objective. 'boss' (default) wins when
 * the boss dies. 'survive' wins at loopLength if every protected core is alive.
 * 'heist' wins when every core has reached its goal. 'build' wins when every
 * build pad is complete. A destroyed protected core fails the survive loop
 * (timeout with a dead core is not a win). Timeout otherwise.
 */
function evaluateOutcome(state: SimState, boss: Unit | undefined): void {
  const obj = state.objective;
  const atEnd = state.tick + 1 >= state.loopLength;
  if (obj === 'boss') {
    if (boss && !boss.alive) state.outcome = 'won';
    else if (atEnd) state.outcome = 'timeout';
    return;
  }
  if (obj === 'heist') {
    const cores = state.interactables.filter((i) => i.kind === 'core');
    const doors = state.interactables.filter((i) => i.kind === 'door');
    // Every core must be delivered while every gating door stands open.
    const delivered = cores.length > 0 && cores.every((c) => c.active && coreAtGoal(c));
    const doorsOpen = doors.every((d) => d.active);
    if (delivered && doorsOpen) state.outcome = 'won';
    else if (atEnd) state.outcome = 'timeout';
    return;
  }
  if (obj === 'build') {
    const pads = state.interactables.filter((i) => i.kind === 'buildpad');
    if (pads.length > 0 && pads.every((p) => p.active)) state.outcome = 'won';
    else if (atEnd) state.outcome = 'timeout';
    return;
  }
  // survive
  const cores = state.interactables.filter((i) => i.kind === 'core');
  const coreDead = cores.some((c) => !c.active);
  if (coreDead) {
    // A destroyed core immediately fails the loop (timeout, not a win).
    state.outcome = 'timeout';
    return;
  }
  if (atEnd) {
    // Survived to the end with the core (if any) intact: win.
    state.outcome = 'won';
  }
}

/** True when a core has been carried within its goal radius. */
function coreAtGoal(c: Interactable): boolean {
  return dist(c.x, c.y, c.goalX, c.goalY) <= c.radius + 8;
}

/** Count alive echoes that are not paradox (used for Avatar passive + stars). */
export function countAliveNonParadoxEchoes(state: SimState): number {
  let n = 0;
  for (const u of state.units) {
    if (u.kind === 'echo' && u.alive && !u.paradox) n += 1;
  }
  return n;
}

function findBoss(state: SimState): Unit | undefined {
  for (const u of state.units) if (u.kind === 'boss') return u;
  return undefined;
}

// ---------------------------------------------------------------------------
// Paradox detection (contract 3.4) - pure, deterministic
// ---------------------------------------------------------------------------

/**
 * Decide whether an echo has become a Paradox this tick. Only echoes with a
 * recording (echoRecordings) can paradox; the live player and the boss never
 * do. Two triggers (contract 3.4):
 *   - path diverged: |pos - recorded pos| > 12u for 20 consecutive ticks.
 *   - anchor broken: a recorded pickup/interaction cannot happen within +/-5
 *     ticks of its recorded tick (the interactable is already taken by another
 *     slot in this rewritten world).
 * A dead echo cannot paradox (death is not a paradox). Once paradox, it stays.
 */
function detectParadox(state: SimState, u: Unit): void {
  if (u.kind !== 'echo' || !u.alive || u.paradox) return;
  const rec = echoRecordings.get(u.slot);
  if (!rec) return;
  const t = state.tick;

  // --- Path divergence ---
  if (t < rec.length && t * 2 + 1 < rec.positions.length) {
    const rx = rec.positions[t * 2] as number;
    const ry = rec.positions[t * 2 + 1] as number;
    const d = dist(u.x, u.y, rx, ry);
    if (d > PARADOX_DIVERGE_DIST) {
      u.divergedTicks += 1;
      if (u.divergedTicks >= PARADOX_DIVERGE_TICKS) {
        triggerParadox(state, u, 'path-diverged', `Slot ${u.slot + 1} drifted off its path`);
        return;
      }
    } else {
      u.divergedTicks = 0;
    }
  }

  // --- Anchor broken ---
  for (const a of rec.anchors) {
    // Only evaluate the anchor around its recorded tick window.
    if (t < a.tick - PARADOX_ANCHOR_TOLERANCE || t > a.tick + PARADOX_ANCHOR_TOLERANCE) continue;
    const obj = interactableByDefIndex(state, a.objectId);
    if (!obj) continue;
    // The recorded reality: this echo took/flipped obj at ~a.tick. If, in the
    // rewritten world, obj is already taken by a DIFFERENT slot, that recorded
    // interaction can no longer happen -> paradox at the tolerance boundary.
    if (obj.taken && obj.takenBySlot !== u.slot) {
      // Only fire once we are past the earliest tolerated moment it could have
      // still happened (i.e. the window has effectively closed for this tick).
      const cause = obj.kind === 'shard' ? 'Shard' : 'Lever';
      triggerParadox(
        state,
        u,
        'anchor-broken',
        `${cause} taken by Slot ${obj.takenBySlot + 1}`,
      );
      return;
    }
  }
}

function triggerParadox(state: SimState, u: Unit, cause: ParadoxCause, detail: string): void {
  u.paradox = true;
  u.paradoxTelegraph = PARADOX_TELEGRAPH_TICKS;
  // Paradox echoes leave the player team: they are enemies of everyone.
  u.team = 'enemy';
  // Drop any boss threat entry the echo held (it is no longer an ally).
  state.boss.threat = state.boss.threat.filter((e) => e.targetId !== u.id);
  if (state.boss.targetId === u.id) state.boss.targetId = -1;
  state.paradoxEvents.push({
    tick: state.tick,
    slot: u.slot,
    cause,
    detail,
    x: u.x,
    y: u.y,
  });
}

function countdownParadoxTelegraph(u: Unit): void {
  if (u.paradox && u.paradoxTelegraph > 0) u.paradoxTelegraph -= 1;
}

function interactableByDefIndex(state: SimState, defIndex: number): Interactable | undefined {
  for (const it of state.interactables) if (it.defIndex === defIndex) return it;
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
    const stepDist = u.dashSpeed > 0 ? u.dashSpeed : stats.dashDistance / stats.dashTicks;
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
    u.dashSpeed = 0;
    u.dashTicks = stats.dashTicks;
    u.dashCd = stats.dashCd;
  }

  // --- Interact button (pick up shards / flip levers) ---
  if ((input.buttons & BUTTON_INTERACT) !== 0) {
    tryInteract(state, u);
  }

  // Invulnerability timers (Rogue Shadow Step grace) tick down.
  if (u.invulnTicks > 0) u.invulnTicks -= 1;

  // Avatar Convergence charge builds every tick, faster per alive echo.
  if (stats.id === 'avatar') {
    if (u.convergeFireTicks > 0) {
      u.convergeFireTicks -= 1;
      fireConvergenceBeams(state, u, boss);
    } else if (u.convergeCharge < CONVERGENCE_CHARGE) {
      u.convergeCharge += 1 + CONVERGE_PER_ECHO * u.allyBuffCount;
    }
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

/** Pick up a shard / flip a lever / grab a core within reach (anchor-able). */
function tryInteract(state: SimState, u: Unit): void {
  for (const it of state.interactables) {
    if (it.kind === 'plate' || it.kind === 'door' || it.kind === 'buildpad') continue;
    if (it.kind === 'core') {
      // Heist cores are grabbed (once), then ferried by the carrier.
      if (state.objective === 'heist' && it.takenBySlot < 0 && dist(u.x, u.y, it.x, it.y) <= it.radius) {
        it.takenBySlot = u.slot;
        it.takenAtTick = state.tick;
        it.taken = true;
      }
      continue;
    }
    if (it.taken && it.kind === 'shard') continue;
    if (dist(u.x, u.y, it.x, it.y) <= it.radius) {
      it.taken = it.kind === 'lever' ? !it.taken : true;
      it.takenBySlot = u.slot;
      it.takenAtTick = state.tick;
    }
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
    const d = dist(u.x, u.y, boss.x, boss.y);
    if (d <= stats.meleeRange + BOSS_RADIUS) {
      const toBoss = atan2Brads(boss.y - u.y, boss.x - u.x);
      if (angleWithin(u.facing, toBoss, stats.meleeHalfArc)) {
        dealDamageToBoss(state, boss, u, stats.primaryDamage);
        u.primaryCd = stats.primaryCd;
      }
    }
  } else if (cls === 'medic') {
    const target = lowestHpAlly(state, u, stats.healRange, hash);
    if (target) {
      const before = target.hp;
      target.hp = Math.min(target.maxHp, target.hp + stats.healPerTick);
      const healed = target.hp - before;
      if (healed > 0 && boss) addHealThreat(state.boss, u.id, healed);
      u.primaryCd = stats.primaryCd;
      u.facing = atan2Brads(target.y - u.y, target.x - u.x);
    }
  } else if (cls === 'ranger') {
    if (!boss || !boss.alive) return;
    const d = dist(u.x, u.y, boss.x, boss.y);
    if (d <= stats.projectileRange) {
      const ang = atan2Brads(boss.y - u.y, boss.x - u.x);
      u.facing = ang;
      spawnArrow(state, u, ang, stats.projectileSpeed, stats.primaryDamage, stats.projectileRange, 'arrow');
      u.primaryCd = stats.primaryCd;
    }
  } else if (cls === 'pyromancer') {
    if (!boss || !boss.alive) return;
    const d = dist(u.x, u.y, boss.x, boss.y);
    if (d <= stats.projectileRange) {
      const ang = atan2Brads(boss.y - u.y, boss.x - u.x);
      u.facing = ang;
      const p = spawnArrow(state, u, ang, stats.projectileSpeed, stats.primaryDamage, stats.projectileRange, 'orb');
      p.aoeRadius = FIRE_ORB_RADIUS;
      u.primaryCd = stats.primaryCd;
    }
  } else if (cls === 'engineer') {
    if (!boss || !boss.alive) return;
    const d = dist(u.x, u.y, boss.x, boss.y);
    if (d <= stats.projectileRange) {
      const ang = atan2Brads(boss.y - u.y, boss.x - u.x);
      u.facing = ang;
      spawnArrow(state, u, ang, stats.projectileSpeed, stats.primaryDamage, stats.projectileRange, 'bolt');
      u.primaryCd = stats.primaryCd;
    }
  } else if (cls === 'rogue') {
    if (!boss || !boss.alive) return;
    const d = dist(u.x, u.y, boss.x, boss.y);
    if (d <= stats.meleeRange + BOSS_RADIUS) {
      const toBoss = atan2Brads(boss.y - u.y, boss.x - u.x);
      if (angleWithin(u.facing, toBoss, stats.meleeHalfArc)) {
        // Twin slash = two hits; from behind the boss deals x2.
        let per = stats.primaryDamage;
        if (isBehind(u, boss)) per *= ROGUE_BACKSTAB_MUL;
        dealDamageToBoss(state, boss, u, per);
        dealDamageToBoss(state, boss, u, per);
        u.primaryCd = stats.primaryCd;
      }
    }
  } else if (cls === 'avatar') {
    if (!boss || !boss.alive) return;
    const mul = avatarDamageMul(u);
    const d = dist(u.x, u.y, boss.x, boss.y);
    // Melee chrono blade.
    let hit = false;
    if (d <= stats.meleeRange + BOSS_RADIUS) {
      const toBoss = atan2Brads(boss.y - u.y, boss.x - u.x);
      if (angleWithin(u.facing, toBoss, stats.meleeHalfArc)) {
        dealDamageToBoss(state, boss, u, stats.primaryDamage * mul);
        hit = true;
      }
    }
    // Short wave (also on cooldown even if the melee missed, if boss in range).
    if (d <= stats.projectileRange + BOSS_RADIUS + 40) {
      const ang = atan2Brads(boss.y - u.y, boss.x - u.x);
      u.facing = ang;
      spawnArrow(state, u, ang, stats.projectileSpeed, stats.primaryDamage * mul, stats.projectileRange, 'wave');
      hit = true;
    }
    if (hit) u.primaryCd = stats.primaryCd;
  }
}

/** Avatar passive: damage x (1 + 0.2 x alive non-paradox echoes). */
function avatarDamageMul(u: Unit): number {
  return 1 + AVATAR_DAMAGE_PER_ECHO * u.allyBuffCount;
}

/** True when `u` is behind `target` relative to the target's facing. */
function isBehind(u: Unit, target: Unit): boolean {
  const toU = atan2Brads(u.y - target.y, u.x - target.x);
  return !angleWithin(target.facing, toU, 1024); // outside +/-90deg front cone
}

function activateSkill(state: SimState, u: Unit, cls: ClassId, boss: Unit | undefined): void {
  const stats = classStats(cls);
  if (cls === 'guardian') {
    if (!boss) return;
    applyTaunt(state.boss, u.id, TAUNT_TICKS);
    u.skillCd = stats.skillCd;
  } else if (cls === 'medic') {
    for (const ally of state.units) {
      if (ally.team === 'player' && ally.alive) {
        if (dist(u.x, u.y, ally.x, ally.y) <= SANCTUARY_RADIUS) {
          ally.sanctuaryTicks = SANCTUARY_TICKS;
        }
      }
    }
    u.skillCd = stats.skillCd;
  } else if (cls === 'ranger') {
    u.chargeTicks = PIERCING_CHARGE_TICKS;
    u.skillCd = stats.skillCd;
  } else if (cls === 'pyromancer') {
    // Meteor: land a delayed AoE strike where the boss is (or facing point).
    let tx = u.x + (cosFx(u.facing) / TRIG_ONE) * 240;
    let ty = u.y + (sinFx(u.facing) / TRIG_ONE) * 240;
    if (boss && boss.alive) {
      tx = boss.x;
      ty = boss.y;
    }
    spawnMeteor(state, u, tx, ty);
    u.skillCd = stats.skillCd;
  } else if (cls === 'rogue') {
    // Shadow Step: fast dash + short invulnerability grace and hit charges.
    const dx = cosFx(u.facing) / TRIG_ONE;
    const dy = sinFx(u.facing) / TRIG_ONE;
    u.dashX = dx;
    u.dashY = dy;
    u.dashTicks = SHADOW_STEP_TICKS;
    u.dashSpeed = SHADOW_STEP_DISTANCE / SHADOW_STEP_TICKS;
    u.invulnTicks = SHADOW_STEP_TICKS + 2;
    u.invulnHits = SHADOW_STEP_INVULN_HITS;
    u.skillCd = stats.skillCd;
  } else if (cls === 'engineer') {
    deployTurret(state, u);
    u.skillCd = stats.skillCd;
  } else if (cls === 'avatar') {
    // Convergence: fire only when fully charged.
    if (u.convergeCharge >= CONVERGENCE_CHARGE && u.convergeFireTicks <= 0) {
      u.convergeFireTicks = CONVERGENCE_FIRE_TICKS;
      u.convergeCharge = 0;
    }
  }
}

/** Deploy an Engineer turret slightly in front of the unit. */
function deployTurret(state: SimState, u: Unit): void {
  const fx = cosFx(u.facing) / TRIG_ONE;
  const fy = sinFx(u.facing) / TRIG_ONE;
  const t: Turret = {
    id: state.nextId++,
    ownerId: u.id,
    ownerSlot: u.slot,
    team: u.team,
    x: clamp(u.x + fx * 40, -ARENA_HALF, ARENA_HALF),
    y: clamp(u.y + fy * 40, -ARENA_HALF, ARENA_HALF),
    hp: TURRET_HP,
    maxHp: TURRET_HP,
    life: TURRET_LIFE_TICKS,
    fireCd: TURRET_FIRE_CD,
    hostileToAll: u.paradox,
    facing: u.facing,
  };
  state.turrets.push(t);
}

/** Spawn the Pyromancer Meteor: a fused ground strike telegraph. */
function spawnMeteor(state: SimState, u: Unit, tx: number, ty: number): void {
  const p: Projectile = {
    id: state.nextId++,
    team: u.team,
    ownerId: u.id,
    ownerSlot: u.slot,
    x: tx,
    y: ty,
    vx: 0,
    vy: 0,
    damage: METEOR_DAMAGE,
    life: METEOR_FUSE_TICKS + 1,
    piercing: false,
    hits: [],
    aoeRadius: METEOR_RADIUS,
    fuseTicks: METEOR_FUSE_TICKS,
    hitsEveryone: u.paradox,
    visual: 'meteor',
  };
  state.projectiles.push(p);
}

function firePiercingShot(state: SimState, u: Unit): void {
  const boss = findBoss(state);
  let ang = u.facing;
  if (boss && boss.alive) ang = atan2Brads(boss.y - u.y, boss.x - u.x);
  const dx = cosFx(ang) / TRIG_ONE;
  const dy = sinFx(ang) / TRIG_ONE;
  const p: Projectile = {
    id: state.nextId++,
    team: u.team,
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
    hitsEveryone: u.paradox,
    visual: 'beam',
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
  visual: Projectile['visual'] = 'arrow',
): Projectile {
  const dx = cosFx(angle) / TRIG_ONE;
  const dy = sinFx(angle) / TRIG_ONE;
  const v = perTick(speed);
  const p: Projectile = {
    id: state.nextId++,
    team: u.team,
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
    hitsEveryone: u.paradox,
    visual,
  };
  state.projectiles.push(p);
  return p;
}

/**
 * True when projectile `p` may damage unit `t`. Player projectiles hit enemies
 * (boss + paradox echoes); enemy projectiles hit player-team; a paradox owner's
 * projectile (hitsEveryone) hits every living unit except its own owner.
 */
function projectileCanHit(p: Projectile, t: Unit): boolean {
  if (!t.alive) return false;
  if (t.id === p.ownerId) return false;
  if (p.hitsEveryone) return true;
  return t.team !== p.team;
}

function radiusFor(t: Unit): number {
  if (t.kind === 'boss') return BOSS_RADIUS;
  if (t.kind === 'minion') return MINION_RADIUS;
  return UNIT_RADIUS;
}

/** Deal projectile damage to a unit, routing to the boss/threat path if needed. */
function dealProjectileDamage(state: SimState, t: Unit, owner: Unit | undefined, dmg: number): void {
  if (t.kind === 'boss') {
    if (owner) dealDamageToBoss(state, t, owner, dmg);
  } else {
    dealDamageToUnit(t, dmg);
  }
}

// ---------------------------------------------------------------------------
// Paradox hostile behaviour (contract 3.4)
// ---------------------------------------------------------------------------

/**
 * A hostile paradox echo: it keeps its HP and class kit but turns on everyone.
 * It hunts the nearest non-paradox unit within PARADOX_AGGRO_RANGE (boss,
 * enemies, other echoes, or the live player) and uses its kit against it, with
 * support abilities INVERTED (heal->drain, Sanctuary->damage zone, turrets
 * shoot anyone). Enemy of everyone, including the boss.
 */
function updateParadoxUnit(
  state: SimState,
  u: Unit,
  boss: Unit | undefined,
  _hash: ReturnType<typeof createSpatialHash>,
): void {
  const stats = classStats(u.classId as ClassId);
  if (u.primaryCd > 0) u.primaryCd -= 1;
  if (u.skillCd > 0) u.skillCd -= 1;
  if (u.dashCd > 0) u.dashCd -= 1;
  if (u.invulnTicks > 0) u.invulnTicks -= 1;

  const target = nearestNonParadox(state, u, PARADOX_AGGRO_RANGE);
  if (target) {
    const tr = target.kind === 'boss' ? BOSS_RADIUS : UNIT_RADIUS;
    const d = dist(u.x, u.y, target.x, target.y);
    u.facing = atan2Brads(target.y - u.y, target.x - u.x);
    // Move to attack range (melee classes close; ranged keep some distance).
    const wantMelee = stats.meleeRange > 0 && stats.projectileRange <= 0;
    const desired = wantMelee ? stats.meleeRange + tr - 6 : Math.min(stats.projectileRange * 0.7, 260);
    if (d > desired) {
      const spd = perTick(stats.speed);
      u.x += ((target.x - u.x) / d) * spd;
      u.y += ((target.y - u.y) / d) * spd;
      clampToArena(u);
    }
    // Attack with the (possibly inverted) kit.
    if (u.primaryCd <= 0) doParadoxPrimary(state, u, stats.id, target);
    if (u.skillCd <= 0) doParadoxSkill(state, u, stats.id, target);
  }
  // Ranger charge still resolves if it was mid-charge when it flipped.
  if (u.chargeTicks > 0) {
    u.chargeTicks -= 1;
    if (u.chargeTicks === 0) firePiercingShot(state, u);
  }
  // Boss ref unused directly (target may be the boss). Silence linter.
  void boss;
}

/** Nearest living non-paradox unit within `range` (any team, incl. boss). */
function nearestNonParadox(state: SimState, from: Unit, range: number): Unit | undefined {
  let best: Unit | undefined;
  let bestD = range;
  let bestId = Number.POSITIVE_INFINITY;
  for (const t of state.units) {
    if (!t.alive || t.id === from.id) continue;
    if (t.paradox) continue; // paradox units ignore each other
    const d = dist(from.x, from.y, t.x, t.y);
    if (d < bestD - 1e-9 || (Math.abs(d - bestD) <= 1e-9 && t.id < bestId)) {
      bestD = d;
      best = t;
      bestId = t.id;
    }
  }
  return best;
}

/** Paradox primary: same shapes as the live kit but aimed at `target`. */
function doParadoxPrimary(state: SimState, u: Unit, cls: ClassId, target: Unit): void {
  const stats = classStats(cls);
  const tr = target.kind === 'boss' ? BOSS_RADIUS : UNIT_RADIUS;
  const d = dist(u.x, u.y, target.x, target.y);
  const ang = atan2Brads(target.y - u.y, target.x - u.x);
  if (cls === 'medic') {
    // Support inversion: the heal beam becomes a drain.
    if (d <= stats.healRange) {
      applyAnyDamage(state, u, target, stats.healPerTick * 2);
      u.primaryCd = stats.primaryCd;
    }
    return;
  }
  if (stats.meleeRange > 0 && (cls === 'guardian' || cls === 'rogue' || cls === 'avatar')) {
    if (d <= stats.meleeRange + tr) {
      const per = stats.primaryDamage * (cls === 'avatar' ? avatarDamageMul(u) : 1);
      if (cls === 'rogue') {
        applyAnyDamage(state, u, target, per);
        applyAnyDamage(state, u, target, per);
      } else {
        applyAnyDamage(state, u, target, per);
      }
      u.primaryCd = stats.primaryCd;
    }
    if (cls === 'avatar' && d <= stats.projectileRange + tr + 40) {
      const p = spawnArrow(state, u, ang, stats.projectileSpeed, stats.primaryDamage, stats.projectileRange, 'wave');
      p.hitsEveryone = true;
    }
  } else if (stats.projectileRange > 0) {
    if (d <= stats.projectileRange) {
      const p = spawnArrow(state, u, ang, stats.projectileSpeed, stats.primaryDamage, stats.projectileRange, cls === 'pyromancer' ? 'orb' : cls === 'engineer' ? 'bolt' : 'arrow');
      if (cls === 'pyromancer') p.aoeRadius = FIRE_ORB_RADIUS;
      p.hitsEveryone = true;
      u.primaryCd = stats.primaryCd;
    }
  }
}

/** Paradox skill: inverted where it was support. */
function doParadoxSkill(state: SimState, u: Unit, cls: ClassId, target: Unit): void {
  const stats = classStats(cls);
  if (cls === 'medic') {
    // Sanctuary becomes a damage zone: everyone nearby (non-paradox) is hurt.
    for (const t of state.units) {
      if (!t.alive || t.paradox || t.id === u.id) continue;
      if (dist(u.x, u.y, t.x, t.y) <= SANCTUARY_RADIUS) applyAnyDamage(state, u, t, 20);
    }
    u.skillCd = stats.skillCd;
  } else if (cls === 'ranger') {
    u.chargeTicks = PIERCING_CHARGE_TICKS;
    u.skillCd = stats.skillCd;
  } else if (cls === 'pyromancer') {
    spawnMeteor(state, u, target.x, target.y);
    u.skillCd = stats.skillCd;
  } else if (cls === 'engineer') {
    deployTurret(state, u); // hostileToAll inherits u.paradox = true
    u.skillCd = stats.skillCd;
  } else if (cls === 'guardian' || cls === 'rogue' || cls === 'avatar') {
    // No useful skill inversion; put it on a short cooldown so it re-evaluates.
    u.skillCd = 30;
  }
}

/** Apply damage to any unit (boss routed through the threat path with credit). */
function applyAnyDamage(state: SimState, owner: Unit, target: Unit, dmg: number): void {
  if (target.kind === 'boss') {
    dealDamageToBoss(state, target, owner, dmg);
  } else {
    dealDamageToUnit(target, dmg);
  }
}

// ---------------------------------------------------------------------------
// Engineer turrets
// ---------------------------------------------------------------------------

function updateTurrets(state: SimState, _boss: Unit | undefined): void {
  for (const t of state.turrets) {
    if (t.life <= 0 || t.hp <= 0) continue;
    t.life -= 1;
    if (t.fireCd > 0) t.fireCd -= 1;
    if (t.fireCd > 0) continue;
    // Find a target: normally enemies of the turret's team; a hostile turret
    // (paradox owner) shoots the nearest living unit of any kind.
    const target = turretTarget(state, t);
    if (!target) continue;
    t.facing = atan2Brads(target.y - t.y, target.x - t.x);
    const dx = cosFx(t.facing) / TRIG_ONE;
    const dy = sinFx(t.facing) / TRIG_ONE;
    const v = perTick(TURRET_PROJECTILE_SPEED);
    const p: Projectile = {
      id: state.nextId++,
      team: t.team,
      ownerId: t.ownerId,
      ownerSlot: t.ownerSlot,
      x: t.x,
      y: t.y,
      vx: dx * v,
      vy: dy * v,
      damage: TURRET_DAMAGE,
      life: Math.ceil(TURRET_RANGE / v),
      piercing: false,
      hits: [],
      hitsEveryone: t.hostileToAll,
      visual: 'bolt',
    };
    state.projectiles.push(p);
    t.fireCd = TURRET_FIRE_CD;
  }
}

function turretTarget(state: SimState, t: Turret): Unit | undefined {
  let best: Unit | undefined;
  let bestD = TURRET_RANGE;
  let bestId = Number.POSITIVE_INFINITY;
  for (const u of state.units) {
    if (!u.alive || u.id === t.ownerId) continue;
    const valid = t.hostileToAll ? !u.paradox : u.team !== t.team;
    if (!valid) continue;
    const d = dist(t.x, t.y, u.x, u.y);
    if (d < bestD - 1e-9 || (Math.abs(d - bestD) <= 1e-9 && u.id < bestId)) {
      bestD = d;
      best = u;
      bestId = u.id;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Avatar Convergence (contract 3.6)
// ---------------------------------------------------------------------------

/**
 * While the Avatar's Convergence is firing, every alive echo (non-paradox) and
 * the Avatar itself beam the boss for CONVERGENCE_BEAM_DPS/tick. The climax.
 */
function fireConvergenceBeams(state: SimState, avatar: Unit, boss: Unit | undefined): void {
  if (!boss || !boss.alive) return;
  const perTickDmg = CONVERGENCE_BEAM_DPS / 60;
  // Avatar's own beam scales with its passive.
  dealDamageToBoss(state, boss, avatar, perTickDmg * avatarDamageMul(avatar));
  for (const u of state.units) {
    if (u.kind === 'echo' && u.alive && !u.paradox) {
      dealDamageToBoss(state, boss, u, perTickDmg);
    }
  }
}

function updateProjectiles(state: SimState, _boss: Unit | undefined): void {
  for (const p of state.projectiles) {
    if (p.life <= 0) continue;

    // Fused ground strike (Meteor): hold, then detonate as an AoE.
    if (p.fuseTicks !== undefined && p.fuseTicks > 0) {
      p.fuseTicks -= 1;
      p.life -= 1;
      if (p.fuseTicks === 0) {
        detonateAoe(state, p);
        p.life = 0;
      }
      continue;
    }

    p.x += p.vx;
    p.y += p.vy;
    p.life -= 1;

    const owner = unitById(state, p.ownerId);
    if (p.piercing) {
      for (const t of state.units) {
        if (!projectileCanHit(p, t)) continue;
        if (p.hits.indexOf(t.id) >= 0) continue;
        if (dist(p.x, p.y, t.x, t.y) <= radiusFor(t) + PIERCING_HALF_WIDTH) {
          dealProjectileDamage(state, t, owner, p.damage);
          p.hits.push(t.id);
        }
      }
    } else {
      for (const t of state.units) {
        if (!projectileCanHit(p, t)) continue;
        if (dist(p.x, p.y, t.x, t.y) <= radiusFor(t)) {
          if (p.aoeRadius && p.aoeRadius > 0) {
            detonateAoe(state, p);
          } else {
            dealProjectileDamage(state, t, owner, p.damage);
          }
          p.life = 0;
          break;
        }
      }
    }
  }
}

/** Apply an AoE projectile's damage to every valid target within its radius. */
function detonateAoe(state: SimState, p: Projectile): void {
  const owner = unitById(state, p.ownerId);
  const r = p.aoeRadius ?? 0;
  for (const t of state.units) {
    if (!projectileCanHit(p, t)) continue;
    if (dist(p.x, p.y, t.x, t.y) <= r + radiusFor(t)) {
      dealProjectileDamage(state, t, owner, p.damage);
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

/** Deal damage to a unit (enemy attack, turret, or paradox). Damage only. */
function dealDamageToUnit(u: Unit, rawDamage: number): void {
  if (rawDamage <= 0 || !u.alive) return;
  // Rogue Shadow Step invulnerability: ignore hits while grace + charges remain.
  if (u.invulnTicks > 0 && u.invulnHits > 0) {
    u.invulnHits -= 1;
    return;
  }
  // Shielded minion: the frontal shield soaks damage until it breaks.
  if (u.kind === 'minion' && u.shieldHp > 0) {
    const absorbed = Math.min(u.shieldHp, rawDamage);
    u.shieldHp -= absorbed;
    const leftover = rawDamage - absorbed;
    if (leftover <= 0) return;
    u.hp -= leftover;
    if (u.hp <= 0) {
      u.hp = 0;
      u.alive = false;
    }
    return;
  }
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
/** Body radius for player-team / paradox units (projectile hit tests). */
export const UNIT_RADIUS = 18;
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

/**
 * The active level's minion spawn schedule (M3). Like the boss pattern this is
 * content-authored, deterministic data set once per loop by the runner; it does
 * not enter the hashed state (the spawned units do). Each entry fires when
 * `state.tick === spawnTick`, in list order (stable ids).
 */
let currentMinions: import('./level.js').LevelMinion[] = [];
export function setLevelMinions(minions: import('./level.js').LevelMinion[]): void {
  currentMinions = minions;
}

/** Spawn every scheduled minion whose spawnTick equals the current tick. */
function spawnScheduledMinions(state: SimState): void {
  for (const m of currentMinions) {
    if (m.spawnTick !== state.tick) continue;
    const u = makeUnit(state.nextId++, 'minion', 'enemy', -1);
    u.enemyKind = m.kind;
    u.x = m.x;
    u.y = m.y;
    u.hp = m.maxHp;
    u.maxHp = m.maxHp;
    u.moveSpeed = m.speed;
    u.contactDamage = m.damage;
    u.shieldHp = m.shieldHp ?? 0;
    u.healPower = m.healPower ?? 0;
    u.carryingCore = m.carryCore ?? -1;
    u.attackCd = 0;
    state.units.push(u);
  }
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
// M3 minion roster (brief section 5) - generic deterministic enemy AI
// ---------------------------------------------------------------------------

/**
 * Update every alive minion in stable id order. Each archetype has a clear,
 * telegraphed behaviour and hunts the nearest player-team, non-paradox unit
 * (its "prey"). Minions are enemies: player projectiles/AoE already damage them
 * via projectileCanHit, and minion attacks damage player-team units only.
 */
function updateMinions(state: SimState, boss: Unit | undefined): void {
  for (const u of state.units) {
    if (u.kind !== 'minion' || !u.alive) continue;
    if (u.attackCd > 0) u.attackCd -= 1;
    const prey = nearestPrey(state, u);
    switch (u.enemyKind) {
      case 'chaser':
      case 'shielded':
        updateChaser(state, u, prey);
        break;
      case 'caster':
        updateCaster(state, u, prey);
        break;
      case 'bomber':
        updateBomber(state, u, prey);
        break;
      case 'healer':
        updateHealer(state, u, prey, boss);
        break;
      case 'splitter':
        updateChaser(state, u, prey);
        break;
      default:
        break;
    }
  }
}

/** Nearest alive player-team, non-paradox unit to `from` (deterministic ties). */
function nearestPrey(state: SimState, from: Unit): Unit | undefined {
  let best: Unit | undefined;
  let bestD = Number.POSITIVE_INFINITY;
  let bestId = Number.POSITIVE_INFINITY;
  for (const t of state.units) {
    if (!t.alive || t.team !== 'player' || t.paradox) continue;
    const d = dist(from.x, from.y, t.x, t.y);
    if (d < bestD - 1e-9 || (Math.abs(d - bestD) <= 1e-9 && t.id < bestId)) {
      bestD = d;
      best = t;
      bestId = t.id;
    }
  }
  return best;
}

/** Move a minion toward a point at its move speed, respecting closed doors. */
function moveMinionToward(u: Unit, tx: number, ty: number, stopAt: number): void {
  const d = dist(u.x, u.y, tx, ty);
  if (d <= stopAt) {
    u.facing = atan2Brads(ty - u.y, tx - u.x);
    return;
  }
  const spd = perTick(u.moveSpeed > 0 ? u.moveSpeed : 120);
  const nx = (tx - u.x) / d;
  const ny = (ty - u.y) / d;
  u.facing = atan2Brads(ny, nx);
  u.x = clamp(u.x + nx * spd, -ARENA_HALF, ARENA_HALF);
  u.y = clamp(u.y + ny * spd, -ARENA_HALF, ARENA_HALF);
}

/** Chaser / shielded / splitter: close to melee, wind up, then strike. */
function updateChaser(_state: SimState, u: Unit, prey: Unit | undefined): void {
  if (!prey) return;
  const d = dist(u.x, u.y, prey.x, prey.y);
  const reach = MINION_MELEE_RANGE + UNIT_RADIUS;
  if (u.attackTelegraph > 0) {
    // Winding up: hold position; land the hit when the telegraph elapses.
    u.attackTelegraph -= 1;
    u.facing = atan2Brads(prey.y - u.y, prey.x - u.x);
    if (u.attackTelegraph === 0) {
      if (dist(u.x, u.y, prey.x, prey.y) <= reach + 12) {
        dealDamageToUnit(prey, u.contactDamage);
      }
      u.attackCd = MINION_MELEE_CD;
    }
    return;
  }
  moveMinionToward(u, prey.x, prey.y, reach);
  if (d <= reach && u.attackCd <= 0) {
    u.attackTelegraph = MINION_MELEE_TELEGRAPH;
    u.telegraphTotal = MINION_MELEE_TELEGRAPH;
  }
}

/** Caster: hold a standoff and lob a telegraphed slow bolt. */
function updateCaster(state: SimState, u: Unit, prey: Unit | undefined): void {
  if (!prey) return;
  const d = dist(u.x, u.y, prey.x, prey.y);
  if (u.attackTelegraph > 0) {
    u.attackTelegraph -= 1;
    u.facing = atan2Brads(prey.y - u.y, prey.x - u.x);
    if (u.attackTelegraph === 0) {
      const ang = atan2Brads(prey.y - u.y, prey.x - u.x);
      spawnEnemyBolt(state, u, ang, CASTER_BOLT_SPEED, u.contactDamage, CASTER_BOLT_RANGE);
      u.attackCd = CASTER_CD;
    }
    return;
  }
  if (d > CASTER_STANDOFF + 30) moveMinionToward(u, prey.x, prey.y, CASTER_STANDOFF);
  else if (d < CASTER_STANDOFF - 30) moveMinionToward(u, u.x * 2 - prey.x, u.y * 2 - prey.y, 0);
  else u.facing = atan2Brads(prey.y - u.y, prey.x - u.x);
  if (d <= CASTER_BOLT_RANGE && u.attackCd <= 0) {
    u.attackTelegraph = CASTER_TELEGRAPH;
    u.telegraphTotal = CASTER_TELEGRAPH;
  }
}

/** Bomber: charge the prey, then detonate a telegraphed AoE near it. */
function updateBomber(state: SimState, u: Unit, prey: Unit | undefined): void {
  if (!prey) return;
  const d = dist(u.x, u.y, prey.x, prey.y);
  if (u.attackTelegraph > 0) {
    u.attackTelegraph -= 1;
    if (u.attackTelegraph === 0) {
      // Detonate: AoE damage to all player-team units in range; bomber dies.
      for (const t of state.units) {
        if (t.team !== 'player' || !t.alive) continue;
        if (dist(u.x, u.y, t.x, t.y) <= BOMBER_AOE_RADIUS + UNIT_RADIUS) {
          dealDamageToUnit(t, u.contactDamage);
        }
      }
      u.hp = 0;
      u.alive = false;
    }
    return;
  }
  moveMinionToward(u, prey.x, prey.y, BOMBER_TRIGGER_RANGE - 8);
  if (d <= BOMBER_TRIGGER_RANGE) {
    u.attackTelegraph = BOMBER_TELEGRAPH;
    u.telegraphTotal = BOMBER_TELEGRAPH;
  }
}

/** Healer: keep a standoff and heal the most-wounded enemy (incl. the boss). */
function updateHealer(
  state: SimState,
  u: Unit,
  prey: Unit | undefined,
  boss: Unit | undefined,
): void {
  // Flee from the nearest prey to survive; heal an enemy on cadence.
  if (prey) {
    const d = dist(u.x, u.y, prey.x, prey.y);
    if (d < HEALER_STANDOFF) moveMinionToward(u, u.x * 2 - prey.x, u.y * 2 - prey.y, 0);
  }
  if (u.attackCd > 0) return;
  const patient = mostWoundedEnemy(state, u, boss);
  if (patient && dist(u.x, u.y, patient.x, patient.y) <= HEALER_RANGE) {
    patient.hp = Math.min(patient.maxHp, patient.hp + u.healPower);
    u.attackCd = HEALER_CD;
    u.facing = atan2Brads(patient.y - u.y, patient.x - u.x);
  }
}

/** The enemy (boss or minion) with the lowest HP fraction below full. */
function mostWoundedEnemy(state: SimState, healer: Unit, boss: Unit | undefined): Unit | undefined {
  let best: Unit | undefined;
  let bestFrac = 1;
  let bestId = Number.POSITIVE_INFINITY;
  const consider = (t: Unit): void => {
    if (!t.alive || t.id === healer.id) return;
    if (t.team !== 'enemy' || t.paradox) return;
    if (t.hp >= t.maxHp) return;
    const frac = t.hp / t.maxHp;
    if (frac < bestFrac - 1e-9 || (Math.abs(frac - bestFrac) <= 1e-9 && t.id < bestId)) {
      bestFrac = frac;
      best = t;
      bestId = t.id;
    }
  };
  for (const t of state.units) consider(t);
  if (boss) consider(boss);
  return best;
}

/** Spawn a straight enemy bolt (caster). Damages player-team units. */
function spawnEnemyBolt(
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
    team: 'enemy',
    ownerId: u.id,
    ownerSlot: -1,
    x: u.x,
    y: u.y,
    vx: dx * v,
    vy: dy * v,
    damage,
    life: Math.ceil(range / v),
    piercing: false,
    hits: [],
    visual: 'bolt',
  };
  state.projectiles.push(p);
}

/** Splitter death: spawn SPLITTER_CHILDREN smaller children (generation 0 only). */
function handleMinionDeaths(state: SimState): void {
  const newborns: Unit[] = [];
  for (const u of state.units) {
    if (u.kind !== 'minion' || u.alive) continue;
    if (u.enemyKind === 'splitter' && u.splitGen === 0) {
      for (let i = 0; i < SPLITTER_CHILDREN; i++) {
        const c = makeUnit(state.nextId++, 'minion', 'enemy', -1);
        c.enemyKind = 'splitter';
        c.splitGen = 1;
        c.maxHp = Math.max(1, Math.round(u.maxHp * SPLITTER_CHILD_HP_FRACTION));
        c.hp = c.maxHp;
        c.moveSpeed = u.moveSpeed;
        c.contactDamage = Math.round(u.contactDamage * 0.6);
        // Offset children left/right so they do not stack (deterministic).
        c.x = clamp(u.x + (i === 0 ? -30 : 30), -ARENA_HALF, ARENA_HALF);
        c.y = clamp(u.y + 20, -ARENA_HALF, ARENA_HALF);
        newborns.push(c);
      }
    }
  }
  // Cull dead minions; keep boss/players (their alive flag is handled elsewhere).
  state.units = state.units.filter((u) => u.kind !== 'minion' || u.alive);
  for (const c of newborns) state.units.push(c);
}

// ---------------------------------------------------------------------------
// M3 objective mechanics: plates, doors, cores, build pads
// ---------------------------------------------------------------------------

/** Recompute each pressure plate's `active` flag from live player presence. */
function updatePresencePlates(state: SimState): void {
  for (const it of state.interactables) {
    if (it.kind !== 'plate') continue;
    let pressed = false;
    for (const u of state.units) {
      if (u.team !== 'player' || !u.alive || u.paradox) continue;
      if (dist(u.x, u.y, it.x, it.y) <= it.radius) {
        pressed = true;
        break;
      }
    }
    it.active = pressed;
    if (pressed && it.takenAtTick < 0) {
      it.takenAtTick = state.tick;
      it.taken = true;
    }
  }
}

/**
 * Advance objective mechanics after units have moved this tick:
 *  - doors open while their linked plate is pressed or linked lever flipped;
 *  - build pads fill while a player-team unit stands on them, then complete;
 *  - a carried core follows its carrier and is delivered when at its goal;
 *  - protected cores take contact damage from adjacent enemies.
 */
function updateObjectiveMechanics(state: SimState): void {
  for (const it of state.interactables) {
    if (it.kind === 'door') {
      const link = it.linkedTo >= 0 ? interactableByDefIndex(state, it.linkedTo) : undefined;
      // Open while the linked plate is pressed or the linked lever is flipped.
      it.active = link ? link.active || link.taken : it.taken;
    } else if (it.kind === 'buildpad') {
      if (it.active) continue; // already built
      let standing = false;
      for (const u of state.units) {
        if (u.team !== 'player' || !u.alive || u.paradox) continue;
        if (dist(u.x, u.y, it.x, it.y) <= it.radius) {
          standing = true;
          break;
        }
      }
      if (standing) {
        it.hp += 1; // build progress in ticks
        if (it.hp >= it.buildNeeded) {
          it.active = true;
          it.taken = true;
          it.takenAtTick = state.tick;
        }
      }
    } else if (it.kind === 'core') {
      updateCore(state, it);
    }
  }
}

/**
 * A Time-Core. In a heist it can be picked up (via Interact) by a player-team
 * unit and ferried; while carried it tracks the carrier and is "delivered" when
 * inside its goal zone. In Protect-the-Core it stays put and loses HP to
 * adjacent enemies; at 0 HP it is destroyed (`active` = false).
 */
function updateCore(state: SimState, core: Interactable): void {
  if (state.objective === 'heist') {
    // takenBySlot holds the carrying slot; follow that carrier's position.
    if (core.takenBySlot >= 0) {
      const carrier = state.units.find(
        (u) => u.slot === core.takenBySlot && u.team === 'player' && u.alive && !u.paradox,
      );
      if (carrier) {
        core.x = carrier.x;
        core.y = carrier.y;
      } else {
        // Carrier died / paradoxed: drop the core where it is.
        core.takenBySlot = -1;
      }
    }
    return;
  }
  // Protect-the-Core: enemies adjacent to the core chip its HP.
  if (!core.active) return;
  for (const u of state.units) {
    if (u.team !== 'enemy' || !u.alive || u.paradox) continue;
    if (u.kind === 'boss') continue; // boss uses its own attacks
    if (dist(u.x, u.y, core.x, core.y) <= core.radius + MINION_RADIUS) {
      core.hp -= u.contactDamage > 0 ? u.contactDamage / 30 : 0.5;
    }
  }
  if (core.hp <= 0) {
    core.hp = 0;
    core.active = false;
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
