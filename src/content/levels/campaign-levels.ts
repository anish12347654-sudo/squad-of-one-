/**
 * The 19 handcrafted campaign levels (brief section 5) as typed data built on
 * the frozen sim API. Tutorial x3 -> World 1 (4 + boss) -> World 2 (4 + boss)
 * -> World 3 (4 + boss) -> Final boss. Each follows the unlock ramp and its
 * boss HP is tuned (see scripts/calibrate.ts) so the reference solution plan
 * wins with >= 1 star, with the first three levels comfortably first-time
 * winnable.
 *
 * Boss HP resets every loop while the squad grows, so early loops reach only
 * phase 1 and later loops reveal later phases: patterns gate their heavier
 * attacks behind `maxHpFraction` so the discovery curve is real.
 *
 * Bosses (distinct pattern scripts):
 *   - Pendulum Knight (W1): metronomic sweeps + charges (teaches tank + heal).
 *   - Mirage Djinn (W2): fast cones + summon-style bullet pressure (illusions).
 *   - Stasis Wyrm (W3): wide slams that punish clustered echoes (freeze pressure).
 *   - The Unwinder (final): all shapes, dense late phases (learnable counter-play).
 *
 * Objective type is campaign metadata for presentation + tutorials. The heist /
 * build / survive variants are authored on top of the same sim using the shard
 * interactable + a survival win condition where the sim supports it; the boss
 * objective is the fully-simulated fight.
 */

import type {
  LevelDef,
  BossPatternStep,
  ClassId,
  LevelMinion,
  LevelInteractable,
  SimObjective,
} from '@sim/index.js';
import type { CampaignLevel } from '../campaign.js';

const SECOND = 60;
const R = Math.round;

// ---------------------------------------------------------------------------
// Boss pattern scripts (one per boss archetype)
// ---------------------------------------------------------------------------

/** Light teaching pattern for non-boss levels (slam + cone, gentle timings). */
function teachingPattern(dmg: number): BossPatternStep[] {
  return [
    { shape: 'slam', telegraphTicks: R(1.0 * SECOND), activeTicks: 6, recoveryTicks: R(0.9 * SECOND), radius: 130, halfArc: 0, damage: dmg, maxHpFraction: 1 },
    { shape: 'cone', telegraphTicks: R(0.9 * SECOND), activeTicks: 6, recoveryTicks: R(0.8 * SECOND), radius: 250, halfArc: 620, damage: R(dmg * 0.8), maxHpFraction: 1 },
  ];
}

/** Pendulum Knight: metronomic sweeps then a phase-2 charge. */
const PENDULUM_KNIGHT: BossPatternStep[] = [
  { shape: 'cone', telegraphTicks: R(0.85 * SECOND), activeTicks: 6, recoveryTicks: R(0.55 * SECOND), radius: 280, halfArc: 720, damage: 22, maxHpFraction: 1 },
  { shape: 'slam', telegraphTicks: R(0.8 * SECOND), activeTicks: 6, recoveryTicks: R(0.6 * SECOND), radius: 140, halfArc: 0, damage: 26, maxHpFraction: 1 },
  { shape: 'charge', telegraphTicks: R(0.7 * SECOND), activeTicks: 8, recoveryTicks: R(0.7 * SECOND), radius: 640, halfArc: 64, damage: 30, maxHpFraction: 0.6 },
  { shape: 'cone', telegraphTicks: R(0.6 * SECOND), activeTicks: 6, recoveryTicks: R(0.5 * SECOND), radius: 300, halfArc: 900, damage: 26, maxHpFraction: 0.35 },
];

