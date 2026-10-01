/**
 * PauseScene (brief section 8): a translucent overlay launched on top of the
 * GameScene. Resume / Settings / Quit to Map. Pauses the underlying scene while
 * it is open.
 */

import Phaser from 'phaser';
import { getAudioEngine } from '@audio/audio-engine.js';
import { label, button, panel, UI_COLORS } from './ui-kit.js';

export const SCENE_PAUSE = 'ui-pause';

export class PauseScene extends Phaser.Scene {
  constructor() {
    super({ key: SCENE_PAUSE });
  }

  create(): void {
    const { width, height } = this.scale;
    const cx = width / 2;

    const dim = this.add.graphics();
    dim.fillStyle(0x05070d, 0.82);
    dim.fillRect(0, 0, width, height);
    // Soft accent vignette so the overlay reads as a lit modal, not a flat scrim.
    dim.fillStyle(UI_COLORS.accent, 0.05);
    dim.fillCircle(cx, height * 0.42, Math.max(width, height) * 0.5);

    // A glass card framing the pause menu.
    const cardW = Math.min(300, width - 60);
    const cardH = 300;
    panel(this, cx - cardW / 2, height * 0.3 - 36, cardW, cardH, UI_COLORS.panel, { accent: UI_COLORS.accent });

    label(this, cx, height * 0.3, 'menu.pause', {
      size: 32,
      bold: true,
      display: true,
      glow: UI_COLORS.accent,
      name: 'pause-title',
    });

    button(this, cx, height * 0.45, 240, 46, 'menu.resume', () => this.resume(), {
      color: UI_COLORS.accent2,
      name: 'btn-resume',
    });
    button(this, cx, height * 0.45 + 58, 240, 46, 'menu.settings', () => {
      this.scene.start('ui-settings');
    });
    button(this, cx, height * 0.45 + 116, 240, 46, 'menu.quit', () => {
      getAudioEngine().sfx('ui');
      this.scene.stop('GameScene');
      this.scene.start('ui-worldmap');
    });

    this.input.keyboard?.on('keydown-ESC', () => this.resume());
    this.game.events.emit('pause-ready');
  }

  private resume(): void {
    getAudioEngine().sfx('ui');
    this.scene.stop();
    this.scene.resume('GameScene');
  }
}
