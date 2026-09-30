/**
 * YouTube Playables adapter (brief 9.7), behind the `PLAYABLES` build flag and
 * OFF by default. It follows Google's Playables SDK surface:
 *   - ytgame.game.firstFrameReady()   - the first frame has rendered
 *   - ytgame.game.gameReady()         - the game is interactive
 *   - ytgame.engagement.setSavedData/getSavedData - cloud save (string blob)
 *   - ytgame.engagement.sendScore(score)          - report a score
 *   - ytgame.IN_PLAYABLES_ENV / ytgame.SDK_VERSION
 * See https://developers.google.com/youtube/gaming/playables/reference/sdk .
 *
 * IMPORTANT: this adapter makes ZERO external network calls. The `ytgame` global
 * is injected by the YouTube host at runtime; we never fetch a script or hit a
 * URL. When not running inside Playables (`IN_PLAYABLES_ENV` false, or the flag
 * off) every method is a safe no-op, so the standalone PWA is unaffected.
 *
 * The adapter is compiled in only when `build:playables` sets `__PLAYABLES__`;
 * in every other build the `PLAYABLES` constant is `false` and the whole thing
 * tree-shakes away.
 */

import { PLAYABLES } from '../dev-flags.js';

/** Minimal typing of the subset of the `ytgame` global we use. */
interface YtGameSdk {
  IN_PLAYABLES_ENV?: boolean;
  SDK_VERSION?: string;
  game?: {
    firstFrameReady?: () => void;
    gameReady?: () => void;
  };
  engagement?: {
    setSavedData?: (data: string) => Promise<void>;
    getSavedData?: () => Promise<string>;
    sendScore?: (score: number) => Promise<void>;
  };
}

declare global {
  interface Window {
    ytgame?: YtGameSdk;
  }
}

function sdk(): YtGameSdk | null {
  if (!PLAYABLES) return null;
  if (typeof window === 'undefined') return null;
  const g = window.ytgame;
  // Only engage when the host actually placed us in the Playables environment.
  if (!g || g.IN_PLAYABLES_ENV !== true) return null;
  return g;
}

/** True when running inside the YouTube Playables environment. */
export function inPlayables(): boolean {
  return sdk() !== null;
}

/** The Playables SDK version string, if available. */
export function playablesSdkVersion(): string | null {
  return sdk()?.SDK_VERSION ?? null;
}

/** Signal that the first frame has been rendered (loading can end). */
export function playablesFirstFrameReady(): void {
  try {
    sdk()?.game?.firstFrameReady?.();
  } catch {
    /* host errors must never break the game */
  }
}

/** Signal that the game is fully loaded and interactive. */
export function playablesGameReady(): void {
  try {
    sdk()?.game?.gameReady?.();
  } catch {
    /* ignore */
  }
}

/** Persist a save blob to the Playables cloud (string). Resolves false on no-op. */
export async function playablesSaveData(data: string): Promise<boolean> {
  const g = sdk();
  if (!g?.engagement?.setSavedData) return false;
  try {
    await g.engagement.setSavedData(data);
    return true;
  } catch {
    return false;
  }
}

/** Load the Playables cloud save blob, or null when unavailable/empty. */
export async function playablesLoadData(): Promise<string | null> {
  const g = sdk();
  if (!g?.engagement?.getSavedData) return null;
  try {
    const data = await g.engagement.getSavedData();
    return data && data.length > 0 ? data : null;
  } catch {
    return null;
  }
}

/** Report a score to YouTube Playables. Resolves false when not available. */
export async function playablesSendScore(score: number): Promise<boolean> {
  const g = sdk();
  if (!g?.engagement?.sendScore) return false;
  try {
    await g.engagement.sendScore(Math.max(0, Math.round(score)));
    return true;
  } catch {
    return false;
  }
}
