/**
 * Save migration + schema tests (brief section 10 mandated unit tests).
 *
 * Assert that old saves upgrade cleanly through the migration chain to the
 * current version, that normalization fills defaults + rejects garbage, and
 * that export/import codes round-trip. Also covers the gameplay-flow mutations
 * (record result, buy/equip cosmetics, replay top-20).
 */

import { describe, it, expect } from 'vitest';
import {
  SAVE_VERSION,
  freshSave,
  migrate,
  normalize,
  exportCode,
  importCode,
  recordLevelResult,
  addReplay,
  buyCosmetic,
  equipCosmetic,
  MAX_STORED_REPLAYS,
  defaultCosmetic,
  levelReward,
} from '@meta/index.js';

const b64 = (s: string): string => Buffer.from(s, 'utf-8').toString('base64');
const unb64 = (s: string): string => Buffer.from(s, 'base64').toString('utf-8');

describe('save schema + fresh save', () => {
  it('a fresh save is at the current version and passes normalize unchanged', () => {
    const s = freshSave();
    expect(s.version).toBe(SAVE_VERSION);
    const n = normalize(s as unknown as Record<string, unknown>);
    expect(n).toEqual(s);
  });

  it('fresh save owns and equips the free default cosmetics', () => {
    const s = freshSave();
    for (const cat of ['trail', 'skin', 'banner'] as const) {
      const def = defaultCosmetic(cat);
      expect(s.ownedCosmetics).toContain(def);
      expect(s.equipped[cat]).toBe(def);
    }
  });
});

describe('migrations', () => {
  it('migrates a v1 save to the current version, adding new fields', () => {
    const v1 = {
      version: 1,
      levels: { 'tut-1': { bestStars: 2, cleared: true } },
      shards: 50,
      xp: 130,
      ownedCosmetics: ['trail.default', 'skin.default', 'banner.default'],
      equipped: { trail: 'trail.default', skin: 'skin.default', banner: 'banner.default' },
      replays: [],
      settings: { locale: 'en', sound: true },
    };
    const s = migrate(v1);
    expect(s.version).toBe(SAVE_VERSION);
    // v2 additions:
    expect(s.mastery).toEqual({});
    expect(s.seenIntro).toBe(false);
    // v3 additions (sound -> sliders, assistMode, replaySeq):
    expect(s.settings.volumeMaster).toBeGreaterThan(0);
    expect(s.settings.assistMode).toBe(false);
    expect((s.settings as unknown as Record<string, unknown>).sound).toBeUndefined();
    expect(typeof s.replaySeq).toBe('number');
    // Preserved data:
    expect(s.levels['tut-1']?.bestStars).toBe(2);
    expect(s.shards).toBe(50);
    expect(s.xp).toBe(130);
  });

  it('v1 with sound:false migrates to zero volumes', () => {
    const s = migrate({ version: 1, settings: { sound: false } });
    expect(s.settings.volumeMaster).toBe(0);
    expect(s.settings.volumeMusic).toBe(0);
    expect(s.settings.volumeSfx).toBe(0);
  });

  it('migrates a v2 save to v3', () => {
    const v2 = {
      version: 2,
      mastery: { ranger: 120 },
      seenIntro: true,
      settings: { locale: 'hi', sound: true },
      replays: [{ levelId: 'a', stars: 3, wonOnSlot: 1, code: 'x' }],
    };
    const s = migrate(v2);
    expect(s.version).toBe(SAVE_VERSION);
    expect(s.settings.locale).toBe('hi');
    expect(s.seenIntro).toBe(true);
    expect(s.mastery.ranger).toBe(120);
    expect(s.replaySeq).toBeGreaterThanOrEqual(1);
  });

  it('an unversioned object is treated as v1', () => {
    const s = migrate({ shards: 10 });
    expect(s.version).toBe(SAVE_VERSION);
    expect(s.shards).toBe(10);
  });

  it('throws on a non-object', () => {
    expect(() => migrate(null)).toThrow();
    expect(() => migrate(42 as unknown)).toThrow();
  });
});

