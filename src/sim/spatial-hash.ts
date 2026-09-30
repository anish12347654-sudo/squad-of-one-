/**
 * Deterministic uniform-grid spatial hash for broad-phase neighbour queries.
 *
 * The sim uses this to find candidates for melee arcs, heal-range checks and
 * projectile hits without an O(n^2) scan. It is transient (rebuilt each tick
 * from the authoritative entity list) so it is NOT part of the hashed state;
 * determinism comes from the deterministic entity order fed into it.
 *
 * Only integer bucket math (floor) and array iteration are used. Query results
 * are returned in insertion order, which is the deterministic entity order.
 */

export interface SpatialHash {
  readonly cellSize: number;
  readonly buckets: Map<number, number[]>;
}

/** Combine integer cell coords into a single stable key. */
function cellKey(cx: number, cy: number): number {
  // Offset to keep negatives non-negative within a generous arena bound, then
  // pack. Arena coords stay well within +-32768 units / cellSize.
  const OFFSET = 4096;
  return ((cx + OFFSET) << 16) | ((cy + OFFSET) & 0xffff);
}

export function createSpatialHash(cellSize: number): SpatialHash {
  return { cellSize, buckets: new Map<number, number[]>() };
}

export function clearSpatialHash(hash: SpatialHash): void {
  hash.buckets.clear();
}

/** Insert an entity id at world position (x,y). */
export function insert(hash: SpatialHash, id: number, x: number, y: number): void {
  const cx = Math.floor(x / hash.cellSize);
  const cy = Math.floor(y / hash.cellSize);
  const key = cellKey(cx, cy);
  const bucket = hash.buckets.get(key);
  if (bucket) {
    bucket.push(id);
  } else {
    hash.buckets.set(key, [id]);
  }
}

/**
 * Collect ids in all cells overlapping the query circle (centre + radius) into
 * `out`. `out` is cleared first. Returned in deterministic (insertion) order
 * per cell; the caller filters by exact distance. Cells are visited in a fixed
 * (row-major) order so results are order-stable.
 */
export function queryCircle(
  hash: SpatialHash,
  x: number,
  y: number,
  radius: number,
  out: number[],
): number[] {
  out.length = 0;
  const min = hash.cellSize;
  const cxMin = Math.floor((x - radius) / min);
  const cxMax = Math.floor((x + radius) / min);
  const cyMin = Math.floor((y - radius) / min);
  const cyMax = Math.floor((y + radius) / min);
  for (let cx = cxMin; cx <= cxMax; cx++) {
    for (let cy = cyMin; cy <= cyMax; cy++) {
      const bucket = hash.buckets.get(cellKey(cx, cy));
      if (bucket) {
        for (let i = 0; i < bucket.length; i++) {
          out.push(bucket[i] as number);
        }
      }
    }
  }
  return out;
}
