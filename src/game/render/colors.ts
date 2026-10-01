/**
 * Shared render palette for the game/HUD layers.
 *
 * The flat `COLORS` keys below are preserved verbatim for backward
 * compatibility (GameScene/HUD/VFX read them directly). The visual overhaul
 * (FEAT-001) adds a gradient-ready design-token layer on top:
 *   - GRADIENTS: top/bottom stop pairs for vertical fills (panels, buttons,
 *     backdrops) so surfaces read as lit volumes instead of flat rectangles.
 *   - GLOWS: neon accent colours for bloom/glow filters and soft shadows.
 *   - TINTS: highlight/shadow pairs for bevels and depth.
 * All of this is presentation-only and never touches the sim.
 */
export const COLORS = {
  bg: 0x0b0f1a,
  arena: 0x141a2e,
  arenaEdge: 0x2a3350,
  boss: 0xe05a6b,
  bossCore: 0xff8a95,
  threatLine: 0xff5566,
  telegraph: 0xff5544,
  telegraphSafe: 0xffd24a,
  hpBack: 0x20263c,
  hpFill: 0x5be08a,
  hpFillLow: 0xe05a6b,
  youOutline: 0xffffff,
  text: 0xe8ecff,
  textDim: 0x8a93b8,
  paradox: 0xff2a4d,
  paradoxGlow: 0xff6b8a,
  turret: 0xffd54f,
  interactable: 0x64ffda,
  convergence: 0x9fe3ff,
  shardIcon: 0x64ffda,
} as const;

/** A vertical gradient stop pair ({top, bottom}) for lit-volume fills. */
export interface GradientStops {
  top: number;
  bottom: number;
}

/**
 * Gradient-ready design tokens. Each pair is a lighter top stop and a darker
 * bottom stop so vertical fills read as lit surfaces. Shared by the ui-kit and
 * the GameScene backdrop/HUD.
 */
export const GRADIENTS = {
  /** Deep space backdrop (top slightly lifted, bottom near-black). */
  backdrop: { top: 0x121a30, bottom: 0x070a14 } as GradientStops,
  /** Glass panel surface. */
  panel: { top: 0x1e2846, bottom: 0x111831 } as GradientStops,
  /** Primary (accent) button face. */
  button: { top: 0x223358, bottom: 0x141d33 } as GradientStops,
  /** Hovered button face (brighter). */
  buttonHover: { top: 0x2d4474, bottom: 0x1b2748 } as GradientStops,
  /** Pressed button face (dimmer, pushed-in). */
  buttonActive: { top: 0x18233f, bottom: 0x0e1527 } as GradientStops,
  /** Disabled button face. */
  buttonDisabled: { top: 0x161b2b, bottom: 0x0f131f } as GradientStops,
  /** Gold fill for filled stars. */
  gold: { top: 0xffe08a, bottom: 0xf0a81e } as GradientStops,
  /** Arena floor. */
  arena: { top: 0x1a2340, bottom: 0x0f1526 } as GradientStops,
} as const;

/** Neon glow colours for bloom/glow filters, soft shadows and accent edges. */
export const GLOWS = {
  accent: 0x64b5ff,
  accent2: 0x64ffda,
  gold: 0xffcc4d,
  danger: 0xff5566,
  bloom: 0x8fb3ff,
  shadow: 0x05070d,
} as const;

/** Highlight/shadow tints for bevels and depth. */
export const TINTS = {
  highlight: 0xaecbff,
  shadow: 0x060912,
  innerLight: 0x9fc2ff,
  innerDark: 0x090d18,
} as const;

/** Interpolate an integer 0xRRGGBB colour between a and b by t in [0,1]. */
export function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

/**
 * Paint a vertical gradient into a Graphics-like fill by stacking thin bands.
 * `fill` receives (color, y, bandHeight) for each band; the caller decides how
 * to draw it (rounded rect clip, plain rect, etc.). `steps` controls smoothness
 * (kept modest so this stays cheap for pooled/animated surfaces).
 */
export function gradientBands(
  stops: GradientStops,
  x: number,
  y: number,
  w: number,
  h: number,
  steps: number,
  fill: (color: number, bx: number, by: number, bw: number, bh: number) => void,
): void {
  const n = Math.max(1, Math.floor(steps));
  const bh = h / n;
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1);
    fill(lerpColor(stops.top, stops.bottom, t), x, y + i * bh, w, bh + 1);
  }
}

/** Lighten a colour toward white by amount t in [0,1] (for highlights). */
export function lighten(color: number, t: number): number {
  return lerpColor(color, 0xffffff, t);
}

/** Darken a colour toward black by amount t in [0,1] (for shadows). */
export function darken(color: number, t: number): number {
  return lerpColor(color, 0x000000, t);
}
