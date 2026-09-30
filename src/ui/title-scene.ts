/**
 * TitleScene - the main menu (brief section 8).
 *
 * Localized title + tagline (from the branding i18n keys) and the primary menu:
 * Continue / World Map / Shop / Settings / Replays / Credits. Boots audio on
 * first interaction. Emits 'title-ready' for e2e.
 */

import Phaser from 'phaser';
import { getAudioEngine } from '@audio/audio-engine.js';
import { getSave, applySettings } from './save-context.js';
import { label, button, UI_COLORS, starPath } from './ui-kit.js';
import { CAMPAIGN_LEVELS } from '@content/index.js';
import { nextLevelId } from '@meta/index.js';

export const SCENE_TITLE = 'ui-title';

export class TitleScene extends Phaser.Scene {
  constructor() {
    super({ key: SCENE_TITLE });
  }

  create(): void {
    applySettings(getSave().settings);
    const { width, height } = this.scale;
    const cx = width / 2;
    this.cameras.main.setBackgroundColor(UI_COLORS.bg);

    // Decorative emblem: a vector star ring (no glyph tofu).
    const emblem = this.add.graphics();
    emblem.fillStyle(UI_COLORS.accent, 0.12);
    starPath(emblem, cx, height * 0.2, 70, 30);
    emblem.fillPath();

    label(this, cx, height * 0.2, 'brand.title', { size: 40, bold: true, name: 'title-text' });
    label(this, cx, height * 0.2 + 46, 'brand.tagline', {
      size: 16,
      color: UI_COLORS.textDim,
      name: 'tagline-text',
    });

    const save = getSave();
    const next = nextLevelId(save, CAMPAIGN_LEVELS);
    const startY = height * 0.42;
    const bw = Math.min(300, width - 60);
    const gap = 58;

    button(this, cx, startY, bw, 46, next ? 'menu.continue' : 'menu.play', () => this.goMap(), {
      color: UI_COLORS.accent2,
      name: 'btn-continue',
    });
    button(this, cx, startY + gap, bw, 46, 'menu.worldMap', () => this.goMap(), { name: 'btn-map' });
    button(this, cx, startY + gap * 2, bw, 46, 'menu.shop', () => this.scene.start('ui-shop'));
    button(this, cx, startY + gap * 3, bw, 46, 'menu.settings', () => this.scene.start('ui-settings'));
    button(this, cx, startY + gap * 4, bw, 46, 'menu.replays', () => this.scene.start('ui-replays'));
    button(this, cx, startY + gap * 5, bw, 46, 'menu.credits', () => this.scene.start('ui-credits'));

    label(this, cx, height - 30, 'menu.tapToStart', { size: 12, color: UI_COLORS.textDim });

    const unlock = (): void => {
      const audio = getAudioEngine();
      audio.unlock();
      audio.startMusic();
    };
    this.input.once('pointerdown', unlock);
    this.input.keyboard?.once('keydown', unlock);

    this.game.events.emit('title-ready');
  }

  private goMap(): void {
    getAudioEngine().sfx('ui');
    this.scene.start('ui-worldmap');
  }
}
