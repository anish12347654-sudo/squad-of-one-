/**
 * Versioned save schema + migrations (brief section 9.5).
 *
 * The save holds: campaign progress + stars, currency (Chrono Shards), lifetime
 * XP + per-class mastery, owned/equipped cosmetics, settings, and the top-20
 * replays. It is a plain JSON object, versioned with an integer `version`, and
 * upgraded through a linear chain of pure migration functions. Export/import as
 * a compact base64 "code" is provided for backup/transfer.
 *
 * This module is pure w.r.t. the data (migrations, defaults, validation). The
 * actual localStorage/IndexedDB persistence lives in src/platform (storage.ts)
 * and calls into here for (de)serialization + migration.
 */

import type { ClassId } from '@sim/index.js';
import type { LocaleId } from '@i18n/index.js';
import { allCosmeticIds, defaultCosmetic } from './cosmetics.js';

/** Current save schema version. Bump whenever the shape changes; add a migration. */
export const SAVE_VERSION = 4;

/** Text-size accessibility setting. */
export type TextSize = 'small' | 'medium' | 'large';

/** User settings + accessibility (brief section 8). */
export interface SaveSettings {
  locale: LocaleId;
  volumeMaster: number; // 0..1
  volumeMusic: number; // 0..1
  volumeSfx: number; // 0..1
  screenShake: boolean;
  reducedFlashing: boolean;
  colorBlind: boolean;
  textSize: TextSize;
  leftHanded: boolean;
  haptics: boolean;
  /** Assist Mode: 0.8x game speed; stars won under it are marked. */
  assistMode: boolean;
}

/** Per-level record: best stars + whether it was cleared + assist flag. */
export interface LevelRecord {
  /** Best stars ever earned (0..3). */
  bestStars: number;
  /** True once cleared at least once (>=1 star without assist not required). */
  cleared: boolean;
  /** True if the best result was achieved with Assist Mode on. */
  assistUsed: boolean;
}

/** A compact stored replay entry (top-20 leaderboard of the player's own runs). */
export interface StoredReplay {
  levelId: string;
  stars: number;
  /** Loop the win landed on (fewer = better). */
  wonOnSlot: number;
  /** Serialized replay-code string (see recording/replay code in the sim). */
  code: string;
  /** Monotonic sequence used only for stable ordering (not a wall clock). */
  seq: number;
}

/** The full save game. */
export interface SaveGame {
  version: number;
  /** levelId -> record. */
  levels: Record<string, LevelRecord>;
  /** Soft currency. */
  shards: number;
  /** Lifetime XP (account level derived from it). */
  xp: number;
  /** classId -> cumulative mastery XP. */
  mastery: Record<string, number>;
  /** Owned cosmetic ids. */
  ownedCosmetics: string[];
  /** Equipped cosmetic id per category. */
  equipped: { trail: string; skin: string; banner: string };
  /** Top-20 replays of the player's own best runs. */
  replays: StoredReplay[];
  settings: SaveSettings;
  /** Monotonic counter backing StoredReplay.seq (no wall clock in saves). */
  replaySeq: number;
  /** True once the first-time experience has been completed. */
  seenIntro: boolean;
  /** Daily Paradox local best score per date key (M4). */
  dailyBest: Record<string, number>;
}

export const MAX_STORED_REPLAYS = 20;

/** Default settings for a fresh save. */
export function defaultSettings(): SaveSettings {
  return {
    locale: 'en',
    volumeMaster: 0.8,
    volumeMusic: 0.7,
    volumeSfx: 0.9,
    screenShake: true,
    reducedFlashing: false,
    colorBlind: false,
    textSize: 'medium',
    leftHanded: false,
    haptics: true,
    assistMode: false,
  };
}

/** A brand-new save at the current version. */
export function freshSave(): SaveGame {
  return {
    version: SAVE_VERSION,
    levels: {},
    shards: 0,
    xp: 0,
    mastery: {},
    ownedCosmetics: [
      defaultCosmetic('trail'),
      defaultCosmetic('skin'),
      defaultCosmetic('banner'),
    ],
    equipped: {
      trail: defaultCosmetic('trail'),
      skin: defaultCosmetic('skin'),
      banner: defaultCosmetic('banner'),
    },
    replays: [],
    settings: defaultSettings(),
    replaySeq: 0,
    seenIntro: false,
    dailyBest: {},
  };
}

