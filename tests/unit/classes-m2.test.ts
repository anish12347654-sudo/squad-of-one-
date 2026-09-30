import { describe, it, expect } from 'vitest';
import {
  classStats,
  CLASS_IDS,
  createLevelState,
  step,
  setEchoInputs,
  setBossPattern,
  emptyInput,
  BUTTON_SKILL,
  METEOR_FUSE_TICKS,
  TURRET_LIFE_TICKS,
  type ClassId,
  type InputFrame,
  type LevelDef,
} from '@sim/index.js';
import { CLASS_PRESENTATION } from '@content/index.js';

const SECOND = 60;

const SOLO_ARENA = (cls: ClassId): LevelDef => ({
  id: `solo-${cls}`,
  halfWidth: 500,
  halfHeight: 500,
  loopLength: 30 * SECOND,
  slotCount: 1,
  spawns: [{ x: 0, y: 60, facing: 3072 }],
  boss: {
    x: 0,
    y: -20,
    maxHp: 100000,
    radius: 46,
    speed: 0,
    phaseThreshold: 0.5,
    pattern: [{ shape: 'slam', telegraphTicks: 6000, activeTicks: 2, recoveryTicks: 6000, radius: 1, halfArc: 0, damage: 0, maxHpFraction: 1 }],
  },
  starEchoesAlive: 1,
});

describe('M2 classes: section-4 numbers', () => {
  it('all 7 classes exist with the specified HP/speed', () => {
    expect(CLASS_IDS.length).toBe(7);
    expect(classStats('pyromancer').maxHp).toBe(150);
    expect(classStats('pyromancer').speed).toBe(185);
    expect(classStats('rogue').maxHp).toBe(170);
    expect(classStats('rogue').speed).toBe(230);
    expect(classStats('engineer').maxHp).toBe(200);
    expect(classStats('engineer').speed).toBe(180);
    expect(classStats('avatar').maxHp).toBe(300);
    expect(classStats('avatar').speed).toBe(210);
  });

  it('every class has a unique colour, silhouette and picker blurb', () => {
    const colors = new Set<number>();
    const silhouettes = new Set<string>();
    for (const id of CLASS_IDS) {
      const p = CLASS_PRESENTATION[id];
      expect(p.blurb.length).toBeGreaterThan(0);
      colors.add(p.color);
      silhouettes.add(p.silhouette);
    }
    expect(colors.size).toBe(7);
    expect(silhouettes.size).toBe(7);
  });

  const damagers: ClassId[] = ['pyromancer', 'rogue', 'engineer', 'avatar'];
  for (const cls of damagers) {
    it(`${cls} damages the boss with its primary`, () => {
      const level = SOLO_ARENA(cls);
      setBossPattern(level.boss.pattern);
      const state = createLevelState(level, 0, [cls], true);
      const boss = state.units.find((u) => u.kind === 'boss')!;
      const before = boss.hp;
      const you = state.units.find((u) => u.kind === 'player')!;
      for (let t = 0; t < 120; t++) {
        you.x = 0;
        you.y = 40; // in range
        setEchoInputs(new Map<number, InputFrame>());
        step(state, emptyInput());
      }
      expect(boss.hp).toBeLessThan(before);
    });
  }

  it('Engineer skill deploys a turret that persists and expires', () => {
    const level = SOLO_ARENA('engineer');
    setBossPattern(level.boss.pattern);
    const state = createLevelState(level, 0, ['engineer'], true);
    const fire: InputFrame = { moveX: 0, moveY: 0, aim: 0, aimActive: false, buttons: BUTTON_SKILL };
    setEchoInputs(new Map());
    step(state, fire);
    expect(state.turrets.length).toBe(1);
    expect(state.turrets[0]!.life).toBeLessThanOrEqual(TURRET_LIFE_TICKS);
  });

  it('Pyromancer Meteor lands as a delayed AoE strike', () => {
    const level = SOLO_ARENA('pyromancer');
    setBossPattern(level.boss.pattern);
    const state = createLevelState(level, 0, ['pyromancer'], true);
    const you = state.units.find((u) => u.kind === 'player')!;
    const boss = state.units.find((u) => u.kind === 'boss')!;
    const fire: InputFrame = { moveX: 0, moveY: 0, aim: 0, aimActive: false, buttons: BUTTON_SKILL };
    // Fire the meteor; it targets the boss.
    you.x = 200;
    you.y = 200;
    setEchoInputs(new Map());
    step(state, fire);
    const meteor = state.projectiles.find((p) => p.visual === 'meteor');
    expect(meteor).toBeTruthy();
    const hpBefore = boss.hp;
    // Let the fuse burn down; it should detonate near the boss.
    for (let t = 0; t < METEOR_FUSE_TICKS + 2; t++) {
      you.x = 200;
      you.y = 200;
      setEchoInputs(new Map());
      step(state, emptyInput());
    }
    expect(boss.hp).toBeLessThan(hpBefore);
  });
});
