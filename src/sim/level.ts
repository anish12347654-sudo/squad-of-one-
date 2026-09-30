/**
 * Level / arena definition consumed by the sim (brief section 3.1).
 *
 * FROZEN AT M1. A LevelDef is pure data supplied by src/content: it never
 * imports Phaser or the sim's mutable state. The sim uses it to build the
 * initial SimState for each loop. Spawn zones are chosen by content so they
 * never overlap hazards (there are none in M1) and slots start apart.
 */

import type { BossPatternStep } from './boss-pattern.js';

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
}
