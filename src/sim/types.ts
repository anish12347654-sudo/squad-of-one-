/**
 * Core simulation types shared across the pure sim layer.
 *
 * Everything here is plain data: serializable, cloneable, and hashable. No
 * class instances with hidden state, no references to render objects.
 *
 * ===========================================================================
 * FROZEN AT M1. These shapes are part of the public sim contract documented in
 * docs/ARCHITECTURE.md ("Frozen M1 Contracts"). Later content milestones add
 * *new* optional fields and enum members but must not repurpose or remove the
 * existing ones. See that section before changing anything here.
 * ===========================================================================
 */

import type { RngState } from './prng.js';

/** Fixed simulation rate. The sim advances in whole ticks of 1/60 s. */
export const TICK_RATE_HZ = 60;
/** Seconds per tick (for the runner's accumulator; never used inside step()). */
export const TICK_DT_SECONDS = 1 / TICK_RATE_HZ;
/** Fixed-point milliseconds per tick used for integer time math in the sim. */
export const TICK_DT_MS = 1000 / TICK_RATE_HZ;

/**
 * A single frame of player input, quantized to the wire format described in
 * docs/ARCHITECTURE.md. This is the ONLY external input to the sim, for both
 * the live player and recorded echoes.
 */
export interface InputFrame {
  /** Movement X in [-127, 127] (int8). 127 == full-speed right. */
  moveX: number;
  /** Movement Y in [-127, 127] (int8). 127 == full-speed down. */
  moveY: number;
  /** Aim direction as a uint8 (0..255), mapped onto 4096 brads when active. */
  aim: number;
  /** True when the aim stick/mouse is actively held (aim is meaningful). */
  aimActive: boolean;
  /** Button bitmask (uint8). See BUTTON_* constants. */
  buttons: number;
}

/** Button bits packed into InputFrame.buttons (uint8). FROZEN. */
export const BUTTON_SKILL = 1 << 0;
export const BUTTON_DASH = 1 << 1;
export const BUTTON_INTERACT = 1 << 2;

/** An empty/neutral input frame. */
export function emptyInput(): InputFrame {
  return { moveX: 0, moveY: 0, aim: 0, aimActive: false, buttons: 0 };
}

/**
 * Playable classes. The first three are FROZEN from M1; M2 adds four more
 * (Pyromancer, Rogue, Engineer, Avatar) additively - a new enum member is an
 * allowed extension of the frozen contract. `avatar` is last-slot-only (enforced
 * by the runner, not the type).
 */
export type ClassId =
  | 'guardian'
  | 'medic'
  | 'ranger'
  | 'pyromancer'
  | 'rogue'
  | 'engineer'
  | 'avatar';

/** Kind discriminator for entities. FROZEN (later kinds are additive). */
export type EntityKind = 'player' | 'echo' | 'boss' | 'projectile' | 'minion';

/**
 * Non-boss enemy archetypes (brief section 5). M3 additive. Each has a clear,
 * deterministic telegraph and is authored as typed data in src/content. The
 * generic minion AI in the sim (updateMinion) reacts to `enemyKind`.
 *   - chaser:   sprints at the current threat target and melees on contact.
 *   - caster:   stands off and lobs a telegraphed slow bolt.
 *   - bomber:   charges the target then detonates in an AoE (telegraphed).
 *   - shielded: chaser with a frontal shield that must be flanked / broken.
 *   - healer:   keeps its distance and heals wounded enemies (incl. the boss).
 *   - splitter: on death spawns two smaller splitters (once).
 */
export type EnemyKind =
  | 'chaser'
  | 'caster'
  | 'bomber'
  | 'shielded'
  | 'healer'
  | 'splitter';

/** Which side an entity fights for. Player-team never body-collides. FROZEN. */
export type Team = 'player' | 'enemy';

/**
 * A live unit: the live player, an echo (recorded past self), or an enemy/boss.
 * Projectiles are a separate lighter shape. All numeric fields are plain units.
 */
