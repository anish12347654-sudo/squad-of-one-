/**
 * FNV-1a 32-bit hashing over a quantized serialization of sim state.
 *
 * The hash is the determinism fingerprint: two runs with identical inputs must
 * produce identical per-tick hash sequences. To make hashing stable regardless
 * of how a number is stored (float vs int), every number is quantized to a
 * fixed integer grid before it enters the hash. Object keys are visited in a
 * total (sorted) order so serialization order never affects the result.
 */

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** Default quantization scale: 1/1024 units. See docs/ARCHITECTURE.md. */
export const QUANTIZE_SCALE = 1024;

/** A running FNV-1a hash accumulator. */
export interface Hasher {
  hash: number;
}

export function createHasher(): Hasher {
  return { hash: FNV_OFFSET_BASIS >>> 0 };
}

function mixByte(h: number, byte: number): number {
  const x = (h ^ (byte & 0xff)) >>> 0;
  // FNV prime multiply via Math.imul to stay in 32-bit lane.
  return Math.imul(x, FNV_PRIME) >>> 0;
}

/** Fold a single 32-bit integer (little-endian bytes) into the hash. */
export function hashUint32(hasher: Hasher, value: number): void {
  const v = value >>> 0;
  let h = hasher.hash;
  h = mixByte(h, v & 0xff);
  h = mixByte(h, (v >>> 8) & 0xff);
  h = mixByte(h, (v >>> 16) & 0xff);
  h = mixByte(h, (v >>> 24) & 0xff);
  hasher.hash = h >>> 0;
}

/**
 * Quantize a number to the integer grid and fold it in. NaN and infinities are
 * mapped to fixed sentinels so they hash deterministically instead of poisoning
 * the result. The sign is preserved through a 32-bit two's-complement cast.
 */
export function hashNumber(hasher: Hasher, value: number, scale: number = QUANTIZE_SCALE): void {
  let q: number;
  if (Number.isNaN(value)) {
    q = 0x7fffffff;
  } else if (value === Infinity) {
    q = 0x7ffffffe;
  } else if (value === -Infinity) {
    q = -0x7ffffffe;
  } else {
    q = Math.round(value * scale) | 0;
  }
  hashUint32(hasher, q | 0);
}

/** Fold a UTF-16 string in, length-prefixed to avoid boundary collisions. */
export function hashString(hasher: Hasher, value: string): void {
  hashUint32(hasher, value.length);
  for (let i = 0; i < value.length; i++) {
    hashUint32(hasher, value.charCodeAt(i));
  }
}

/** Fold a boolean in. */
export function hashBool(hasher: Hasher, value: boolean): void {
  hashUint32(hasher, value ? 1 : 0);
}

/**
 * Recursively fold an arbitrary JSON-like value in with total-order key
 * traversal. Supported: number, string, boolean, null, arrays, plain objects.
 * Functions/undefined are treated as a null sentinel.
 */
export function hashValue(hasher: Hasher, value: unknown, scale: number = QUANTIZE_SCALE): void {
  if (value === null || value === undefined) {
    hashUint32(hasher, 0);
    return;
  }
  const t = typeof value;
  if (t === 'number') {
    hashUint32(hasher, 1);
    hashNumber(hasher, value as number, scale);
  } else if (t === 'boolean') {
    hashUint32(hasher, 2);
    hashBool(hasher, value as boolean);
  } else if (t === 'string') {
    hashUint32(hasher, 3);
    hashString(hasher, value as string);
  } else if (Array.isArray(value)) {
    hashUint32(hasher, 4);
    hashUint32(hasher, value.length);
    for (const item of value) {
      hashValue(hasher, item, scale);
    }
  } else if (t === 'object') {
    hashUint32(hasher, 5);
    const keys = Object.keys(value as Record<string, unknown>).sort();
    hashUint32(hasher, keys.length);
    for (const key of keys) {
      hashString(hasher, key);
      hashValue(hasher, (value as Record<string, unknown>)[key], scale);
    }
  } else {
    hashUint32(hasher, 0);
  }
}

/** Convenience: hash a whole value in one call and return the digest. */
export function hashState(value: unknown, scale: number = QUANTIZE_SCALE): number {
  const hasher = createHasher();
  hashValue(hasher, value, scale);
  return hasher.hash >>> 0;
}

/** Format a hash as an 8-char lowercase hex string. */
export function hashToHex(hash: number): string {
  return (hash >>> 0).toString(16).padStart(8, '0');
}