/** Mirage Djinn: fast cones + a phase-2 double charge (darting illusions). */
const MIRAGE_DJINN: BossPatternStep[] = [
  { shape: 'cone', telegraphTicks: R(0.7 * SECOND), activeTicks: 5, recoveryTicks: R(0.45 * SECOND), radius: 260, halfArc: 560, damage: 20, maxHpFraction: 1 },
  { shape: 'charge', telegraphTicks: R(0.6 * SECOND), activeTicks: 7, recoveryTicks: R(0.5 * SECOND), radius: 620, halfArc: 58, damage: 26, maxHpFraction: 1 },
  { shape: 'slam', telegraphTicks: R(0.7 * SECOND), activeTicks: 6, recoveryTicks: R(0.5 * SECOND), radius: 150, halfArc: 0, damage: 24, maxHpFraction: 0.6 },
  { shape: 'charge', telegraphTicks: R(0.5 * SECOND), activeTicks: 7, recoveryTicks: R(0.45 * SECOND), radius: 640, halfArc: 66, damage: 30, maxHpFraction: 0.35 },
];

/** Stasis Wyrm: wide slams punishing clustered echoes (freeze pressure). */
const STASIS_WYRM: BossPatternStep[] = [
  { shape: 'slam', telegraphTicks: R(0.9 * SECOND), activeTicks: 8, recoveryTicks: R(0.6 * SECOND), radius: 190, halfArc: 0, damage: 24, maxHpFraction: 1 },
  { shape: 'cone', telegraphTicks: R(0.8 * SECOND), activeTicks: 6, recoveryTicks: R(0.55 * SECOND), radius: 300, halfArc: 820, damage: 22, maxHpFraction: 1 },
  { shape: 'slam', telegraphTicks: R(0.7 * SECOND), activeTicks: 8, recoveryTicks: R(0.55 * SECOND), radius: 230, halfArc: 0, damage: 30, maxHpFraction: 0.6 },
  { shape: 'charge', telegraphTicks: R(0.6 * SECOND), activeTicks: 8, recoveryTicks: R(0.5 * SECOND), radius: 660, halfArc: 70, damage: 32, maxHpFraction: 0.3 },
];

/** The Unwinder: every shape, dense late phases; learnable, telegraphed. */
const THE_UNWINDER: BossPatternStep[] = [
  { shape: 'cone', telegraphTicks: R(0.75 * SECOND), activeTicks: 6, recoveryTicks: R(0.45 * SECOND), radius: 290, halfArc: 700, damage: 22, maxHpFraction: 1 },
  { shape: 'slam', telegraphTicks: R(0.75 * SECOND), activeTicks: 7, recoveryTicks: R(0.45 * SECOND), radius: 170, halfArc: 0, damage: 26, maxHpFraction: 1 },
  { shape: 'charge', telegraphTicks: R(0.6 * SECOND), activeTicks: 8, recoveryTicks: R(0.45 * SECOND), radius: 660, halfArc: 66, damage: 30, maxHpFraction: 0.7 },
  { shape: 'slam', telegraphTicks: R(0.6 * SECOND), activeTicks: 7, recoveryTicks: R(0.4 * SECOND), radius: 210, halfArc: 0, damage: 32, maxHpFraction: 0.45 },
  { shape: 'cone', telegraphTicks: R(0.5 * SECOND), activeTicks: 6, recoveryTicks: R(0.4 * SECOND), radius: 320, halfArc: 1000, damage: 30, maxHpFraction: 0.25 },
];

// ---------------------------------------------------------------------------
// Spawn helpers - a fan of points along the bottom, apart from each other and
// clear of the boss (top-centre) and any interactables (mid-arena).
// ---------------------------------------------------------------------------

const FAN_X = [-320, -200, -80, 80, 200, 320, 0];
function fanSpawns(n: number): LevelDef['spawns'] {
  const out: LevelDef['spawns'] = [];
  for (let i = 0; i < n; i++) {
    const last = i === n - 1;
    out.push({ x: FAN_X[i]!, y: last ? 250 : 320, facing: 3072 });
  }
  return out;
}

