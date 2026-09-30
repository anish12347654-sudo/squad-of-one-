import { describe, it, expect } from 'vitest';
import {
  createLevelState,
  step,
  setEchoInputs,
  setBossPattern,
  emptyInput,
  BUTTON_SKILL,
  CONVERGENCE_CHARGE,
  CONVERGE_PER_ECHO,
  AVATAR_DAMAGE_PER_ECHO,
  type InputFrame,
  type LevelDef,
} from '@sim/index.js';

const SECOND = 60;

/** A 3-slot arena so the Avatar (last slot) can have 2 alive echoes. */
const AV_ARENA: LevelDef = {
  id: 'avatar-arena',
  halfWidth: 500,
  halfHeight: 500,
  loopLength: 30 * SECOND,
  slotCount: 3,
  spawns: [
    { x: -80, y: 120, facing: 3072 },
    { x: 80, y: 120, facing: 3072 },
    { x: 0, y: 80, facing: 3072 },
  ],
  boss: {
    x: 0,
    y: -40,
    maxHp: 100000,
    radius: 46,
    speed: 0,
    phaseThreshold: 0.5,
    pattern: [
      { shape: 'slam', telegraphTicks: 6000, activeTicks: 2, recoveryTicks: 6000, radius: 1, halfArc: 0, damage: 0, maxHpFraction: 1 },
    ],
  },
  starEchoesAlive: 1,
};

describe('Avatar passive (contract 3.6)', () => {
  it('allyBuffCount tracks alive non-paradox echoes each tick', () => {
    setBossPattern(AV_ARENA.boss.pattern);
    // Live = slot 2 (Avatar); slots 0 & 1 are Guardian echoes.
    const state = createLevelState(AV_ARENA, 2, ['guardian', 'guardian', 'avatar'], true);
    setEchoInputs(new Map<number, InputFrame>());
    step(state, emptyInput());
    const avatar = state.units.find((u) => u.classId === 'avatar')!;
    expect(avatar.allyBuffCount).toBe(2);
    // Passive multiplier = 1 + 0.2 * echoes.
    expect(1 + AVATAR_DAMAGE_PER_ECHO * avatar.allyBuffCount).toBeCloseTo(1.4, 5);

    // Kill one echo; the count should drop to 1 next tick.
    const echo0 = state.units.find((u) => u.kind === 'echo' && u.slot === 0)!;
    echo0.alive = false;
    setEchoInputs(new Map());
    step(state, emptyInput());
    expect(avatar.allyBuffCount).toBe(1);
  });

  it('Avatar deals more boss damage with more alive echoes', () => {
    // With echoes.
    setBossPattern(AV_ARENA.boss.pattern);
    const withEchoes = createLevelState(AV_ARENA, 2, ['guardian', 'guardian', 'avatar'], true);
    // Without echoes: mark them dead before stepping.
    const noEchoes = createLevelState(AV_ARENA, 2, ['guardian', 'guardian', 'avatar'], true);
    for (const u of noEchoes.units) if (u.kind === 'echo') u.alive = false;

    const bossHp = (s: typeof withEchoes) => s.units.find((u) => u.kind === 'boss')!.hp;
    const before = AV_ARENA.boss.maxHp;

    // Place the avatar on the boss and let it whack for a while.
    for (const s of [withEchoes, noEchoes]) {
      const av = s.units.find((u) => u.classId === 'avatar')!;
      for (let t = 0; t < 120; t++) {
        av.x = 0;
        av.y = 30; // in melee range of boss at (0,-40)
        setEchoInputs(new Map());
        step(s, emptyInput());
      }
    }
    const dmgWith = before - bossHp(withEchoes);
    const dmgNo = before - bossHp(noEchoes);
    expect(dmgWith).toBeGreaterThan(dmgNo);
  });
});

describe('Avatar Convergence (contract 3.6)', () => {
  it('charges faster with more alive echoes', () => {
    setBossPattern(AV_ARENA.boss.pattern);
    const many = createLevelState(AV_ARENA, 2, ['guardian', 'guardian', 'avatar'], true);
    const none = createLevelState(AV_ARENA, 2, ['guardian', 'guardian', 'avatar'], true);
    for (const u of none.units) if (u.kind === 'echo') u.alive = false;

    for (const s of [many, none]) {
      for (let t = 0; t < 30; t++) {
        setEchoInputs(new Map());
        step(s, emptyInput());
      }
    }
    const chargeMany = many.units.find((u) => u.classId === 'avatar')!.convergeCharge;
    const chargeNone = none.units.find((u) => u.classId === 'avatar')!.convergeCharge;
    expect(chargeMany).toBeGreaterThan(chargeNone);
    // Per-tick rate with 2 echoes is 1 + 0.5*2 = 2x the base rate.
    expect(chargeMany).toBeCloseTo(chargeNone * (1 + CONVERGE_PER_ECHO * 2), 0);
  });

  it('fires synchronized beams from every alive echo when charged', () => {
    setBossPattern(AV_ARENA.boss.pattern);
    const state = createLevelState(AV_ARENA, 2, ['guardian', 'guardian', 'avatar'], true);
    const avatar = state.units.find((u) => u.classId === 'avatar')!;
    const boss = state.units.find((u) => u.kind === 'boss')!;
    // Move the avatar OUT of melee range so only the Convergence beam hits.
    avatar.x = 400;
    avatar.y = 400;
    // Pre-charge Convergence to full.
    avatar.convergeCharge = CONVERGENCE_CHARGE;
    const hpBefore = boss.hp;
    // Fire the skill (Convergence) then let it beam.
    const fire: InputFrame = { moveX: 0, moveY: 0, aim: 0, aimActive: false, buttons: BUTTON_SKILL };
    setEchoInputs(new Map());
    step(state, fire);
    for (let t = 0; t < 60; t++) {
      avatar.x = 400;
      avatar.y = 400;
      setEchoInputs(new Map());
      step(state, emptyInput());
    }
    // The boss took Convergence damage even though the avatar was far away.
    expect(boss.hp).toBeLessThan(hpBefore);
  });
});
