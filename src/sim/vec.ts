/**
 * Deterministic 2D vector + geometry helpers for the pure sim.
 *
 * Positions and velocities are stored as plain JS numbers in "world units"
 * (u). All math here uses only + - * / and Math.sqrt/abs/min/max/floor etc.,
 * which are the determinism-safe operations (see docs/ARCHITECTURE.md). No
 * trig here: angle math lives in ./trig with the committed tables.
 *
 * Determinism note: IEEE-754 double arithmetic with only + - * / sqrt is
 * bit-reproducible across engines, and the FNV-1a hash quantizes to a 1/1024
 * grid, so tiny float noise never reaches the fingerprint.
 */

export interface Vec2 {
  x: number;
  y: number;
}

export function vec(x: number, y: number): Vec2 {
  return { x, y };
}

export function cloneVec(v: Vec2): Vec2 {
  return { x: v.x, y: v.y };
}

export function addScaled(out: Vec2, v: Vec2, s: number): void {
  out.x += v.x * s;
  out.y += v.y * s;
}

/** Squared distance between two points (no sqrt). */
export function distSq(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

/** Euclidean distance. Uses Math.sqrt (allowed in the sim). */
export function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.sqrt(distSq(ax, ay, bx, by));
}

/** True when point (px,py) is within `radius` of centre (cx,cy). */
export function withinRadius(px: number, py: number, cx: number, cy: number, radius: number): boolean {
  return distSq(px, py, cx, cy) <= radius * radius;
}

/** Circle vs circle overlap test (centres + radii). */
export function circlesOverlap(
  ax: number,
  ay: number,
  ar: number,
  bx: number,
  by: number,
  br: number,
): boolean {
  const r = ar + br;
  return distSq(ax, ay, bx, by) <= r * r;
}

/**
 * Point vs axis-aligned box (centre + half extents). Used for hazard/arena
 * bounds checks.
 */
export function pointInAabb(
  px: number,
  py: number,
  cx: number,
  cy: number,
  halfW: number,
  halfH: number,
): boolean {
  return px >= cx - halfW && px <= cx + halfW && py >= cy - halfH && py <= cy + halfH;
}

/** Clamp a scalar into [lo, hi]. */
export function clamp(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value;
}

/**
 * Perpendicular distance from point P to the infinite line through A along
 * unit-ish direction (dx,dy). `dirLen` is the length of (dx,dy). Returns the
 * absolute perpendicular distance. Used for the Ranger's line and the boss
 * charge lane. Only + - * / sqrt used.
 */
export function distToLine(
  px: number,
  py: number,
  ax: number,
  ay: number,
  dx: number,
  dy: number,
  dirLen: number,
): number {
  if (dirLen <= 0) return dist(px, py, ax, ay);
  // Cross product magnitude / |dir|.
  const rx = px - ax;
  const ry = py - ay;
  const cross = rx * dy - ry * dx;
  return Math.abs(cross) / dirLen;
}

/**
 * Projection scalar t of point P onto the ray from A in direction (dx,dy).
 * t is measured in the same units as (dx,dy) length. Used to bound the line
 * hit to a segment [0, length]. Only + - * / used.
 */
export function projectOnDir(
  px: number,
  py: number,
  ax: number,
  ay: number,
  dx: number,
  dy: number,
): number {
  const rx = px - ax;
  const ry = py - ay;
  return rx * dx + ry * dy;
}