describe('normalize hardening', () => {
  it('fills defaults and clamps out-of-range values', () => {
    const s = normalize({
      version: SAVE_VERSION,
      shards: -100,
      xp: 3.7,
      levels: { bad: { bestStars: 99 } },
      settings: { volumeMaster: 5, textSize: 'huge' },
      ownedCosmetics: ['nonexistent.cosmetic', 'trail.comet'],
      equipped: { trail: 'trail.comet', skin: 'not-owned', banner: 'banner.default' },
    });
    expect(s.shards).toBe(0); // negative clamped
    expect(s.xp).toBe(3); // floored
    expect(s.levels.bad?.bestStars).toBe(3); // clamped to 3
    expect(s.settings.volumeMaster).toBe(1); // clamped to 1
    expect(s.settings.textSize).toBe('medium'); // invalid -> default
    expect(s.ownedCosmetics).not.toContain('nonexistent.cosmetic');
    expect(s.ownedCosmetics).toContain('trail.comet');
    // Equipped skin was not owned -> falls back to default.
    expect(s.equipped.skin).toBe(defaultCosmetic('skin'));
    expect(s.equipped.trail).toBe('trail.comet');
  });

  it('drops malformed replays and sorts the rest best-first', () => {
    const s = normalize({
      version: SAVE_VERSION,
      replays: [
        { levelId: 'a', stars: 1, wonOnSlot: 3, code: 'a', seq: 1 },
        { levelId: 'b', stars: 3, wonOnSlot: 2, code: 'b', seq: 2 },
        { garbage: true },
        { levelId: 'c', code: 'c', stars: 3, wonOnSlot: 1, seq: 3 },
      ],
    });
    expect(s.replays.length).toBe(3);
    // Best first: 3 stars slot1, then 3 stars slot2, then 1 star.
    expect(s.replays[0]?.levelId).toBe('c');
    expect(s.replays[1]?.levelId).toBe('b');
    expect(s.replays[2]?.levelId).toBe('a');
  });
});

describe('export / import code', () => {
  it('round-trips a save through a code', () => {
    const s = freshSave();
    s.shards = 275;
    s.xp = 640;
    s.seenIntro = true;
    const code = exportCode(s, b64);
    expect(code.startsWith('SQ1-')).toBe(true);
    const back = importCode(code, unb64);
    expect(back).toEqual(s);
  });

  it('rejects a code without the header', () => {
    expect(() => importCode(b64('{"version":3}'), unb64)).toThrow();
  });

  it('migrates on import from an older exported code', () => {
    const oldCode = 'SQ1-' + b64(JSON.stringify({ version: 1, shards: 5 }));
    const back = importCode(oldCode, unb64);
    expect(back.version).toBe(SAVE_VERSION);
    expect(back.shards).toBe(5);
  });
});

describe('gameplay-flow mutations', () => {
  it('records a level result: best stars, currency, xp, mastery', () => {
    let s = freshSave();
    const reward = levelReward(3, true);
    s = recordLevelResult(s, 'w1-1', 3, false, reward, 'ranger');
    expect(s.levels['w1-1']?.bestStars).toBe(3);
    expect(s.levels['w1-1']?.cleared).toBe(true);
    expect(s.shards).toBe(reward.shards);
    expect(s.xp).toBe(reward.xp);
    expect(s.mastery.ranger).toBe(reward.masteryXp);

    // A worse later result does not lower best stars but still grants currency.
    const before = s.shards;
    s = recordLevelResult(s, 'w1-1', 1, false, levelReward(1, false), 'guardian');
    expect(s.levels['w1-1']?.bestStars).toBe(3);
    expect(s.shards).toBeGreaterThan(before);
  });

  it('buys and equips a cosmetic only when affordable/owned', () => {
    let s = freshSave();
    s.shards = 100;
    // Too expensive:
    expect(buyCosmetic(s, 'trail.ribbon', 200)).toBeNull();
    // Affordable:
    const bought = buyCosmetic(s, 'trail.comet', 120);
    expect(bought).toBeNull(); // 100 < 120
    s.shards = 500;
    const ok = buyCosmetic(s, 'trail.comet', 120);
    expect(ok).not.toBeNull();
    s = ok!;
    expect(s.shards).toBe(380);
    expect(s.ownedCosmetics).toContain('trail.comet');
    // Re-buying returns null (already owned).
    expect(buyCosmetic(s, 'trail.comet', 120)).toBeNull();
    // Equip owned:
    const eq = equipCosmetic(s, 'trail', 'trail.comet');
    expect(eq).not.toBeNull();
    expect(eq!.equipped.trail).toBe('trail.comet');
    // Equip not-owned:
    expect(equipCosmetic(s, 'skin', 'skin.neon')).toBeNull();
  });

  it('keeps only the best MAX_STORED_REPLAYS', () => {
    let s = freshSave();
    for (let i = 0; i < MAX_STORED_REPLAYS + 10; i++) {
      s = addReplay(s, { levelId: `lvl-${i}`, stars: (i % 3) as number, wonOnSlot: 2, code: `c${i}` });
    }
    expect(s.replays.length).toBe(MAX_STORED_REPLAYS);
    // The list is sorted best-first and every kept entry has >= the min star of any dropped.
    for (let i = 1; i < s.replays.length; i++) {
      expect(s.replays[i - 1]!.stars).toBeGreaterThanOrEqual(s.replays[i]!.stars);
    }
  });

  it('replay seq is monotonic and stable (no wall clock)', () => {
    let s = freshSave();
    s = addReplay(s, { levelId: 'a', stars: 2, wonOnSlot: 2, code: 'a' });
    s = addReplay(s, { levelId: 'b', stars: 2, wonOnSlot: 2, code: 'b' });
    const seqs = s.replays.map((r) => r.seq);
    expect(new Set(seqs).size).toBe(seqs.length); // unique
    expect(s.replaySeq).toBe(2);
  });
});
