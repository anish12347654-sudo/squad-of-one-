/**
 * Phaser 4 unified Filters helpers (brief section 8 + context.json).
 *
 * Phaser 4 replaced the v3 FX/postFX system with a unified Filters pipeline.
 * Filters are enabled per game object via `obj.enableFilters()`, after which
 * controllers are added on `obj.filters.internal` (Glow, Barrel, ColorMatrix,
 * Blur, ...). We enable them on the world layer object and use:
 *   - a persistent Glow for the neon "bloom" look, and
 *   - a Barrel + ColorMatrix (desaturate + hue shift) for the chromatic/VHS
 *     rewind transition, toggled on/off.
 *
 * All of this is presentation-only; it never touches the sim. Wrapped in
 * try/catch so a headless/software renderer without filter support degrades
 * gracefully (the game still runs; effects simply no-op).
 */

import Phaser from 'phaser';

/** A game object that supports the Phaser 4 Filters component. */
type Filterable = Phaser.GameObjects.GameObject & {
  enableFilters?: () => unknown;
  filters?: { internal?: Phaser.GameObjects.Components.FilterList } | null;
};

export interface SceneFilters {
  glow: Phaser.Filters.Glow | null;
  barrel: Phaser.Filters.Barrel | null;
  colorMatrix: Phaser.Filters.ColorMatrix | null;
  setRewind(active: boolean, intensity: number): void;
  update(rewindActive: boolean): void;
}

export function installFilters(target: Phaser.GameObjects.GameObject): SceneFilters {
  let glow: Phaser.Filters.Glow | null = null;
  let barrel: Phaser.Filters.Barrel | null = null;
  let colorMatrix: Phaser.Filters.ColorMatrix | null = null;

  try {
    const obj = target as Filterable;
    obj.enableFilters?.();
    const list = obj.filters?.internal;
    if (list) {
      glow = list.addGlow(0x8fb3ff, 1.2, 0.4, 1, false, 4, 8);
      barrel = list.addBarrel(0);
      colorMatrix = list.addColorMatrix();
      if (barrel) barrel.active = false;
      if (colorMatrix) colorMatrix.active = false;
    }
  } catch {
    glow = null;
    barrel = null;
    colorMatrix = null;
  }

  return {
    glow,
    barrel,
    colorMatrix,
    setRewind(active: boolean, intensity: number): void {
      if (barrel) {
        barrel.active = active;
        barrel.amount = active ? 0.6 + intensity * 0.6 : 0;
      }
      if (colorMatrix) {
        colorMatrix.active = active;
        if (active) {
          colorMatrix.colorMatrix.reset();
          colorMatrix.colorMatrix.saturate(-0.5 - intensity * 0.3, false);
          colorMatrix.colorMatrix.hue(180 * intensity, true);
          colorMatrix.colorMatrix.brightness(1.15, true);
        } else {
          colorMatrix.colorMatrix.reset();
        }
      }
    },
    update(rewindActive: boolean): void {
      if (rewindActive && barrel) {
        barrel.amount = 0.7 + Math.sin(performance.now() * 0.05) * 0.15;
      }
    },
  };
}
