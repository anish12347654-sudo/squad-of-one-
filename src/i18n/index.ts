/**
 * Localization layer (brief section 8).
 *
 * English + Hindi (Devanagari) from day one via JSON string tables. There are
 * NO hard-coded UI strings anywhere in the render/UI layers: every visible
 * string flows through `t(key, params?)`. A test enforces that both locales
 * cover the exact same key set (`tests/unit/i18n.test.ts`) and a lint-style
 * source scan enforces "no hard-coded strings" in the UI layer.
 *
 * This module is impure only in that it holds a tiny mutable "current locale"
 * pointer; it never touches the sim.
 */

import en from './en.json' with { type: 'json' };
import hi from './hi.json' with { type: 'json' };

/** Supported locales. Add a new locale by adding its JSON + an entry here. */
export type LocaleId = 'en' | 'hi';

export interface LocaleMeta {
  id: LocaleId;
  /** Endonym (name in its own language) shown in the language picker. */
  label: string;
  /** Font family key the render layer should use for this locale's script. */
  fontKey: 'latin' | 'devanagari';
}

export const LOCALES: readonly LocaleMeta[] = [
  { id: 'en', label: 'English', fontKey: 'latin' },
  { id: 'hi', label: 'हिन्दी', fontKey: 'devanagari' },
];

type Table = Record<string, string>;

const TABLES: Record<LocaleId, Table> = {
  en: en as Table,
  hi: hi as Table,
};

/** The master key set is English's; every other locale must match it exactly. */
export const STRING_KEYS: readonly string[] = Object.keys(en).sort();

let currentLocale: LocaleId = 'en';

/** The current locale id. */
export function getLocale(): LocaleId {
  return currentLocale;
}

/** Set the active locale (falls back to English if unknown). */
export function setLocale(id: LocaleId): void {
  currentLocale = TABLES[id] ? id : 'en';
}

/** Metadata for the active locale. */
export function currentLocaleMeta(): LocaleMeta {
  return LOCALES.find((l) => l.id === currentLocale) ?? LOCALES[0]!;
}

/**
 * Translate a key with optional `{param}` interpolation. Unknown keys return
 * the key itself (so a missing string is loud, not silently blank). Missing
 * translations in a non-English locale fall back to English.
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const table = TABLES[currentLocale];
  let template = table[key];
  if (template === undefined) template = TABLES.en[key];
  if (template === undefined) return key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_m, name: string) => {
    const v = params[name];
    return v === undefined ? `{${name}}` : String(v);
  });
}

/** True if `key` exists in the master (English) table. */
export function hasKey(key: string): boolean {
  return TABLES.en[key] !== undefined;
}

/** Return the raw table for a locale (used by tests / tooling). */
export function tableFor(id: LocaleId): Readonly<Table> {
  return TABLES[id];
}
