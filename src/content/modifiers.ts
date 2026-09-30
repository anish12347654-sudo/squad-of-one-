/**
 * Daily Paradox modifiers (brief section 6.2).
 *
 * Modifiers are TYPED DATA that transform a pure `LevelDef` deterministically
 * before it is handed to the sim. They never touch the sim internals - they
 * only rewrite the level definition (boss HP/speed/pattern damage, slot count,
 * echo starting HP scaling) - so a modified Daily run is still played through
 * the identical frozen `step()` path and remains fully deterministic.
 *
 * `echoStartHpScale` is applied by the Daily runner when it spawns echoes (the
 * sim clamps HP), the rest are pure LevelDef edits. Every modifier carries an
 * i18n name key so the UI stays fully localized.
 */

import type { LevelDef } from '@sim/index.js';

/** A modifier's stable id (used in seeding + the shareable result card). */
export type ModifierId =
  | 'enraged-boss'
  | 'glass-echoes'
  | 'five-slots'
  | 'swift-boss'
  | 'tanky-boss'
  | 'short-loop';

export interface Modifier {
  id: ModifierId;
  /** i18n key for the modifier's display name. */
  nameKey: string;
  /** i18n key for a one-line description. */
  descKey: string;
  /** Pure transform applied to the LevelDef. Must be deterministic. */
  apply(def: LevelDef): LevelDef;
  /**
   * Multiplier applied to each echo's starting HP (1 = unchanged). The Daily
   * runner reads this because HP is a sim runtime value, not a LevelDef field.
   */
  echoStartHpScale: number;
}

/** Deep-clone a LevelDef so a modifier never mutates shared campaign data. */
function cloneDef(def: LevelDef): LevelDef {
  return JSON.parse(JSON.stringify(def)) as LevelDef;
}

/** The catalog of modifiers, in stable id order (used for deterministic pick). */
export const MODIFIERS: readonly Modifier[] = [
  {
    id: 'enraged-boss',
    nameKey: 'daily.mod.enragedBoss',
    descKey: 'daily.mod.enragedBoss.desc',
    echoStartHpScale: 1,
    apply(def) {
      const d = cloneDef(def);
      d.boss.pattern = d.boss.pattern.map((s) => ({ ...s, damage: Math.round(s.damage * 1.4) }));
      return d;
    },
  },
  {
    id: 'glass-echoes',
    nameKey: 'daily.mod.glassEchoes',
    descKey: 'daily.mod.glassEchoes.desc',
    echoStartHpScale: 0.5,
    apply(def) {
      const d = cloneDef(def);
      d.echoHpScale = (d.echoHpScale ?? 1) * 0.5;
      return d;
    },
  },
  {
    id: 'five-slots',
    nameKey: 'daily.mod.fiveSlots',
    descKey: 'daily.mod.fiveSlots.desc',
    echoStartHpScale: 1,
    apply(def) {
      const d = cloneDef(def);
      const cap = Math.min(5, d.slotCount);
      d.slotCount = cap;
      d.spawns = d.spawns.slice(0, cap);
      return d;
    },
  },
  {
    id: 'swift-boss',
    nameKey: 'daily.mod.swiftBoss',
    descKey: 'daily.mod.swiftBoss.desc',
    echoStartHpScale: 1,
    apply(def) {
      const d = cloneDef(def);
      d.boss.speed = Math.round(d.boss.speed * 1.5);
      d.boss.pattern = d.boss.pattern.map((s) => ({
        ...s,
        telegraphTicks: Math.max(12, Math.round(s.telegraphTicks * 0.8)),
      }));
      return d;
    },
  },
  {
    id: 'tanky-boss',
    nameKey: 'daily.mod.tankyBoss',
    descKey: 'daily.mod.tankyBoss.desc',
    echoStartHpScale: 1,
    apply(def) {
      const d = cloneDef(def);
      d.boss.maxHp = Math.round(d.boss.maxHp * 1.35);
      return d;
    },
  },
  {
    id: 'short-loop',
    nameKey: 'daily.mod.shortLoop',
    descKey: 'daily.mod.shortLoop.desc',
    echoStartHpScale: 1,
    apply(def) {
      const d = cloneDef(def);
      d.loopLength = Math.max(12 * 60, Math.round(d.loopLength * 0.75));
      return d;
    },
  },
];

/** Look up a modifier by id. */
export function modifierById(id: ModifierId): Modifier | undefined {
  return MODIFIERS.find((m) => m.id === id);
}

/**
 * Apply a set of modifiers to a level definition, in the given order. Returns
 * the transformed def plus the combined echo-HP scale the Daily runner applies.
 */
export function applyModifiers(
  def: LevelDef,
  mods: readonly Modifier[],
): { def: LevelDef; echoStartHpScale: number } {
  let out = def;
  let scale = 1;
  for (const m of mods) {
    out = m.apply(out);
    scale *= m.echoStartHpScale;
  }
  return { def: out, echoStartHpScale: scale };
}
