import { describe, it, expect } from 'vitest';
import {
  resolveDaily,
  seedFromDateKey,
  scoreDaily,
  DAILY_SCORE,
  MODIFIERS,
  applyModifiers,
  contentHash,
  hashLevelDef,
  campaignLevelById,
} from '@content/index.js';

describe('daily seed', () => {
  it('is deterministic for a date key and differs across dates', () => {
    expect(seedFromDateKey('2025-01-01')).toBe(seedFromDateKey('2025-01-01'));
    expect(seedFromDateKey('2025-01-01')).not.toBe(seedFromDateKey('2025-01-02'));
  });
});

describe('daily challenge selection', () => {
  it('picks the same level + two distinct modifiers for a given date', () => {
    const a = resolveDaily('2025-03-14');
    const b = resolveDaily('2025-03-14');
    expect(b.seed).toBe(a.seed);
    expect(b.levelId).toBe(a.levelId);
    expect(b.modifiers.map((m) => m.id)).toEqual(a.modifiers.map((m) => m.id));
    // Exactly two, distinct.
    expect(a.modifiers.length).toBe(2);
    expect(a.modifiers[0]!.id).not.toBe(a.modifiers[1]!.id);
  });

  it('resolves to a real campaign level', () => {
    for (const key of ['2024-12-25', '2025-06-30', '2025-11-11']) {
      const d = resolveDaily(key);
      expect(campaignLevelById(d.levelId)).toBeDefined();
    }
  });

  it('applies modifiers deterministically to the level def', () => {
    const d = resolveDaily('2025-07-04');
    const base = campaignLevelById(d.levelId)!.def;
    const { def } = applyModifiers(base, d.modifiers);
    // The modified def matches what resolveDaily produced (pure transform).
    expect(hashLevelDef(def)).toBe(hashLevelDef(d.def));
    // Base is never mutated.
    expect(hashLevelDef(base)).toBe(hashLevelDef(campaignLevelById(d.levelId)!.def));
  });

  it('five-slots modifier caps the slot count at 5', () => {
    const base = campaignLevelById('w3-4')!.def; // 7 slots
    const mod = MODIFIERS.find((m) => m.id === 'five-slots')!;
    const out = mod.apply(base);
    expect(out.slotCount).toBe(5);
    expect(out.spawns.length).toBe(5);
    expect(base.slotCount).toBe(7); // unchanged
  });

  it('glass-echoes halves echo starting HP via echoHpScale', () => {
    const base = campaignLevelById('w1-boss')!.def;
    const mod = MODIFIERS.find((m) => m.id === 'glass-echoes')!;
    const out = mod.apply(base);
    expect(out.echoHpScale).toBeCloseTo(0.5);
  });

  it('enraged-boss increases every pattern step damage', () => {
    const base = campaignLevelById('w1-boss')!.def;
    const mod = MODIFIERS.find((m) => m.id === 'enraged-boss')!;
    const out = mod.apply(base);
    for (let i = 0; i < base.boss.pattern.length; i++) {
      expect(out.boss.pattern[i]!.damage).toBeGreaterThan(base.boss.pattern[i]!.damage);
    }
  });
});

describe('daily scoring', () => {
  it('scores 0 for a loss', () => {
    expect(scoreDaily({ won: false, winTick: 100, loopLength: 1200, echoesAlive: 3, rewritesUsed: 0, wonOnSlot: 4, slotCount: 5 })).toBe(0);
  });

  it('rewards faster wins, more echoes, and early victory; penalizes rewrites', () => {
    const fast = scoreDaily({ won: true, winTick: 100, loopLength: 1200, echoesAlive: 3, rewritesUsed: 0, wonOnSlot: 4, slotCount: 5 });
    const slow = scoreDaily({ won: true, winTick: 1100, loopLength: 1200, echoesAlive: 3, rewritesUsed: 0, wonOnSlot: 4, slotCount: 5 });
    expect(fast).toBeGreaterThan(slow);

    const moreEchoes = scoreDaily({ won: true, winTick: 600, loopLength: 1200, echoesAlive: 4, rewritesUsed: 0, wonOnSlot: 4, slotCount: 5 });
    const fewerEchoes = scoreDaily({ won: true, winTick: 600, loopLength: 1200, echoesAlive: 1, rewritesUsed: 0, wonOnSlot: 4, slotCount: 5 });
    expect(moreEchoes - fewerEchoes).toBe(3 * DAILY_SCORE.perEchoAlive);

    const early = scoreDaily({ won: true, winTick: 600, loopLength: 1200, echoesAlive: 2, rewritesUsed: 0, wonOnSlot: 2, slotCount: 5 });
    const last = scoreDaily({ won: true, winTick: 600, loopLength: 1200, echoesAlive: 2, rewritesUsed: 0, wonOnSlot: 4, slotCount: 5 });
    expect(early - last).toBe(DAILY_SCORE.earlyVictoryBonus);

    const withRewrite = scoreDaily({ won: true, winTick: 600, loopLength: 1200, echoesAlive: 2, rewritesUsed: 2, wonOnSlot: 4, slotCount: 5 });
    expect(last - withRewrite).toBe(2 * DAILY_SCORE.perRewritePenalty);
  });
});

describe('content hash', () => {
  it('is a stable non-zero 32-bit value', () => {
    const h = contentHash();
    expect(h).toBe(contentHash());
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
  });
});
