/**
 * Phaser 4 game bootstrap. Separated from main.ts so tests/tools can create a
 * game instance with a custom parent element.
 */

import Phaser from 'phaser';
import { BRANDING } from './branding.js';
import { TitleScene } from './scenes/title-scene.js';
import { GameScene } from './scenes/game-scene.js';

export const GAME_WIDTH = 390;
export const GAME_HEIGHT = 844;

export function createGame(parent: HTMLElement | string): Phaser.Game {
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
    scene: [TitleScene, GameScene],
    // The deterministic sim ignores wall clock; rendering does not need pixel
    // rounding for the M0 title. roundPixels defaults to false in Phaser 4.
    render: {
      roundPixels: false,
    },
  };

  return new Phaser.Game(config);
}
