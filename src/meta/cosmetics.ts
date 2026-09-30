/**
 * Cosmetic catalog (brief section 7).
 *
 * Cosmetics are the ONLY thing the soft currency (Chrono Shards) buys: echo
 * trail styles, class colour skins and victory banners. They are purely
 * visual - no cosmetic changes any sim stat. This is enforced structurally:
 * a Cosmetic carries no gameplay fields, only presentation hints, and the sim
 * layer never imports this module.
 *
 * HARD RULES honoured here: no pay-to-win (cosmetic-only), no loot boxes /
 * gambling (every item is bought directly for a fixed shard price), no
 * real-money stakes (shards are earned by play; see economy.ts).
 */

export type CosmeticCategory = 'trail' | 'skin' | 'banner';

export interface Cosmetic {
  id: string;
  category: CosmeticCategory;
  /** i18n key for the display name (never a hard-coded string). */
  nameKey: string;
  /** Price in Chrono Shards. 0 = owned by default (the free baseline). */
  price: number;
  /** Presentation hint the render layer maps to a concrete effect/palette. */
  style: string;
}

/** The full catalog. The first item in each category is the free default. */
export const COSMETICS: readonly Cosmetic[] = [
  { id: 'trail.default', category: 'trail', nameKey: 'cosmetic.trail.default', price: 0, style: 'line' },
  { id: 'trail.comet', category: 'trail', nameKey: 'cosmetic.trail.comet', price: 120, style: 'comet' },
  { id: 'trail.ribbon', category: 'trail', nameKey: 'cosmetic.trail.ribbon', price: 200, style: 'ribbon' },
  { id: 'trail.spark', category: 'trail', nameKey: 'cosmetic.trail.spark', price: 260, style: 'spark' },

  { id: 'skin.default', category: 'skin', nameKey: 'cosmetic.skin.default', price: 0, style: 'original' },
  { id: 'skin.dusk', category: 'skin', nameKey: 'cosmetic.skin.dusk', price: 300, style: 'dusk' },
  { id: 'skin.neon', category: 'skin', nameKey: 'cosmetic.skin.neon', price: 300, style: 'neon' },

  { id: 'banner.default', category: 'banner', nameKey: 'cosmetic.banner.default', price: 0, style: 'plain' },
  { id: 'banner.gilded', category: 'banner', nameKey: 'cosmetic.banner.gilded', price: 400, style: 'gilded' },
  { id: 'banner.frost', category: 'banner', nameKey: 'cosmetic.banner.frost', price: 400, style: 'frost' },
];

/** Look up a cosmetic by id. */
export function cosmeticById(id: string): Cosmetic | undefined {
  return COSMETICS.find((c) => c.id === id);
}

/** The free default cosmetic id for a category (always owned + equippable). */
export function defaultCosmetic(category: CosmeticCategory): string {
  const found = COSMETICS.find((c) => c.category === category && c.price === 0);
  return found ? found.id : COSMETICS[0]!.id;
}

/** Cosmetics in a category, catalog order. */
export function cosmeticsIn(category: CosmeticCategory): Cosmetic[] {
  return COSMETICS.filter((c) => c.category === category);
}

/** Every cosmetic id (for save validation). */
export function allCosmeticIds(): string[] {
  return COSMETICS.map((c) => c.id);
}
