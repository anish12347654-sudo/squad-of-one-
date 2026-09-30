/**
 * Economy + progression math tests (brief section 7).
 * Pure, deterministic reward + level-curve functions.
 */

import { describe, it, expect } from 'vitest';
import {
  levelReward,
  accountProgress,
  xpForNextLevel,
  masteryTier,
  FIRST_CLEAR_SHARD_BONUS,
  SHARDS_BY_STARS,
  XP_BY_STARS,
} from '@meta/index.js';

describe('level rewards', () => {
  it('grants more for more stars', () => {
    expect(levelReward(1, false).shards).toBeLessThan(levelReward(3, false).shards);
    expect(levelReward(1, false).xp).toBeLessThan(levelReward(3, false).xp);
  });

  it('0 stars grants nothing', () => {
    expect(levelReward(0, true)).toEqual({ xp: 0, shards: 0, masteryXp: 0 });
  });

  it('first clear adds the first-clear shard bonus (only when won)', () => {
    const repeat = levelReward(2, false);
    const first = levelReward(2, true);
    expect(first.shards).toBe(repeat.shards + FIRST_CLEAR_SHARD_BONUS);
    // No bonus on a 0-star first attempt.
    expect(levelReward(0, true).shards).toBe(0);
  });

  it('reward tables match the exposed constants', () => {
    expect(levelReward(3, false).xp).toBe(XP_BY_STARS[3]);
    expect(levelReward(2, false).shards).toBe(SHARDS_BY_STARS[2]);
  });
});

describe('account level curve', () => {
  it('level 1 at 0 xp', () => {
    const p = accountProgress(0);
    expect(p.level).toBe(1);
    expect(p.xpIntoLevel).toBe(0);
    expect(p.xpForNext).toBe(xpForNextLevel(1));
  });

  it('crossing a threshold advances the level with correct remainder', () => {
    const need1 = xpForNextLevel(1); // 100
    const p = accountProgress(need1 + 30);
    expect(p.level).toBe(2);
    expect(p.xpIntoLevel).toBe(30);
  });

  it('is monotonic in total xp', () => {
    let lastLevel = 0;
    for (let xp = 0; xp <= 5000; xp += 137) {
      const l = accountProgress(xp).level;
      expect(l).toBeGreaterThanOrEqual(lastLevel);
      lastLevel = l;
    }
  });

  it('handles corrupt/huge input without hanging', () => {
    expect(accountProgress(-50).level).toBe(1);
    expect(accountProgress(Number.MAX_SAFE_INTEGER).level).toBeLessThanOrEqual(999);
  });
});

describe('class mastery tiers', () => {
  it('starts at tier 1 and climbs with mastery xp', () => {
    expect(masteryTier(0)).toBe(1);
    expect(masteryTier(120)).toBe(2);
    expect(masteryTier(1000)).toBe(5);
  });

  it('is monotonic', () => {
    let last = 0;
    for (let xp = 0; xp <= 1200; xp += 50) {
      const t = masteryTier(xp);
      expect(t).toBeGreaterThanOrEqual(last);
      last = t;
    }
  });
});
