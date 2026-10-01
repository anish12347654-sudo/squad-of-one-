/**
 * Phaser 4 unified Filters helpers (brief section 8 + context.json).
 *
 * Phaser 4 replaced the v3 FX/postFX system with a unified Filters pipeline.
 * Filters live on a Camera's FilterList (`camera.filters.internal`), where the
 * `internal` list post-processes the camera's whole rendered frame. We attach
 * the cinematic bloom/vignette to the GameScene's main camera (NOT a single
 * Graphics object: filtering one object renders only that object's bounds into
 * a render target, which composites to a fraction of the frame on a FIT-scaled
 * canvas and clips the view). Controllers added are Glow, Barrel, ColorMatrix,
 * Blur and Vignette, used as:
 *   - a persistent Glow for the neon "bloom" look (tuned up for a real,
 *     cinematic bloom - outer glow + a soft Blur pass),
 *   - an optional Vignette for cinematic framing, and
 *   - a Barrel + ColorMatrix (desaturate + hue shift) for the chromatic/VHS
 *     rewind transition, toggled on/off.
 *
 * All of this is presentation-only; it never touches the sim. Wrapped in
 * try/catch so a headless/software renderer without filter support degrades
 * gracefully (the game still runs; effects simply no-op). Every Filter API used
 * here is verified against node_modules/phaser/types/phaser.d.ts:
 *   addGlow(color, outerStrength, innerStrength, scale, knockout, quality, distance)
 *   addBlur(quality, x, y, strength, color, steps)
 *   addVignette(x, y, radius, strength, color, blendMode)
 *   addBarrel(amount) / addColorMatrix()
 */

import Phaser from 'phaser';
import { GLOWS } from './colors.js';

/** Anything that exposes a Phaser 4 FilterList we can add controllers to. */
type FilterList = Phaser.GameObjects.Components.FilterList;

/** A camera carrying the Phaser 4 internal/external filter lists. */
type FilterCamera = Phaser.Cameras.Scene2D.Camera & {
  filters?: { internal?: FilterList; external?: FilterList } | null;
};

/** A game object that can opt into per-object filtering (legacy support). */
type FilterableObject = Phaser.GameObjects.GameObject & {
  enableFilters?: () => unknown;
  filters?: { internal?: FilterList } | null;
};

/**
 * Resolve the internal FilterList from a Camera (preferred: full-frame
 * post-processing) or, as a fallback, a filter-capable game object. Cameras
 * expose `filters.internal` directly; game objects need `enableFilters()` first.
 */
function resolveFilterList(
  target: Phaser.Cameras.Scene2D.Camera | Phaser.GameObjects.GameObject,
): FilterList | null | undefined {
  const cam = target as FilterCamera;
  if (cam.filters?.internal) return cam.filters.internal;
  const obj = target as FilterableObject;
  obj.enableFilters?.();
  return obj.filters?.internal;
}

export interface SceneFilters {
  glow: Phaser.Filters.Glow | null;
  barrel: Phaser.Filters.Barrel | null;
  colorMatrix: Phaser.Filters.ColorMatrix | null;
  /** Soft Blur pass that, combined with the Glow, forms the bloom look. */
  bloom: Phaser.Filters.Blur | null;
  /** Cinematic edge-darkening vignette (optional). */
  vignette: Phaser.Filters.Vignette | null;
  setRewind(active: boolean, intensity: number): void;
  /**
   * Tune the bloom/glow intensity in [0,1]. Scenes scale this down (or to 0)
   * when the accessibility "reduced flashing" setting is on.
   */
  setBloom(intensity: number): void;
  update(rewindActive: boolean): void;
}

export interface InstallFiltersOpts {
  /** Base bloom intensity in [0,1] (default 1). */
  bloom?: number;
  /** Add a cinematic vignette (default true). */
  vignette?: boolean;
}

// Camera-level glow is applied to the WHOLE frame, so it must be far gentler
// than an object-level glow (which only touched neon sprites): a strong glow
// over the full frame blurs HUD text into mush. A low outer strength lifts the
// neon edges while keeping text/UI legible.
const BASE_GLOW_OUTER = 0.7;

export function installFilters(
  target: Phaser.Cameras.Scene2D.Camera | Phaser.GameObjects.GameObject,
  opts: InstallFiltersOpts = {},
): SceneFilters {
  let glow: Phaser.Filters.Glow | null = null;
  let barrel: Phaser.Filters.Barrel | null = null;
  let colorMatrix: Phaser.Filters.ColorMatrix | null = null;
  let bloom: Phaser.Filters.Blur | null = null;
  let vignette: Phaser.Filters.Vignette | null = null;

  const baseBloom = opts.bloom ?? 1;
  const wantVignette = opts.vignette ?? true;

  try {
    const list = resolveFilterList(target);
    if (list) {
      // Gentle camera-wide Glow + a very soft 1px Blur = a cinematic bloom that
      // lifts the neon arena/entities while keeping the HUD and text crisp.
      // (A strong Glow/Blur over the full frame reads as "out of focus".)
      glow = list.addGlow(GLOWS.bloom, BASE_GLOW_OUTER, 0.0, 1, false, 6, 8);
      bloom = list.addBlur(1, 1, 1, 0.35, 0xffffff, 2);
      if (wantVignette) {
        vignette = list.addVignette(0.5, 0.5, 0.82, 0.36, 0x05070d);
      }
      // Rewind-only controllers, inactive until setRewind(true).
      barrel = list.addBarrel(0);
      colorMatrix = list.addColorMatrix();
      if (barrel) barrel.active = false;
      if (colorMatrix) colorMatrix.active = false;
    }
  } catch {
    glow = null;
    barrel = null;
    colorMatrix = null;
    bloom = null;
    vignette = null;
  }

  const applyBloom = (intensity: number): void => {
    const k = Math.max(0, Math.min(1, intensity));
    if (glow) {
      glow.outerStrength = BASE_GLOW_OUTER * k;
      glow.active = k > 0.001;
    }
    if (bloom) {
      bloom.strength = 0.35 * k;
      bloom.active = k > 0.001;
    }
  };
  applyBloom(baseBloom);

  return {
    glow,
    barrel,
    colorMatrix,
    bloom,
    vignette,
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
    setBloom(intensity: number): void {
      applyBloom(intensity);
    },
    update(rewindActive: boolean): void {
      if (rewindActive && barrel) {
        barrel.amount = 0.7 + Math.sin(performance.now() * 0.05) * 0.15;
      }
    },
  };
}
