/**
 * CreditsScene (brief section 8): lists the bundled OFL fonts and the CC0 /
 * in-engine asset provenance. All text localized.
 */

import Phaser from 'phaser';
import { getAudioEngine } from '@audio/audio-engine.js';
import { label, button, panel, UI_COLORS } from './ui-kit.js';

export const SCENE_CREDITS = 'ui-credits';

export class CreditsScene extends Phaser.Scene {
  constructor() {
    super({ key: SCENE_CREDITS });
  }

  create(): void {
    const { width, height } = this.scale;
    const cx = width / 2;
    this.cameras.main.setBackgroundColor(UI_COLORS.bg);

    label(this, cx, 40, 'credits.title', { size: 26, bold: true, name: 'credits-title' });
    label(this, cx, 74, 'brand.title', { size: 18, bold: true, color: UI_COLORS.accentText });

    const pw = Math.min(340, width - 40);
    panel(this, cx - pw / 2, height * 0.28, pw, 180);
    const lines = ['credits.fonts', 'credits.roster', 'credits.cc0', 'credits.thanks'];
    lines.forEach((key, i) => {
      label(this, cx, height * 0.28 + 28 + i * 42, key, {
        size: 13,
        color: i === lines.length - 1 ? UI_COLORS.accent2Text : UI_COLORS.text,
        wrap: pw - 28,
      });
    });

    button(this, cx, height - 40, 200, 44, 'menu.back', () => {
      getAudioEngine().sfx('ui');
      this.scene.start('ui-title');
    });

    this.game.events.emit('credits-ready');
  }
}
