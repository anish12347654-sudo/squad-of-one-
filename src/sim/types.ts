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

/** The three M1 classes. String union so content data reads clearly. FROZEN. */
export type ClassId = 'guardian' | 'medic' | 'ranger';

/** Kind discriminator for entities. FROZEN (later kinds are additive). */
export type EntityKind = 'player' | 'echo' | 'boss' | 'projectile';

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
  /** Ticks remaining while this unit is a forced taunt target (boss-side use). */
  tauntTicks: number;
  /** Ticks remaining of the Medic Sanctuary damage-reduction buff on this unit. */
  sanctuaryTicks: number;
  /** Ticks remaining charging the Ranger Piercing Shot (0 = not charging). */
  chargeTicks: number;
}

/** A lightweight projectile (arrows, etc.). FROZEN. */
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
