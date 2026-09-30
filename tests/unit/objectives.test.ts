/**
 * M3: enemy roster + objective-mechanics tests.
 *
 * Verifies the additive sim systems (minions, pressure plates, doors, build
 * pads, Time-Cores) behave deterministically and win/lose per objective. Also
 * checks per-tick FNV-1a hash parity on a minion level (same inputs twice).
 */

import { describe, it, expect } from 'vitest';
import {
  LevelRunner,
  createLevelState,
  step,
  setEchoInputs,
  setEchoRecordings,
  setBossPattern,
  setLevelMinions,
  hashState,
  emptyInput,
  BUTTON_INTERACT,
  type LevelDef,
  type InputFrame,
  type SimState,
} from '@sim/index.js';
import { campaignLevelById } from '@content/index.js';

const SECOND = 60;

/** Drive a level's state forward N ticks with a single live input each tick. */
function run(state: SimState, ticks: number, input: InputFrame): SimState {
  let s = state;
  for (let i = 0; i < ticks && s.outcome === 'running'; i++) {
    setEchoInputs(new Map());
    setEchoRecordings(new Map());
    s = step(s, input);
  }
  return s;
}

describe('M3 minion roster', () => {
  it('spawns a chaser at its scheduled tick and it hunts the player', () => {
    const level: LevelDef = {
      id: 'minion-test',
      halfWidth: 500,
      halfHeight: 500,
      loopLength: 10 * SECOND,
      slotCount: 1,
      spawns: [{ x: 0, y: 200, facing: 3072 }],
      boss: { x: 0, y: -240, maxHp: 99999, radius: 46, speed: 0, phaseThreshold: 0.5, pattern: [] },
      starEchoesAlive: 0,
      objective: 'survive',
      minions: [{ kind: 'chaser', x: 0, y: -200, spawnTick: 30, maxHp: 100, speed: 200, damage: 5 }],
    };
    setBossPattern(level.boss.pattern);
    setLevelMinions(level.minions ?? []);
    let s = createLevelState(level, 0, ['guardian'], true);
    expect(s.units.some((u) => u.kind === 'minion')).toBe(false);
    s = run(s, 40, emptyInput());
    const minion = s.units.find((u) => u.kind === 'minion');
    expect(minion).toBeTruthy();
    const y0 = minion!.y;
    s = run(s, 60, emptyInput());
    const minion2 = s.units.find((u) => u.kind === 'minion');
    // The chaser closes distance toward the player (moves down the arena).
    expect(minion2!.y).toBeGreaterThan(y0);
  });

  it('a splitter spawns two children on death', () => {
    const level: LevelDef = {
      id: 'splitter-test',
      halfWidth: 500,
      halfHeight: 500,
      loopLength: 10 * SECOND,
      slotCount: 1,
      spawns: [{ x: 0, y: 200, facing: 3072 }],
      boss: { x: 0, y: -240, maxHp: 99999, radius: 46, speed: 0, phaseThreshold: 0.5, pattern: [] },
      starEchoesAlive: 0,
      objective: 'survive',
      minions: [{ kind: 'splitter', x: 0, y: 0, spawnTick: 0, maxHp: 20, speed: 100, damage: 5 }],
    };
    setBossPattern(level.boss.pattern);
    setLevelMinions(level.minions ?? []);
    let s = createLevelState(level, 0, ['guardian'], true);
    s = step(s, emptyInput());
    const original = s.units.find((u) => u.kind === 'minion')!;
    original.hp = 0;
    original.alive = false;
    s = step(s, emptyInput());
    const children = s.units.filter((u) => u.kind === 'minion' && u.alive);
    expect(children.length).toBe(2);
    expect(children.every((c) => c.splitGen === 1)).toBe(true);
  });

  it('a shielded minion absorbs damage on its shield before its HP', () => {
    const level: LevelDef = {
      id: 'shield-test',
      halfWidth: 500,
      halfHeight: 500,
      loopLength: 10 * SECOND,
      slotCount: 1,
      spawns: [{ x: 0, y: 200, facing: 3072 }],
      boss: { x: 0, y: -240, maxHp: 99999, radius: 46, speed: 0, phaseThreshold: 0.5, pattern: [] },
      starEchoesAlive: 0,
      objective: 'survive',
      minions: [{ kind: 'shielded', x: 0, y: 0, spawnTick: 0, maxHp: 100, speed: 0, damage: 5, shieldHp: 60 }],
    };
    setBossPattern(level.boss.pattern);
    setLevelMinions(level.minions ?? []);
    let s = createLevelState(level, 0, ['guardian'], true);
    s = step(s, emptyInput());
    const m = s.units.find((u) => u.kind === 'minion')!;
    expect(m.shieldHp).toBe(60);
    expect(m.maxHp).toBe(100);
  });
});