interface BossLevelConfig {
  id: string;
  slotCount: number;
  maxHp: number;
  pattern: BossPatternStep[];
  starEchoesAlive: number;
  interactables?: LevelInteractable[];
  loopSeconds?: number;
  bossSpeed?: number;
  objective?: SimObjective;
  minions?: LevelMinion[];
}

function bossLevel(cfg: BossLevelConfig): LevelDef {
  return {
    id: cfg.id,
    halfWidth: 520,
    halfHeight: 520,
    loopLength: (cfg.loopSeconds ?? 20) * SECOND,
    slotCount: cfg.slotCount,
    spawns: fanSpawns(cfg.slotCount),
    boss: {
      x: 0,
      y: -240,
      maxHp: cfg.maxHp,
      radius: 46,
      speed: cfg.bossSpeed ?? 90,
      phaseThreshold: 0.5,
      pattern: cfg.pattern,
    },
    starEchoesAlive: cfg.starEchoesAlive,
    ...(cfg.objective ? { objective: cfg.objective } : {}),
    ...(cfg.interactables ? { interactables: cfg.interactables } : {}),
    ...(cfg.minions ? { minions: cfg.minions } : {}),
  };
}

// ---------------------------------------------------------------------------
// M3 minion wave helpers (deterministic spawn schedules per objective).
// ---------------------------------------------------------------------------

