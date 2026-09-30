/**
 * Level / arena definition consumed by the sim (brief section 3.1).
 *
 * FROZEN AT M1. A LevelDef is pure data supplied by src/content: it never
 * imports Phaser or the sim's mutable state. The sim uses it to build the
 * initial SimState for each loop. Spawn zones are chosen by content so they
 * never overlap hazards (there are none in M1) and slots start apart.
 */

import type { BossPatternStep } from './boss-pattern.js';
import type { EnemyKind, InteractableKind, SimObjective } from './types.js';

export interface SpawnPoint {
  x: number;
  y: number;
  /** Facing in brads at spawn. */
  facing: number;
}

export interface LevelDef {
  id: string;
  /** Arena half-width / half-height in units (centred on origin). */
  halfWidth: number;
  halfHeight: number;
  /** Loop length in ticks (default 1200 = 20 s @ 60 Hz; allowed 12-30 s). */
  loopLength: number;
  /** Number of recording slots. */
  slotCount: number;
  /** Slot spawn points (index = slot). */
  spawns: SpawnPoint[];
  /** Boss spawn + stats. */
  boss: {
    x: number;
    y: number;
    maxHp: number;
    radius: number;
    /** Movement speed toward its target in u/s. */
    speed: number;
    /** Phase-1 threshold as a fraction of max HP (e.g. 0.5). */
    phaseThreshold: number;
    /** The deterministic attack pattern script. */
    pattern: BossPatternStep[];
  };
  /** Stars: minimum echoes alive for the 2nd star. */
  starEchoesAlive: number;
  /**
   * Optional interactables (M2): Time Shards / levers whose recorded pickup is
   * an anchor for paradox detection (contract 3.4). Pure data; the sim spawns a
   * live Interactable per entry each loop. Omitted for M1 levels.
   */
  interactables?: LevelInteractable[];

  // --- M3 additive fields (enemy roster + objective mechanics) ---
  /**
   * Win condition for the loop. Defaults to 'boss' (win when the boss dies).
   * 'survive' = reach loopLength with the protected core alive (or simply
   * survive if there is no core); 'heist' = carry every core to its goal;
   * 'build' = complete every build pad. Omitting it keeps M1/M2 boss levels.
   */
  objective?: SimObjective;
  /** Non-boss enemy waves (brief section 5), spawned deterministically. */
  minions?: LevelMinion[];
}

/** A level-authored interactable placement (M2 + M3 objective mechanics). */
export interface LevelInteractable {
  kind: InteractableKind;
  x: number;
  y: number;
  radius: number;
  /**
   * defIndex this object links to (a `door` opens while its linked plate is
   * pressed / linked lever flipped). Index into the level's interactables list.
   */
  linkedTo?: number;
  /** For a `core`: HP (Protect) and/or the goal zone a carried core must reach. */
  hp?: number;
  goalX?: number;
  goalY?: number;
  /** For a `buildpad`: ticks of standing required to complete the build. */
  buildNeeded?: number;
}

/** A level-authored minion spawn (M3). Deterministic: fires at `spawnTick`. */
export interface LevelMinion {
  kind: EnemyKind;
  x: number;
  y: number;
  /** Tick within the loop at which this minion spawns (0 = at loop start). */
  spawnTick: number;
  maxHp: number;
  /** Movement speed (u/s). */
  speed: number;
  /** Contact / attack / explosion damage. */
  damage: number;
  /** For a `shielded` minion: frontal shield HP. */
  shieldHp?: number;
  /** For a `healer` minion: heal-per-tick applied to wounded enemies. */
  healPower?: number;
  /** For a heist `core` carrier: the core defIndex it should ferry. */
  carryCore?: number;
}