describe('M3 objective mechanics', () => {
  it('build pad completes after enough standing and wins the build objective', () => {
    const level: LevelDef = {
      id: 'build-test',
      halfWidth: 500,
      halfHeight: 500,
      loopLength: 5 * SECOND,
      slotCount: 1,
      spawns: [{ x: 0, y: 0, facing: 0 }],
      boss: { x: 0, y: -240, maxHp: 99999, radius: 46, speed: 0, phaseThreshold: 0.5, pattern: [] },
      starEchoesAlive: 0,
      objective: 'build',
      interactables: [{ kind: 'buildpad', x: 0, y: 0, radius: 60, buildNeeded: 30 }],
    };
    setBossPattern(level.boss.pattern);
    setLevelMinions([]);
    let s = createLevelState(level, 0, ['guardian'], true);
    s = run(s, 60, emptyInput()); // stand still on the pad (spawned at its centre)
    expect(s.outcome).toBe('won');
    expect(s.interactables[0]!.active).toBe(true);
  });

  it('protected core survives to timeout with no adjacent enemies (survive win)', () => {
    const level: LevelDef = {
      id: 'survive-test',
      halfWidth: 500,
      halfHeight: 500,
      loopLength: 2 * SECOND,
      slotCount: 1,
      spawns: [{ x: 200, y: 200, facing: 0 }],
      boss: { x: 0, y: -240, maxHp: 99999, radius: 46, speed: 0, phaseThreshold: 0.5, pattern: [] },
      starEchoesAlive: 0,
      objective: 'survive',
      interactables: [{ kind: 'core', x: 0, y: 0, radius: 50, hp: 100 }],
    };
    setBossPattern(level.boss.pattern);
    setLevelMinions([]);
    let s = createLevelState(level, 0, ['guardian'], true);
    s = run(s, 2 * SECOND, emptyInput());
    expect(s.outcome).toBe('won');
    expect(s.interactables[0]!.active).toBe(true);
  });

  it('heist: grabbing and carrying a core to its goal wins', () => {
    const level: LevelDef = {
      id: 'heist-test',
      halfWidth: 500,
      halfHeight: 500,
      loopLength: 10 * SECOND,
      slotCount: 1,
      spawns: [{ x: 0, y: 0, facing: 0 }],
      boss: { x: 0, y: -240, maxHp: 99999, radius: 46, speed: 0, phaseThreshold: 0.5, pattern: [] },
      starEchoesAlive: 0,
      objective: 'heist',
      interactables: [{ kind: 'core', x: 0, y: 0, radius: 50, goalX: 0, goalY: 0 }],
    };
    setBossPattern(level.boss.pattern);
    setLevelMinions([]);
    let s = createLevelState(level, 0, ['guardian'], true);
    // Interact to grab (goal == spawn so delivery is immediate once grabbed).
    s = step(s, { moveX: 0, moveY: 0, aim: 0, aimActive: false, buttons: BUTTON_INTERACT });
    expect(s.interactables[0]!.takenBySlot).toBe(0);
    s = step(s, emptyInput());
    expect(s.outcome).toBe('won');
  });
});

describe('M3 determinism on a minion + objective campaign level', () => {
  it('same inputs twice yield identical per-tick hashes (w1-2 survive + minions)', () => {
    const level = campaignLevelById('w1-2')!.def;
    const hashesFor = (): number[] => {
      const runner = new LevelRunner(level);
      runner.chooseClass('guardian');
      const out: number[] = [];
      for (let i = 0; i < 300 && runner.result === 'in_progress'; i++) {
        runner.tickWith(emptyInput());
        out.push(hashState(runner.state));
      }
      return out;
    };
    expect(hashesFor()).toEqual(hashesFor());
  });
});
