/**
 * Haptics adapter (brief section 8): wraps `navigator.vibrate`, gated by the
 * player's Haptics setting. No-ops safely where vibration is unsupported.
 */

/** Named haptic patterns (durations in ms), mapped to vibrate() calls. */
export type HapticKind = 'tap' | 'hit' | 'win' | 'paradox';

const PATTERNS: Record<HapticKind, number | number[]> = {
  tap: 10,
  hit: 25,
  win: [40, 60, 40],
  paradox: [15, 40, 15, 40],
};

let enabled = true;

/** Enable/disable haptics globally (driven by the Haptics setting). */
export function setHapticsEnabled(on: boolean): void {
  enabled = on;
}

/** True if the device exposes a vibration API. */
export function hapticsSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

/** Fire a named haptic pattern if enabled and supported. Safe everywhere. */
export function vibrate(kind: HapticKind): void {
  if (!enabled || !hapticsSupported()) return;
  try {
    navigator.vibrate(PATTERNS[kind]);
  } catch {
    /* ignore unsupported */
  }
}
