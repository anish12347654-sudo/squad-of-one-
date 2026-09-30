import { describe, it, expect } from 'vitest';
import {
  addDamageThreat,
  addHealThreat,
  applyTaunt,
  pickTarget,
  updateTargeting,
  maxThreat,
  THREAT_PER_DAMAGE,
  THREAT_PER_HEAL,
  TAUNT_THREAT_BONUS,
  REEVAL_TICKS,
} from '@sim/threat.js';
import type { BossState } from '@sim/types.js';

function makeBoss(): BossState {
  return {
    threat: [],
    targetId: -1,
    reevalCd: 0,
    forcedTauntTicks: 0,
    forcedTargetId: -1,
    phase: 0,
    attackCd: 0,
    patternCursor: 0,
  };
}

const allValid = () => true;

describe('threat rules (brief 3.3)', () => {
  it('adds 1 threat per point of damage', () => {
    const boss = makeBoss();
    addDamageThreat(boss, 5, 40);
    expect(maxThreat(boss)).toBe(40 * THREAT_PER_DAMAGE);
  });

  it('adds 0.5 threat per HP healed', () => {
    const boss = makeBoss();
    addHealThreat(boss, 7, 60);
    expect(maxThreat(boss)).toBeCloseTo(60 * THREAT_PER_HEAL, 6);
  });

  it('targets the highest positive threat', () => {
    const boss = makeBoss();
    addDamageThreat(boss, 2, 10);
    addDamageThreat(boss, 3, 50);
    addDamageThreat(boss, 4, 30);
    expect(pickTarget(boss, allValid)).toBe(3);
  });

  it('returns idle (-1) when nobody has positive threat', () => {
    const boss = makeBoss();
    expect(pickTarget(boss, allValid)).toBe(-1);
  });

  it('breaks ties to the lowest id', () => {
    const boss = makeBoss();
    addDamageThreat(boss, 9, 25);
    addDamageThreat(boss, 4, 25);
    addDamageThreat(boss, 6, 25);
    expect(pickTarget(boss, allValid)).toBe(4);
  });

  it('taunt sets the taunter to current max + bonus and forces the target', () => {
    const boss = makeBoss();
    addDamageThreat(boss, 3, 200); // max = 200
    applyTaunt(boss, 8, 240);
    expect(maxThreat(boss)).toBe(200 + TAUNT_THREAT_BONUS);
    expect(boss.forcedTargetId).toBe(8);
    expect(boss.targetId).toBe(8);
  });

  it('taunt overrides targeting instantly and holds for its duration', () => {
    const boss = makeBoss();
    addDamageThreat(boss, 3, 500); // 3 has far more threat
    applyTaunt(boss, 8, 3);
    // Even though 3 has higher base threat, the taunt forces 8 for 3 ticks.
    expect(updateTargeting(boss, allValid)).toBe(8);
    expect(updateTargeting(boss, allValid)).toBe(8);
    expect(updateTargeting(boss, allValid)).toBe(8);
    // After the taunt window the highest-threat (id 8 got max+100) still wins;
    // give 3 a bigger number to prove normal targeting resumed.
    addDamageThreat(boss, 3, 1000);
    boss.reevalCd = 0;
    expect(updateTargeting(boss, allValid)).toBe(3);
  });

  it('re-evaluates at most once per second', () => {
    const boss = makeBoss();
    addDamageThreat(boss, 2, 100);
    // First eval picks 2.
    expect(updateTargeting(boss, allValid)).toBe(2);
    expect(boss.reevalCd).toBe(REEVAL_TICKS);
    // A new higher-threat target appears, but re-eval is on cooldown.
    addDamageThreat(boss, 3, 500);
    for (let i = 0; i < REEVAL_TICKS - 1; i++) {
      expect(updateTargeting(boss, allValid)).toBe(2);
    }
    // Cooldown elapsed: now it re-evaluates to 3.
    expect(updateTargeting(boss, allValid)).toBe(3);
  });

  it('drops a dead target immediately regardless of cooldown', () => {
    const boss = makeBoss();
    addDamageThreat(boss, 2, 100);
    addDamageThreat(boss, 3, 50);
    expect(updateTargeting(boss, allValid)).toBe(2);
    // 2 dies; even with reevalCd active, targeting must switch to 3.
    const only3 = (id: number) => id === 3;
    expect(updateTargeting(boss, only3)).toBe(3);
  });
});