// ---------------------------------------------------------------------------
// Migrations
// ---------------------------------------------------------------------------

/**
 * A migration upgrades a save object from `version` to `version+1`. Migrations
 * are pure and receive a shallow-cloned object they may mutate + return. The
 * chain is applied in order until the object reaches SAVE_VERSION.
 *
 * History:
 *   v1: original M3 shape (no mastery, no replaySeq, no seenIntro).
 *   v2: added `mastery` map and `seenIntro`.
 *   v3: added `replaySeq` (monotonic) + `settings.assistMode`; renamed the old
 *       `sound` boolean into the three volume sliders.
 *   v4: added `dailyBest` (Daily Paradox local best per date key).
 */
type Migration = (save: Record<string, unknown>) => Record<string, unknown>;

const MIGRATIONS: Record<number, Migration> = {
  // v1 -> v2
  1: (s) => {
    if (typeof s.mastery !== 'object' || s.mastery === null) s.mastery = {};
    if (typeof s.seenIntro !== 'boolean') s.seenIntro = false;
    s.version = 2;
    return s;
  },
  // v2 -> v3
  2: (s) => {
    if (typeof s.replaySeq !== 'number') s.replaySeq = Array.isArray(s.replays) ? s.replays.length : 0;
    const settings = (s.settings ?? {}) as Record<string, unknown>;
    // Old single `sound` boolean -> three sliders.
    if (typeof settings.volumeMaster !== 'number') {
      const on = settings.sound !== false;
      settings.volumeMaster = on ? 0.8 : 0;
      settings.volumeMusic = on ? 0.7 : 0;
      settings.volumeSfx = on ? 0.9 : 0;
    }
    delete settings.sound;
    if (typeof settings.assistMode !== 'boolean') settings.assistMode = false;
    s.settings = settings;
    s.version = 3;
    return s;
  },
  // v3 -> v4
  3: (s) => {
    if (typeof s.dailyBest !== 'object' || s.dailyBest === null) s.dailyBest = {};
    s.version = 4;
    return s;
  },
};

/** Highest version any migration knows how to produce. */
export const HIGHEST_MIGRATED_VERSION = SAVE_VERSION;

/**
 * Migrate a raw parsed save object up to the current version, then normalize +
 * fill defaults so the result is a valid SaveGame regardless of how partial or
 * old the input was. Throws only if the input is not an object at all.
 */
export function migrate(raw: unknown): SaveGame {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('save is not an object');
  }
  let s = { ...(raw as Record<string, unknown>) };
  let version = typeof s.version === 'number' ? s.version : 1;

  // Apply migrations forward until we reach the current version.
  while (version < SAVE_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) break; // no path forward; normalize will fill defaults.
    s = step(s);
    version = typeof s.version === 'number' ? s.version : version + 1;
  }
  s.version = SAVE_VERSION;
  return normalize(s);
}

