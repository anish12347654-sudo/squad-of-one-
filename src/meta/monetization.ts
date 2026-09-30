/**
 * Monetization adapter interface (brief section 7).
 *
 * A feature-flagged, OFF-BY-DEFAULT adapter surface for FUTURE rewarded ads and
 * IAP. The shipped implementation is a no-op that reports "unavailable" for
 * everything, and the feature flags default to false. There is no real ad SDK
 * or store wired in.
 *
 * HARD RULES enforced by design:
 *   - No pay-to-win: the ONLY product kind is `cosmetic`. There is no consumable
 *     currency IAP, no power, no loot box product kind in this interface.
 *   - No loot boxes / gambling: products are direct, named cosmetics with a
 *     fixed price; there is no randomized-reward product.
 *   - No real-money stakes / cash prizes: nothing here pays the player money.
 *
 * The game logic only ever calls these methods through the adapter, so a real
 * adapter can be dropped in later without touching gameplay/UI wiring.
 */

/** Global feature flags. Both default OFF; a build/config may flip them. */
export interface MonetizationFlags {
  /** Enable the rewarded-ad entry points (still no-op until an adapter exists). */
  adsEnabled: boolean;
  /** Enable the IAP entry points (cosmetic products only). */
  iapEnabled: boolean;
}

export const DEFAULT_MONETIZATION_FLAGS: MonetizationFlags = {
  adsEnabled: false,
  iapEnabled: false,
};

/** The only permitted product kind: a cosmetic. No consumables, no power. */
export interface IapProduct {
  id: string;
  /** Must reference a cosmetic id from the cosmetics catalog. */
  cosmeticId: string;
  kind: 'cosmetic';
}

export type PurchaseResult =
  | { ok: true; cosmeticId: string }
  | { ok: false; reason: 'unavailable' | 'cancelled' | 'error' };

export type RewardResult =
  | { ok: true }
  | { ok: false; reason: 'unavailable' | 'no-fill' | 'dismissed' };

/** The adapter surface. Real implementations replace the no-op below. */
export interface MonetizationAdapter {
  readonly flags: MonetizationFlags;
  /** Whether a rewarded ad can currently be shown. */
  isRewardedAdAvailable(): boolean;
  /** Show a rewarded ad; resolves when watched (or immediately if unavailable). */
  showRewardedAd(): Promise<RewardResult>;
  /** List cosmetic-only IAP products. */
  listProducts(): IapProduct[];
  /** Purchase a cosmetic product. */
  purchase(productId: string): Promise<PurchaseResult>;
}

/**
 * The default, shipped adapter: a safe no-op. With flags off, every entry point
 * reports "unavailable". This is intentionally NOT a stub-with-a-TODO: it is the
 * correct behaviour for a build that ships without ads/IAP wired in.
 */
export class NoopMonetizationAdapter implements MonetizationAdapter {
  readonly flags: MonetizationFlags;

  constructor(flags: MonetizationFlags = DEFAULT_MONETIZATION_FLAGS) {
    this.flags = { ...flags };
  }

  isRewardedAdAvailable(): boolean {
    return false;
  }

  async showRewardedAd(): Promise<RewardResult> {
    return { ok: false, reason: 'unavailable' };
  }

  listProducts(): IapProduct[] {
    return [];
  }

  async purchase(): Promise<PurchaseResult> {
    return { ok: false, reason: 'unavailable' };
  }
}

/** The process-wide adapter (no-op by default). Replaceable for tests/real SDK. */
export const monetization: MonetizationAdapter = new NoopMonetizationAdapter();
