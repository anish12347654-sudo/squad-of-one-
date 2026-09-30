/**
 * Shared render palette for the game/HUD layers.
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