/** Fill missing fields with defaults and clamp/validate values. */
export function normalize(raw: Record<string, unknown>): SaveGame {
  const base = freshSave();
  const validCosmetics = new Set(allCosmeticIds());

  const levels: Record<string, LevelRecord> = {};
  const rawLevels = (raw.levels ?? {}) as Record<string, unknown>;
  for (const [id, rec] of Object.entries(rawLevels)) {
    if (typeof rec !== 'object' || rec === null) continue;
    const r = rec as Record<string, unknown>;
    levels[id] = {
      bestStars: clampInt(r.bestStars, 0, 3, 0),
      cleared: r.cleared === true,
      assistUsed: r.assistUsed === true,
    };
  }

  const mastery: Record<string, number> = {};
  const rawMastery = (raw.mastery ?? {}) as Record<string, unknown>;
  for (const [id, xp] of Object.entries(rawMastery)) {
    if (typeof xp === 'number' && Number.isFinite(xp)) mastery[id] = Math.max(0, Math.floor(xp));
  }

  const owned = new Set<string>(base.ownedCosmetics);
  if (Array.isArray(raw.ownedCosmetics)) {
    for (const id of raw.ownedCosmetics) {
      if (typeof id === 'string' && validCosmetics.has(id)) owned.add(id);
    }
  }

  const rawEquip = (raw.equipped ?? {}) as Record<string, unknown>;
  const equipCat = (cat: 'trail' | 'skin' | 'banner'): string => {
    const v = rawEquip[cat];
    if (typeof v === 'string' && owned.has(v) && validCosmetics.has(v)) return v;
    return defaultCosmetic(cat);
  };

  const replaysRaw = Array.isArray(raw.replays) ? raw.replays : [];
  const replays: StoredReplay[] = [];
  for (const r of replaysRaw) {
    if (typeof r !== 'object' || r === null) continue;
    const o = r as Record<string, unknown>;
    if (typeof o.levelId !== 'string' || typeof o.code !== 'string') continue;
    replays.push({
      levelId: o.levelId,
      stars: clampInt(o.stars, 0, 3, 0),
      wonOnSlot: clampInt(o.wonOnSlot, -1, 6, -1),
      code: o.code,
      seq: typeof o.seq === 'number' ? o.seq : 0,
    });
  }
  replays.sort(replayOrder);
  const trimmed = replays.slice(0, MAX_STORED_REPLAYS);

  const rawSettings = (raw.settings ?? {}) as Record<string, unknown>;
  const settings: SaveSettings = {
    locale: rawSettings.locale === 'hi' ? 'hi' : 'en',
    volumeMaster: clamp01(rawSettings.volumeMaster, base.settings.volumeMaster),
    volumeMusic: clamp01(rawSettings.volumeMusic, base.settings.volumeMusic),
    volumeSfx: clamp01(rawSettings.volumeSfx, base.settings.volumeSfx),
    screenShake: boolOr(rawSettings.screenShake, true),
    reducedFlashing: boolOr(rawSettings.reducedFlashing, false),
    colorBlind: boolOr(rawSettings.colorBlind, false),
    textSize: textSizeOr(rawSettings.textSize),
    leftHanded: boolOr(rawSettings.leftHanded, false),
    haptics: boolOr(rawSettings.haptics, true),
    assistMode: boolOr(rawSettings.assistMode, false),
  };

  let replaySeq = typeof raw.replaySeq === 'number' ? Math.max(0, Math.floor(raw.replaySeq)) : 0;
  for (const r of trimmed) if (r.seq >= replaySeq) replaySeq = r.seq + 1;

  return {
    version: SAVE_VERSION,
    levels,
    shards: intOr(raw.shards, 0),
    xp: intOr(raw.xp, 0),
    mastery,
    ownedCosmetics: [...owned],
    equipped: { trail: equipCat('trail'), skin: equipCat('skin'), banner: equipCat('banner') },
    replays: trimmed,
    settings,
    replaySeq,
    seenIntro: raw.seenIntro === true,
    dailyBest: normalizeDailyBest(raw.dailyBest),
  };
}

/** Sanitize the Daily best map: string keys -> non-negative integer scores. */
function normalizeDailyBest(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (typeof raw === 'object' && raw !== null) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.max(0, Math.floor(v));
    }
  }
  return out;
}

/** Best replays first: higher stars, then earlier winning slot, then newer seq. */
export function replayOrder(a: StoredReplay, b: StoredReplay): number {
  if (a.stars !== b.stars) return b.stars - a.stars;
  if (a.wonOnSlot !== b.wonOnSlot) return a.wonOnSlot - b.wonOnSlot;
  return b.seq - a.seq;
}

// ---------------------------------------------------------------------------
// Export / import as a code
// ---------------------------------------------------------------------------

/**
 * Serialize a save to a portable code string. The code is a base64 of the JSON
 * with a short header so imports can be validated. Uses only base64 primitives
 * available in both Node and the browser (via the injected encoder).
 */
export function exportCode(save: SaveGame, toBase64: (s: string) => string): string {
  const json = JSON.stringify(save);
  return 'SQ1-' + toBase64(json);
}

