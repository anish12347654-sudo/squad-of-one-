/**
 * Font selection for the render layer (brief section 8).
 *
 * The bundled, subsetted OFL Noto fonts are declared as @font-face in
 * index.html. This module maps the active locale's script to the font family
 * the Phaser text objects should use, and exposes a promise that resolves once
 * the fonts are ready (via the CSS Font Loading API where available).
 */

import { currentLocaleMeta } from './index.js';

/** CSS font-family string for the current locale's script. */
export function fontFamilyForCurrentLocale(): string {
  const meta = currentLocaleMeta();
  return meta.fontKey === 'devanagari'
    ? "'Noto Sans Devanagari', 'Noto Sans', sans-serif"
    : "'Noto Sans', 'Noto Sans Devanagari', sans-serif";
}

/**
 * CSS font-family string for display headlines/titles.
 *
 * For Latin locales this returns the Orbitron sci-fi display face (self-hosted,
 * subsetted). Orbitron has no Devanagari glyphs, so for the Hindi (devanagari)
 * locale we gracefully fall back to the Devanagari/Noto family - Hindi headings
 * keep their locale font and never tofu. The Noto fallbacks are always listed
 * so any glyph outside the display subset still resolves.
 */
export function fontFamilyForDisplay(): string {
  const meta = currentLocaleMeta();
  return meta.fontKey === 'devanagari'
    ? "'Noto Sans Devanagari', 'Noto Sans', sans-serif"
    : "'Orbitron', 'Noto Sans', 'Noto Sans Devanagari', sans-serif";
}

/** Font families to preload so first paint has no tofu flash. */
export const FONT_FAMILIES: readonly string[] = [
  'Noto Sans',
  'Noto Sans Devanagari',
  'Orbitron',
];

/**
 * Ensure the bundled fonts are loaded before heavy text rendering. Resolves
 * immediately (and harmlessly) where the Font Loading API is unavailable
 * (e.g. some headless contexts).
 */
export async function ensureFontsLoaded(): Promise<void> {
  if (typeof document === 'undefined' || !('fonts' in document)) return;
  try {
    await Promise.all(
      FONT_FAMILIES.map((f) => (document as Document).fonts.load(`16px '${f}'`)),
    );
    await (document as Document).fonts.ready;
  } catch {
    /* fonts will still swap in via font-display: swap */
  }
}
