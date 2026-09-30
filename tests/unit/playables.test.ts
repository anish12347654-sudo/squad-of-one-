import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  inPlayables,
  playablesSdkVersion,
  playablesFirstFrameReady,
  playablesGameReady,
  playablesSaveData,
  playablesLoadData,
  playablesSendScore,
} from '@platform/playables.js';

/**
 * The Playables adapter is behind the compile-time `PLAYABLES` flag, which is
 * OFF under Vitest (the Vite define is absent). So every entry point MUST be a
 * safe no-op here - proving the standalone PWA / test build never touches the
 * `ytgame` host and makes no external call. (The flag-on forwarding is exercised
 * by the `build:playables` target + manual QA inside the Playables host.)
 */
describe('YouTube Playables adapter (flag off by default)', () => {
  afterEach(() => {
    // Even if a test injects a fake ytgame, the flag-off guard must ignore it.
    delete (globalThis as { ytgame?: unknown }).ytgame;
    vi.restoreAllMocks();
  });

  it('reports not-in-playables and no SDK version', () => {
    expect(inPlayables()).toBe(false);
    expect(playablesSdkVersion()).toBeNull();
  });

  it('lifecycle signals are no-ops that never throw', () => {
    expect(() => playablesFirstFrameReady()).not.toThrow();
    expect(() => playablesGameReady()).not.toThrow();
  });

  it('save/load/score resolve to safe no-op values', async () => {
    await expect(playablesSaveData('{"x":1}')).resolves.toBe(false);
    await expect(playablesLoadData()).resolves.toBeNull();
    await expect(playablesSendScore(1234)).resolves.toBe(false);
  });

  it('ignores an injected ytgame while the flag is off (no external engagement)', async () => {
    const setSavedData = vi.fn().mockResolvedValue(undefined);
    const sendScore = vi.fn().mockResolvedValue(undefined);
    (globalThis as { ytgame?: unknown }).ytgame = {
      IN_PLAYABLES_ENV: true,
      SDK_VERSION: '1.0.0',
      game: { firstFrameReady: vi.fn(), gameReady: vi.fn() },
      engagement: { setSavedData, sendScore, getSavedData: vi.fn().mockResolvedValue('x') },
    };
    // Flag off -> adapter must NOT engage the host.
    expect(inPlayables()).toBe(false);
    await expect(playablesSaveData('data')).resolves.toBe(false);
    await expect(playablesSendScore(10)).resolves.toBe(false);
    expect(setSavedData).not.toHaveBeenCalled();
    expect(sendScore).not.toHaveBeenCalled();
  });
});