/** Parse a code back into a migrated, normalized SaveGame. Throws on garbage. */
export function importCode(code: string, fromBase64: (s: string) => string): SaveGame {
  const trimmed = code.trim();
  if (!trimmed.startsWith('SQ1-')) throw new Error('not a SQUAD OF ONE save code');
  const json = fromBase64(trimmed.slice(4));
  const parsed = JSON.parse(json) as unknown;
  return migrate(parsed);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clampInt(v: unknown, lo: number, hi: number, dflt: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return dflt;
  return Math.min(hi, Math.max(lo, Math.floor(v)));
}
function intOr(v: unknown, dflt: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return dflt;
  return Math.max(0, Math.floor(v));
}
function clamp01(v: unknown, dflt: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return dflt;
  return Math.min(1, Math.max(0, v));
}
function boolOr(v: unknown, dflt: boolean): boolean {
  return typeof v === 'boolean' ? v : dflt;
}
function textSizeOr(v: unknown): TextSize {
  return v === 'small' || v === 'large' ? v : 'medium';
}

// ---------------------------------------------------------------------------
// Mutations used by gameplay flow (pure: return a new save)
// ---------------------------------------------------------------------------

/** Record a level result, updating best stars, currency, XP and mastery. */
export function recordLevelResult(
  save: SaveGame,
  levelId: string,
  stars: number,
  assistUsed: boolean,
  reward: { xp: number; shards: number; masteryXp: number },
  masteryClass: ClassId | null,
): SaveGame {
  const next: SaveGame = structuredCloneSave(save);
  const prev = next.levels[levelId];
  const bestStars = Math.max(prev?.bestStars ?? 0, stars);
  next.levels[levelId] = {
    bestStars,
    cleared: (prev?.cleared ?? false) || stars > 0,
    assistUsed: bestStars === stars ? assistUsed : (prev?.assistUsed ?? false),
  };
  next.shards += reward.shards;
  next.xp += reward.xp;
  if (masteryClass && reward.masteryXp > 0) {
    next.mastery[masteryClass] = (next.mastery[masteryClass] ?? 0) + reward.masteryXp;
  }
  return next;
}

/** Add a replay, keeping only the best MAX_STORED_REPLAYS. */
export function addReplay(save: SaveGame, entry: Omit<StoredReplay, 'seq'>): SaveGame {
  const next = structuredCloneSave(save);
  const seq = next.replaySeq++;
  next.replays.push({ ...entry, seq });
  next.replays.sort(replayOrder);
  next.replays = next.replays.slice(0, MAX_STORED_REPLAYS);
  return next;
}

/**
 * Record a Daily Paradox score, keeping the local best per date key. Returns
 * the updated save and whether this run set a new best.
 */
export function recordDailyResult(
  save: SaveGame,
  dateKey: string,
  score: number,
): { save: SaveGame; newBest: boolean } {
  const prev = save.dailyBest[dateKey] ?? 0;
  if (score <= prev) return { save, newBest: false };
  const next = structuredCloneSave(save);
  next.dailyBest[dateKey] = score;
  return { save: next, newBest: true };
}

/** Attempt to buy a cosmetic; returns null if unaffordable/owned/unknown. */
export function buyCosmetic(save: SaveGame, cosmeticId: string, price: number): SaveGame | null {
  if (save.ownedCosmetics.includes(cosmeticId)) return null;
  if (save.shards < price) return null;
  const next = structuredCloneSave(save);
  next.shards -= price;
  next.ownedCosmetics.push(cosmeticId);
  return next;
}

/** Equip an owned cosmetic in its category; returns null if not owned. */
export function equipCosmetic(
  save: SaveGame,
  category: 'trail' | 'skin' | 'banner',
  cosmeticId: string,
): SaveGame | null {
  if (!save.ownedCosmetics.includes(cosmeticId)) return null;
  const next = structuredCloneSave(save);
  next.equipped[category] = cosmeticId;
  return next;
}

/** A deterministic deep clone of a save (no wall clock, no structuredClone dep). */
export function structuredCloneSave(save: SaveGame): SaveGame {
  return JSON.parse(JSON.stringify(save)) as SaveGame;
}
