/**
 * Dev-only UI hook (brief section 10, e2e). Exposes the active menu scene key
 * and lets automation switch scenes deterministically without synthesising
 * pointer events for every button. Impure (touches window); never used by live
 * play. Mirrors the gameplay dev hook (window.__SQUAD) at the menu layer.
 */

import type Phaser from 'phaser';

export interface SquadUiGlobal {
  /** The key of the currently active UI/menu scene (or the game scene). */
  scene(): string;
  /** Start a menu scene by key (e.g. 'ui-shop'). */
  start(key: string): void;
  /** Open the level intro for a campaign level id. */
  startLevel(levelId: string): void;
  /** Launch the GameScene directly on a campaign level (skips the intro). */
  beginLevel(levelId: string): void;
}

declare global {
  interface Window {
    __SQUAD_UI?: SquadUiGlobal;
  }
}

const UI_SCENE_KEYS = [
  'ui-fte',
  'ui-title',
  'ui-worldmap',
  'ui-levelintro',
  'ui-shop',
  'ui-settings',
  'ui-replays',
  'ui-credits',
  'ui-pause',
  'ui-results',
  'ui-daily',
  'ui-daily-results',
  'ui-timechess',
  'GameScene',
];

/** Install the UI dev hook against a running game. */
export function installUiDevHook(game: Phaser.Game): void {
  if (typeof window === 'undefined') return;
  const api: SquadUiGlobal = {
    scene(): string {
      for (const key of UI_SCENE_KEYS) {
        const s = game.scene.getScene(key);
        if (s && game.scene.isActive(key)) return key;
      }
      return '';
    },
    start(key: string): void {
      // Stop any active UI scene, then start the requested one.
      for (const k of UI_SCENE_KEYS) {
        if (game.scene.isActive(k)) game.scene.stop(k);
      }
      game.scene.start(key);
    },
    startLevel(levelId: string): void {
      for (const k of UI_SCENE_KEYS) {
        if (game.scene.isActive(k)) game.scene.stop(k);
      }
      game.scene.start('ui-levelintro', { levelId });
    },
    beginLevel(levelId: string): void {
      for (const k of UI_SCENE_KEYS) {
        if (game.scene.isActive(k)) game.scene.stop(k);
      }
      game.scene.start('GameScene', { levelId, from: 'ui-dev' });
    },
  };
  window.__SQUAD_UI = api;
}
