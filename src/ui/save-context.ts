/**
 * Shared save context for the UI + game layers (brief sections 8, 9.5).
 *
 * A tiny impure singleton that holds the loaded SaveGame, persists changes, and
 * applies the settings/accessibility fields to the actual runtime (locale +
 * font, audio volumes, haptics). Menus mutate the save through here so every
 * setting is wired to real behaviour.
 */

import { loadSave, persistSave, setHapticsEnabled } from '@platform/index.js';
import { setLocale } from '@i18n/index.js';
import { getAudioEngine } from '@audio/audio-engine.js';
import type { SaveGame, SaveSettings } from '@meta/index.js';

let save: SaveGame = loadSave();

/** The live save. Callers should treat it as read-only and mutate via update(). */
export function getSave(): SaveGame {
  return save;
}

/** Replace the live save (e.g. after a result / import), persist, apply settings. */
export function setSave(next: SaveGame): void {
  save = next;
  persistSave(save);
  applySettings(save.settings);
}

/** Mutate the save in place then persist + apply settings. */
export function updateSave(mutate: (s: SaveGame) => SaveGame): SaveGame {
  save = mutate(save);
  persistSave(save);
  applySettings(save.settings);
  return save;
}

/** Persist without mutating (for callers that edited the object directly). */
export function persist(): void {
  persistSave(save);
}

/**
 * Apply the settings to the runtime: locale (+ font family via i18n) and audio
 * volumes. Called on boot and whenever settings change so every toggle/slider
 * has an immediate, real effect.
 */
export function applySettings(s: SaveSettings): void {
  setLocale(s.locale);
  setHapticsEnabled(s.haptics);
  const audio = getAudioEngine();
  audio.setVolumes({
    master: s.volumeMaster,
    music: s.volumeMusic,
    sfx: s.volumeSfx,
  });
}

/** Multiplier applied to on-screen text for the text-size accessibility option. */
export function textScale(): number {
  switch (save.settings.textSize) {
    case 'small':
      return 0.85;
    case 'large':
      return 1.25;
    default:
      return 1;
  }
}
