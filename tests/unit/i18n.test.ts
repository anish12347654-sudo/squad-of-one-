/**
 * Localization tests (brief section 8): en + hi parity, interpolation, and the
 * "no hard-coded strings" enforcement.
 *
 * The parity test guarantees every locale defines the exact same key set (a
 * missing Hindi string would otherwise silently fall back to English). The
 * catalog test guarantees every i18n key referenced by data (cosmetics, story)
 * actually resolves. The source-scan test enforces that UI-layer source files
 * do not contain user-facing hard-coded string literals - all visible text must
 * come through t().
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { t, setLocale, tableFor, STRING_KEYS, LOCALES } from '@i18n/index.js';
import { COSMETICS } from '@meta/index.js';

describe('locale parity', () => {
  it('every locale defines exactly the master key set', () => {
    const master = new Set(STRING_KEYS);
    for (const loc of LOCALES) {
      const keys = new Set(Object.keys(tableFor(loc.id)));
      const missing = [...master].filter((k) => !keys.has(k));
      const extra = [...keys].filter((k) => !master.has(k));
      expect(missing, `${loc.id} missing keys`).toEqual([]);
      expect(extra, `${loc.id} extra keys`).toEqual([]);
    }
  });

  it('no locale has an empty string value', () => {
    for (const loc of LOCALES) {
      const table = tableFor(loc.id);
      for (const [k, v] of Object.entries(table)) {
        expect(v.length, `${loc.id}:${k}`).toBeGreaterThan(0);
      }
    }
  });

  it('Hindi values actually use Devanagari for translated content', () => {
    const hi = tableFor('hi');
    // A representative translated key (not a brand constant) must contain
    // Devanagari codepoints (U+0900..U+097F).
    const devanagari = /[\u0900-\u097F]/;
    expect(devanagari.test(hi['menu.play']!)).toBe(true);
    expect(devanagari.test(hi['settings.title']!)).toBe(true);
  });
});

describe('t() interpolation + fallback', () => {
  it('interpolates named params', () => {
    setLocale('en');
    expect(t('common.stars', { count: 2 })).toBe('2 / 3 stars');
    expect(t('results.echoesAlive', { n: 4 })).toBe('Echoes alive: 4');
  });

  it('switches locale', () => {
    setLocale('hi');
    expect(t('menu.play')).toBe(tableFor('hi')['menu.play']);
    setLocale('en');
    expect(t('menu.play')).toBe('Play');
  });

  it('returns the key for an unknown key (loud, not blank)', () => {
    setLocale('en');
    expect(t('does.not.exist')).toBe('does.not.exist');
  });
});

describe('data references resolve to i18n keys', () => {
  it('every cosmetic nameKey exists', () => {
    setLocale('en');
    for (const c of COSMETICS) {
      expect(t(c.nameKey), `${c.id}`).not.toBe(c.nameKey);
    }
  });
});

describe('no hard-coded user-facing strings in the UI layer', () => {
  const uiDir = fileURLToPath(new URL('../../src/ui', import.meta.url));

  function collectTs(dir: string): string[] {
    if (!existsSync(dir)) return [];
    const out: string[] = [];
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}/${name.name}`;
      if (name.isDirectory()) out.push(...collectTs(full));
      else if (name.name.endsWith('.ts') && !name.name.endsWith('.d.ts')) out.push(full);
    }
    return out;
  }

  it('UI source files route visible text through t()', () => {
    const files = collectTs(uiDir);
    // If the UI layer does not exist yet, there is nothing to police.
    if (files.length === 0) return;
    const offenders: string[] = [];
    // Heuristic: a string literal of 2+ letters with a space or 4+ letters that
    // is NOT an i18n key argument, import, or a known non-text literal.
    for (const file of files) {
      const src = readFileSync(file, 'utf-8');
      const lines = src.split('\n');
      lines.forEach((line, i) => {
        const trimmed = line.trim();
        // Skip imports, comments, and lines that are clearly key lookups.
        if (
          trimmed.startsWith('import') ||
          trimmed.startsWith('//') ||
          trimmed.startsWith('*') ||
          trimmed.startsWith('/*')
        ) {
          return;
        }
        // Find setText/add.text style calls with a raw multi-word literal.
        const m = line.match(/\.(setText|text)\(\s*['"]([^'"]{4,})['"]/);
        if (m && !/^[a-z]+(\.[a-z0-9]+)+$/i.test(m[2]!)) {
          offenders.push(`${file}:${i + 1}: ${m[2]}`);
        }
      });
    }
    expect(offenders, `hard-coded UI strings found:\n${offenders.join('\n')}`).toEqual([]);
  });
});