export interface Unit {
  id: number;
  kind: EntityKind;
  team: Team;
  /** Slot index this unit belongs to (0-based). -1 for the boss. */
  slot: number;
  classId: ClassId | null;
  x: number;
  y: number;
  /** Facing angle in brads; used for melee arcs and rendering. */
  facing: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  /** Ticks remaining on the primary attack cooldown. */
  primaryCd: number;
  /** Ticks remaining on the skill cooldown. */
  skillCd: number;
  /** Ticks remaining on the dash cooldown. */
  dashCd: number;
  /** Ticks remaining in the current dash movement (0 = not dashing). */
  dashTicks: number;
  /** Dash direction unit vector (valid while dashTicks > 0). */
  dashX: number;
  dashY: number;
  /**
   * Distance moved per tick during the current dash (units/tick). Set when a
   * dash begins; lets Shadow Step use a longer travel than the shared dash.
   * 0 falls back to the class's dashDistance/dashTicks. M2 additive field.
   */
  dashSpeed: number;
  /** Ticks remaining while this unit is a forced taunt target (boss-side use). */
  tauntTicks: number;
  /** Ticks remaining of the Medic Sanctuary damage-reduction buff on this unit. */
  sanctuaryTicks: number;
  /** Ticks remaining charging the Ranger Piercing Shot (0 = not charging). */
  chargeTicks: number;

  // --- M2 additive fields (default 0/false; do not affect M1 semantics) ---
  /**
   * Paradox state (contract 3.4). 0 = normal echo/unit. >0 counts down the
   * 0.5 s glitch telegraph; when it reaches 1 the unit becomes fully hostile.
   * A hostile paradox echo has `paradox` true and `paradoxTelegraph` 0.
   */
  paradox: boolean;
  /** Ticks remaining of the paradox glitch telegraph (0 once fully hostile). */
  paradoxTelegraph: number;
  /**
   * Consecutive ticks the unit's live position has diverged >12u from its
   * recording. Reset to 0 whenever it is within tolerance. Runner-fed.
   */
  divergedTicks: number;
  /** Ticks of invulnerability remaining (Rogue Shadow Step grace). */
  invulnTicks: number;
  /** Remaining invulnerable-hit charges (Rogue: ignore next N hits). */
  invulnHits: number;
  /**
   * Avatar Convergence charge in ticks accumulated toward CONVERGENCE_CHARGE.
   * Only meaningful for the Avatar; charges faster per alive echo.
   */
  convergeCharge: number;
  /** Ticks remaining of the Convergence beam being fired (visual + damage). */
  convergeFireTicks: number;
  /** Cached count of alive non-paradox echoes (Avatar passive scaling), per tick. */
  allyBuffCount: number;

  // --- M3 additive fields (minion roster; default 0/null for players/bosses) --
  /** Enemy archetype for a `minion` unit; null for players/echoes/boss. */
  enemyKind: EnemyKind | null;
  /**
   * Generic enemy attack cooldown / telegraph timer (ticks). Minions wind up an
   * attack for `telegraphTotal` ticks (counting `attackTelegraph` down to 0),
   * fire, then wait `attackCd`. Shared, deterministic, hashed.
   */
  attackCd: number;
  attackTelegraph: number;
  /** The telegraph length for the current wind-up (so the renderer can ratio). */
  telegraphTotal: number;
  /** Frontal shield HP for a `shielded` minion (absorbs front-facing damage). */
  shieldHp: number;
  /** Generation of a `splitter` (0 = original, 1 = spawned child; children don't split). */
  splitGen: number;
  /** Movement speed override for minions (u/s); 0 falls back to a default. */
  moveSpeed: number;
  /** Contact/melee/explosion damage for a minion. */
  contactDamage: number;
  /** Heal-per-tick for a `healer` minion. */
  healPower: number;
  /** Carried Time-Core defIndex for a heist carrier (-1 = not carrying). */
  carryingCore: number;
}

/** A lightweight projectile (arrows, etc.). FROZEN (M2 adds optional fields). */
export interface Projectile {
  id: number;
  team: Team;
  /** Owning unit id (for threat credit). */
  ownerId: number;
  ownerSlot: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  damage: number;
  /** Ticks of life remaining before despawn. */
  life: number;
  /** True for piercing projectiles (do not despawn on first hit). */
  piercing: boolean;
  /** Ids already hit (so a piercing shot hits each enemy once). */
  hits: number[];

