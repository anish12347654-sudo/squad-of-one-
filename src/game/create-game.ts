/**
 * Phaser 4 game bootstrap. Registers the full scene graph: the first-time
 * experience, the menu suite (title / world map / level intro / shop / settings
 * / replays / credits / pause / results) and the core GameScene. Boots into the
 * FTE on a first launch (seenIntro === false), else the title menu.
 */

import Phaser from 'phaser';
import { BRANDING } from './branding.js';
import { GameScene } from './scenes/game-scene.js';
import { getSave, applySettings } from '@ui/save-context.js';
import { FirstTimeExperienceScene } from '@ui/fte-scene.js';
import { TitleScene } from '@ui/title-scene.js';
import { WorldMapScene } from '@ui/world-map-scene.js';
import { LevelIntroScene } from '@ui/level-intro-scene.js';
import { SettingsScene } from '@ui/settings-scene.js';
import { ShopScene } from '@ui/shop-scene.js';
import { ReplaysScene } from '@ui/replays-scene.js';
import { CreditsScene } from '@ui/credits-scene.js';
import { PauseScene } from '@ui/pause-scene.js';
import { ResultsScene } from '@ui/results-scene.js';
import { DailyScene } from '@ui/daily-scene.js';
import { DailyResultsScene } from '@ui/daily-results-scene.js';
import { TimeChessScene } from '@ui/time-chess-scene.js';
import { installUiDevHook } from '@ui/ui-dev-hook.js';

export const GAME_WIDTH = 390;
export const GAME_HEIGHT = 844;

export function createGame(parent: HTMLElement | string): Phaser.Game {
  applySettings(getSave().settings);

  const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    parent,
    title: BRANDING.title,
    backgroundColor: '#0b0f1a',
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: GAME_WIDTH,
      height: GAME_HEIGHT,
    },
    // The FTE is the first scene on a fresh save; otherwise the title menu.
    scene: [
      FirstTimeExperienceScene,
      TitleScene,
      WorldMapScene,
      LevelIntroScene,
      GameScene,
      ResultsScene,
      ShopScene,
      SettingsScene,
      ReplaysScene,
      CreditsScene,
      PauseScene,
      DailyScene,
      DailyResultsScene,
      TimeChessScene,
    ],
    render: {
      roundPixels: false,
    },
  };

  // The FTE scene is first in the array and auto-starts; it self-routes to the
  // title menu immediately when seenIntro is already set.
  const game = new Phaser.Game(config);
  if (__DEV_TOOLS__) {
    installUiDevHook(game);
    // Expose the game for the throttled-CPU perf harness (scripts/perf.ts) to
    // read the live FPS. Dev-only; stripped from the release build.
    (window as unknown as { __SQUAD_GAME?: Phaser.Game }).__SQUAD_GAME = game;
  }
  return game;
}