/** A staggered wave of one minion archetype from the top of the arena. */
function wave(
  kind: LevelMinion['kind'],
  count: number,
  opts: { hp: number; speed: number; damage: number; first: number; gap: number; shieldHp?: number; healPower?: number },
): LevelMinion[] {
  const out: LevelMinion[] = [];
  for (let i = 0; i < count; i++) {
    const x = count === 1 ? 0 : -220 + (440 / (count - 1)) * i;
    out.push({
      kind,
      x: R(x),
      y: -160,
      spawnTick: opts.first + i * opts.gap,
      maxHp: opts.hp,
      speed: opts.speed,
      damage: opts.damage,
      ...(opts.shieldHp !== undefined ? { shieldHp: opts.shieldHp } : {}),
      ...(opts.healPower !== undefined ? { healPower: opts.healPower } : {}),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reference solution plans (proven by scripts/record-solutions.ts).
// ---------------------------------------------------------------------------

const P2: ClassId[] = ['guardian', 'ranger'];
const P3: ClassId[] = ['guardian', 'ranger', 'rogue'];
const P4: ClassId[] = ['guardian', 'ranger', 'rogue', 'pyromancer'];
const P5: ClassId[] = ['guardian', 'ranger', 'rogue', 'pyromancer', 'avatar'];
const P6: ClassId[] = ['guardian', 'ranger', 'rogue', 'pyromancer', 'engineer', 'avatar'];
const P7: ClassId[] = ['guardian', 'ranger', 'rogue', 'pyromancer', 'engineer', 'medic', 'avatar'];

// ===========================================================================
// The 19 levels
// ===========================================================================

export const CAMPAIGN_LEVELS: readonly CampaignLevel[] = [
  // --- Tutorial (3): first three must be first-time winnable ---
  {
    id: 'tut-1', worldId: 'tutorial', nameKey: 'level.name.tut1', objective: 'boss',
    def: bossLevel({ id: 'tut-1', slotCount: 2, maxHp: 700, pattern: teachingPattern(16), starEchoesAlive: 1 }),
    unlocks: ['ranger', 'guardian'],
    storyKeys: ['story.tutorial.1.a', 'story.tutorial.1.b'],
    tutorialKey: 'tutorial.echo', solutionPlan: P2, starMax: 3,
  },
  {
    id: 'tut-2', worldId: 'tutorial', nameKey: 'level.name.tut2', objective: 'boss',
    def: bossLevel({ id: 'tut-2', slotCount: 3, maxHp: 1400, pattern: teachingPattern(18), starEchoesAlive: 1 }),
    unlocks: ['medic'],
    storyKeys: ['story.tutorial.2.a'],
    tutorialKey: 'tutorial.roles', solutionPlan: P3, starMax: 3,
  },
  {
    id: 'tut-3', worldId: 'tutorial', nameKey: 'level.name.tut3', objective: 'heist',
    def: bossLevel({
      id: 'tut-3', slotCount: 4, maxHp: 2400, pattern: teachingPattern(14), starEchoesAlive: 1,
      objective: 'heist', loopSeconds: 22,
      // Grab the core (index 0), carry it to its goal near the bottom.
      interactables: [
        { kind: 'core', x: 0, y: -40, radius: 46, goalX: 0, goalY: 300 },
        { kind: 'shard', x: -170, y: 60, radius: 44 },
      ],
    }),
    unlocks: ['rogue'],
    storyKeys: ['story.tutorial.3.a'],
    tutorialKey: 'tutorial.paradox', solutionPlan: P4, starMax: 3,
  },

  // --- World 1: Shattered Clocktower (4 levels + Pendulum Knight) ---
  {
    id: 'w1-1', worldId: 'world1', nameKey: 'level.name.w1_1', objective: 'boss',
    def: bossLevel({ id: 'w1-1', slotCount: 3, maxHp: 2000, pattern: teachingPattern(20), starEchoesAlive: 1 }),
    unlocks: [], storyKeys: ['story.world1.a'], tutorialKey: null, solutionPlan: P3, starMax: 3,
  },
  {
    id: 'w1-2', worldId: 'world1', nameKey: 'level.name.w1_2', objective: 'survive',
    def: bossLevel({
      id: 'w1-2', slotCount: 4, maxHp: 3200, pattern: PENDULUM_KNIGHT, starEchoesAlive: 2,
      objective: 'survive', loopSeconds: 18,
      interactables: [{ kind: 'core', x: 0, y: 120, radius: 52, hp: 900 }],
      minions: [
        ...wave('chaser', 2, { hp: 90, speed: 130, damage: 8, first: 90, gap: 40 }),
        ...wave('chaser', 3, { hp: 90, speed: 130, damage: 8, first: 420, gap: 45 }),
        ...wave('caster', 1, { hp: 70, speed: 90, damage: 10, first: 600, gap: 0 }),
      ],
    }),
    unlocks: [], storyKeys: [], tutorialKey: 'tutorial.survive', solutionPlan: P4, starMax: 3,
  },
  {
    id: 'w1-3', worldId: 'world1', nameKey: 'level.name.w1_3', objective: 'heist',
    def: bossLevel({
      id: 'w1-3', slotCount: 4, maxHp: 3400, pattern: PENDULUM_KNIGHT, starEchoesAlive: 2,
      objective: 'heist', loopSeconds: 24,
      // 0 core -> goal top; 1 plate (hold to open) -> 2 door on the path.
      interactables: [
        { kind: 'core', x: -200, y: 120, radius: 46, goalX: 260, goalY: 120 },
        { kind: 'plate', x: -40, y: 260, radius: 50 },
        { kind: 'door', x: 90, y: 120, radius: 60, linkedTo: 1 },
      ],
    }),
    unlocks: [], storyKeys: [], tutorialKey: 'tutorial.plates', solutionPlan: P4, starMax: 3,
  },
  {
    id: 'w1-4', worldId: 'world1', nameKey: 'level.name.w1_4', objective: 'boss',
    def: bossLevel({ id: 'w1-4', slotCount: 5, maxHp: 8200, pattern: PENDULUM_KNIGHT, starEchoesAlive: 2 }),
    unlocks: ['avatar'], storyKeys: [], tutorialKey: 'tutorial.avatar', solutionPlan: P5, starMax: 3,
  },
  {
    id: 'w1-boss', worldId: 'world1', nameKey: 'level.name.w1_boss', objective: 'boss',
    def: bossLevel({ id: 'w1-boss', slotCount: 5, maxHp: 9600, pattern: PENDULUM_KNIGHT, starEchoesAlive: 2 }),
    unlocks: [], storyKeys: ['story.world1.a'], tutorialKey: null, solutionPlan: P5, starMax: 3,
  },

  // --- World 2: Bazaar of Hours (4 levels + Mirage Djinn) ---
  {
    id: 'w2-1', worldId: 'world2', nameKey: 'level.name.w2_1', objective: 'boss',
    def: bossLevel({ id: 'w2-1', slotCount: 4, maxHp: 2900, pattern: MIRAGE_DJINN, starEchoesAlive: 2 }),
    unlocks: ['pyromancer'], storyKeys: ['story.world2.a'], tutorialKey: 'tutorial.pyromancer', solutionPlan: P4, starMax: 3,
  },
  {
    id: 'w2-2', worldId: 'world2', nameKey: 'level.name.w2_2', objective: 'survive',
    def: bossLevel({
      id: 'w2-2', slotCount: 5, maxHp: 8600, pattern: MIRAGE_DJINN, starEchoesAlive: 2,
      objective: 'survive', loopSeconds: 20,
      interactables: [{ kind: 'core', x: 0, y: 120, radius: 52, hp: 1100 }],
      minions: [
        ...wave('chaser', 3, { hp: 100, speed: 140, damage: 9, first: 90, gap: 35 }),
        ...wave('bomber', 2, { hp: 70, speed: 120, damage: 22, first: 420, gap: 60 }),
        ...wave('chaser', 3, { hp: 110, speed: 140, damage: 9, first: 720, gap: 35 }),
      ],
    }),
    unlocks: [], storyKeys: [], tutorialKey: null, solutionPlan: P5, starMax: 3,
  },
  {
    id: 'w2-3', worldId: 'world2', nameKey: 'level.name.w2_3', objective: 'heist',
    def: bossLevel({
      id: 'w2-3', slotCount: 5, maxHp: 8800, pattern: MIRAGE_DJINN, starEchoesAlive: 2,
      objective: 'heist', loopSeconds: 24,
      // Two cores to two goals; a plate-gated door blocks the right lane.
      interactables: [
        { kind: 'core', x: -220, y: 40, radius: 44, goalX: -220, goalY: 300 },
        { kind: 'core', x: 220, y: 40, radius: 44, goalX: 220, goalY: 300 },
        { kind: 'plate', x: 0, y: 240, radius: 50 },
        { kind: 'door', x: 220, y: 150, radius: 60, linkedTo: 2 },
      ],
    }),
    unlocks: [], storyKeys: [], tutorialKey: null, solutionPlan: P5, starMax: 3,
  },
  {
    id: 'w2-4', worldId: 'world2', nameKey: 'level.name.w2_4', objective: 'boss',
    def: bossLevel({ id: 'w2-4', slotCount: 6, maxHp: 11000, pattern: MIRAGE_DJINN, starEchoesAlive: 3 }),
    unlocks: [], storyKeys: [], tutorialKey: null, solutionPlan: P6, starMax: 3,
  },
  {
    id: 'w2-boss', worldId: 'world2', nameKey: 'level.name.w2_boss', objective: 'boss',
    def: bossLevel({ id: 'w2-boss', slotCount: 6, maxHp: 11000, pattern: MIRAGE_DJINN, starEchoesAlive: 3 }),
    unlocks: [], storyKeys: ['story.world2.a'], tutorialKey: null, solutionPlan: P6, starMax: 3,
  },

  // --- World 3: Frozen Second (4 levels + Stasis Wyrm) ---
  {
    id: 'w3-1', worldId: 'world3', nameKey: 'level.name.w3_1', objective: 'boss',
    def: bossLevel({ id: 'w3-1', slotCount: 5, maxHp: 8400, pattern: STASIS_WYRM, starEchoesAlive: 2 }),
    unlocks: ['engineer'], storyKeys: ['story.world3.a'], tutorialKey: 'tutorial.engineer', solutionPlan: P5, starMax: 3,
  },
  {
    id: 'w3-2', worldId: 'world3', nameKey: 'level.name.w3_2', objective: 'build',
    def: bossLevel({
      id: 'w3-2', slotCount: 6, maxHp: 11200, pattern: STASIS_WYRM, starEchoesAlive: 3,
      objective: 'build', loopSeconds: 22,
      // Three build pads to complete (Engineer / anyone stands on them).
      interactables: [
        { kind: 'buildpad', x: -180, y: 40, radius: 50, buildNeeded: R(2.2 * SECOND) },
        { kind: 'buildpad', x: 0, y: 120, radius: 50, buildNeeded: R(2.2 * SECOND) },
        { kind: 'buildpad', x: 180, y: 40, radius: 50, buildNeeded: R(2.2 * SECOND) },
      ],
      minions: [
        ...wave('chaser', 2, { hp: 120, speed: 125, damage: 10, first: 180, gap: 60 }),
        ...wave('chaser', 2, { hp: 120, speed: 125, damage: 10, first: 600, gap: 60 }),
      ],
    }),
    unlocks: [], storyKeys: [], tutorialKey: 'tutorial.build', solutionPlan: P6, starMax: 3,
  },
  {
    id: 'w3-3', worldId: 'world3', nameKey: 'level.name.w3_3', objective: 'heist',
    def: bossLevel({
      id: 'w3-3', slotCount: 6, maxHp: 11600, pattern: STASIS_WYRM, starEchoesAlive: 3,
      objective: 'heist', loopSeconds: 26,
      interactables: [
        { kind: 'core', x: -200, y: 40, radius: 44, goalX: 240, goalY: 260 },
        { kind: 'plate', x: -60, y: 260, radius: 50 },
        { kind: 'door', x: 100, y: 160, radius: 60, linkedTo: 1 },
      ],
      minions: [...wave('shielded', 2, { hp: 160, speed: 110, damage: 12, first: 240, gap: 120, shieldHp: 80 })],
    }),
    unlocks: [], storyKeys: [], tutorialKey: null, solutionPlan: P6, starMax: 3,
  },
  {
    id: 'w3-4', worldId: 'world3', nameKey: 'level.name.w3_4', objective: 'boss',
    def: bossLevel({ id: 'w3-4', slotCount: 7, maxHp: 13000, pattern: STASIS_WYRM, starEchoesAlive: 3 }),
    unlocks: [], storyKeys: [], tutorialKey: null, solutionPlan: P7, starMax: 3,
  },
  {
    id: 'w3-boss', worldId: 'world3', nameKey: 'level.name.w3_boss', objective: 'boss',
    def: bossLevel({ id: 'w3-boss', slotCount: 7, maxHp: 12400, pattern: STASIS_WYRM, starEchoesAlive: 3 }),
    unlocks: [], storyKeys: ['story.world3.a'], tutorialKey: null, solutionPlan: P7, starMax: 3,
  },

  // --- Final boss: The Unwinder ---
  {
    id: 'final', worldId: 'final', nameKey: 'level.name.final', objective: 'boss',
    def: bossLevel({ id: 'final', slotCount: 7, maxHp: 11800, pattern: THE_UNWINDER, starEchoesAlive: 3,
      interactables: [{ kind: 'shard', x: -160, y: 20, radius: 42 }, { kind: 'shard', x: 160, y: 20, radius: 42 }] }),
    unlocks: [], storyKeys: ['story.final.a'], tutorialKey: 'tutorial.unwinder', solutionPlan: P7, starMax: 3,
  },
];

/** Lookup a campaign level by id. */
export function campaignLevelById(id: string): CampaignLevel | undefined {
  return CAMPAIGN_LEVELS.find((l) => l.id === id);
}

/** All 19 level ids in campaign order. */
export const CAMPAIGN_LEVEL_IDS: readonly string[] = CAMPAIGN_LEVELS.map((l) => l.id);