  // --- M2 additive fields ---
  /** Area-of-effect radius on impact (0 = single-target point). Pyro fire orb. */
  aoeRadius?: number;
  /**
   * Delayed ground strike (Pyromancer Meteor): while > 0 the projectile hangs
   * at (x,y) as a telegraph, then detonates for `damage` in `aoeRadius`.
   */
  fuseTicks?: number;
  /**
   * Owning team the projectile can damage. Normally the opposite of `team`.
   * A paradox owner's projectiles hit everyone (see sim). Optional; when
   * omitted the sim uses the default enemy-of-team rule.
   */
  hitsEveryone?: boolean;
  /** Visual kind hint for the renderer (never read by sim gameplay). */
  visual?: 'arrow' | 'orb' | 'meteor' | 'bolt' | 'slash' | 'wave' | 'beam';
}

/**
 * An Engineer turret (contract section 4). Deployed by the Skill; lasts a fixed
 * duration, has HP, and auto-fires at the nearest valid target. A paradox
 * owner's turret shoots anyone. M2 additive entity.
 */
export interface Turret {
  id: number;
  ownerId: number;
  ownerSlot: number;
  team: Team;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  /** Ticks remaining before the turret expires. */
  life: number;
  /** Ticks until the turret may fire again. */
  fireCd: number;
  /** True once the owner turned paradox: the turret shoots anyone. */
  hostileToAll: boolean;
  facing: number;
}

/** A single boss telegraph/attack in flight. FROZEN (geometry union). */
export interface BossAttack {
  id: number;
  /** 'slam' = circle at a point; 'cone' = arc from boss; 'charge' = line lane. */
  shape: 'slam' | 'cone' | 'charge';
  /** Ticks remaining in the telegraph (windup) phase. */
  telegraphTicks: number;
  /** Ticks the active (damaging) phase lasts once telegraph ends. */
  activeTicks: number;
  /** True once the attack has landed its damage (active, one-shot). */
  fired: boolean;
  /** Geometry: origin/centre. */
  x: number;
  y: number;
  /** slam radius / charge length / cone reach. */
  radius: number;
  /** Direction in brads (cone/charge). */
  angle: number;
  /** cone half-width in brads. */
  halfArc: number;
  damage: number;
}

/** Per-enemy threat entry: entityId -> threat value. */
export interface ThreatEntry {
  targetId: number;
  threat: number;
}

/** The boss's aggro/threat brain. FROZEN. */
export interface BossState {
  /** Threat table keyed by target entity id (sorted by id on write). */
  threat: ThreatEntry[];
  /** Currently selected target id, or -1 for idle. */
  targetId: number;
  /** Ticks until the next threat re-evaluation is allowed (<= once/second). */
  reevalCd: number;
  /** Ticks remaining of a forced taunt (overrides targeting instantly). */
  forcedTauntTicks: number;
  /** Forced taunt target id (valid while forcedTauntTicks > 0). */
  forcedTargetId: number;
  /** Current phase index (0-based). */
  phase: number;
  /** Ticks until the boss may start its next attack. */
  attackCd: number;
  /** Cursor into the boss pattern script (which attack comes next). */
  patternCursor: number;
}

/** Terminal states of a loop / the level. FROZEN. */
export type LoopOutcome = 'running' | 'won' | 'timeout';

/**
 * The root simulation state. FROZEN at M1: fully serializable, RNG lives here,
 * deterministic given (state, input). See docs/ARCHITECTURE.md.
 */
export interface SimState {
  /** Monotonic tick counter within the current loop (resets each loop). */
  tick: number;
  /** The seed the level was created from. Constant across a level's loops. */
  seed: number;
  /** Serializable PRNG state. */
  rng: RngState;

  /** Loop length in ticks (level-defined). */
  loopLength: number;
  /** The slot index currently being recorded live (0-based). */
  recordingSlot: number;
  /** Total number of slots this level has. */
  slotCount: number;
  /** Class assigned to each slot (index = slot). null = not yet chosen. */
  slotClasses: (ClassId | null)[];

  /** All live units this loop (player + echoes + boss), stable id order. */
  units: Unit[];
  /** Live projectiles. */
  projectiles: Projectile[];
  /** Active boss attacks/telegraphs. */
  attacks: BossAttack[];
  /** The boss brain. */
  boss: BossState;

  /** Next entity id to allocate (monotonic within a loop). */
  nextId: number;
  /** Loop outcome. */
  outcome: LoopOutcome;
  /** Entity id of the live player unit this loop (-1 if none). */
  playerId: number;

  // --- M2 additive fields ---
  /** Engineer turrets currently deployed. */
  turrets: Turret[];
  /** Interactable objects (Time Shards, levers) whose state anchors paradoxes. */
  interactables: Interactable[];
  /**
   * Paradox events raised this loop (contract 3.4), in occurrence order. Each
   * records the tick, the slot that turned paradox, the cause, and the position
   * for the floating text + timeline marker. Presentation reads these.
   */
  paradoxEvents: ParadoxEvent[];

  // --- M3 additive fields (enemy roster + objectives) ---
  /**
   * Objective the loop is judged by. 'boss' (default) wins when the boss dies;
   * 'survive' wins at loopLength if the protected core (if any) is alive;
   * 'heist' wins when all cores reach their goal zones; 'build' wins when every
   * build pad is completed. Content-authored; the sim reads it in step().
   */
  objective: SimObjective;
}

/**
 * A fixed interactable on the arena (contract 3.4): a pickup/lever whose state
 * is deterministic and whose recorded interaction is an anchor. When an echo's
 * recorded anchor can no longer happen (item already taken by an earlier slot,
 * lever already flipped) within +/-5 ticks, the echo turns paradox. M2 entity.
 */
export interface Interactable {
  id: number;
  /**
   * Stable index into the level's interactable list. Unlike `id` (re-allocated
   * each loop), this is identical across loops, so a recorded anchor can point
   * at the same conceptual object in a later, rewritten loop.
   */
  defIndex: number;
  kind: InteractableKind;
  x: number;
  y: number;
  radius: number;
  /** True once consumed/flipped this loop. Levers toggle; shards stay taken. */
  taken: boolean;
  /** Slot that took/flipped it this loop (-1 if none yet). */
  takenBySlot: number;
  /** Tick it was taken at (-1 if not yet). */
  takenAtTick: number;

  // --- M3 additive interactable fields (objective mechanics) ---
  /**
   * For a `plate`: true while a player-team unit stands on it (reacts to
   * presence, re-evaluated every tick). For a `door`: true while OPEN. For a
   * `buildpad`: true once BUILT. For a `core`: true while the core is intact.
   */
  active: boolean;
  /**
   * defIndex of a plate/lever this object is linked to (a `door` opens while
   * its linked plate is pressed or its linked lever is flipped). -1 = none.
   */
  linkedTo: number;
  /**
   * For a `core`: HP remaining (Protect-the-Core objective). For a `buildpad`:
   * build progress in ticks (fills while a unit stands on it, up to
   * `buildNeeded`). Ignored for other kinds.
   */
  hp: number;
  /** For a `buildpad`: ticks of standing needed to complete the build. */
  buildNeeded: number;
  /** For a `core`/heist goal: the target zone a carried core must reach. */
  goalX: number;
  goalY: number;
}

/**
 * Interactable kinds. `shard`/`lever` are the M2 anchor primitives. M3 adds the
 * objective-mechanics kinds additively:
 *   - plate:    a pressure plate that is `active` while a unit stands on it.
 *   - door:     a barrier that blocks movement while closed; opens when its
 *               linked plate/lever is active.
 *   - buildpad: an Engineer build pad; fills while stood on, then becomes a
 *               passable bridge tile (Build & Cross).
 *   - core:     a Time-Core: carried in a heist, or defended in Protect-the-Core.
 */
export type InteractableKind = 'shard' | 'lever' | 'plate' | 'door' | 'buildpad' | 'core';

/** Objective type simulated by the sim (win condition). M3 additive. FROZEN-compatible. */
export type SimObjective = 'boss' | 'survive' | 'heist' | 'build';

/** Why an echo became a paradox (for floating text + timeline markers). */
export type ParadoxCause = 'anchor-broken' | 'path-diverged';

/** A paradox event raised during a loop (presentation-only consumer). */
export interface ParadoxEvent {
  tick: number;
  slot: number;
  cause: ParadoxCause;
  /** Human-readable cause, e.g. "Key taken by Slot 3". */
  detail: string;
  x: number;
  y: number;
}

/**
 * The pure tick function contract: given the current state and the input for
 * this tick, return the NEXT state. Implementations must be pure with respect
 * to the outside world - the only entropy source is state.rng. FROZEN.
 *
 * The `input` is the LIVE player's input this tick. Echo inputs are read from
 * their recordings inside step().
 */
export type StepFn = (state: SimState, input: InputFrame) => SimState;
