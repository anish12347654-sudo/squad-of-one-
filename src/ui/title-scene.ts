/**
 * TitleScene - the main menu (brief section 8).
 *
 * Localized title + tagline (from the branding i18n keys) and the primary menu:
 * Continue / World Map / Shop / Settings / Replays / Credits. Boots audio on
 * first interaction. Emits 'title-ready' for e2e.
 *
 * Premium look (FEAT-002): the shared animated clockwork/rangoli backdrop, a
 * display-font hero title with a neon glow, the glowing animated time-loop lens
 * brand emblem, and a staggered entrance on the menu buttons.
 */

import Phaser from 'phaser';
import { getAudioEngine } from '@audio/audio-engine.js';
import { getSave, applySettings } from './save-context.js';
import { label, button, UI_COLORS } from './ui-kit.js';
import { mountBackdrop, createEmblem, staggerIn } from './scene-backdrop.js';
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

    // Shared animated backdrop (neon clockwork + rangoli/jaali lattice).
    mountBackdrop(this);

    // Glowing animated brand emblem (the time-loop lens: ring + core + echoes).
    createEmblem(this, cx, height * 0.19, { radius: Math.min(58, width * 0.14) });

    label(this, cx, height * 0.2, 'brand.title', {
      size: 42,
      bold: true,
      name: 'title-text',
      display: true,
      glow: UI_COLORS.accent,
    });
    label(this, cx, height * 0.2 + 48, 'brand.tagline', {
      size: 16,
      color: UI_COLORS.textDim,
      name: 'tagline-text',
    });

    const save = getSave();
    const next = nextLevelId(save, CAMPAIGN_LEVELS);
    const startY = height * 0.38;
    const bw = Math.min(300, width - 60);
    const gap = 46;

    const buttons = [
      button(this, cx, startY, bw, 40, next ? 'menu.continue' : 'menu.play', () => this.goMap(), {
        color: UI_COLORS.accent2,
        name: 'btn-continue',
      }),
      button(this, cx, startY + gap, bw, 40, 'menu.worldMap', () => this.goMap(), { name: 'btn-map' }),
      button(this, cx, startY + gap * 2, bw, 40, 'menu.daily', () => this.scene.start('ui-daily'), {
        color: UI_COLORS.gold,
        name: 'btn-daily',
      }),
      button(this, cx, startY + gap * 3, bw, 40, 'menu.timeChess', () => this.scene.start('ui-timechess'), {
        name: 'btn-timechess',
      }),
      button(this, cx, startY + gap * 4, bw, 40, 'menu.shop', () => this.scene.start('ui-shop')),
      button(this, cx, startY + gap * 5, bw, 40, 'menu.settings', () => this.scene.start('ui-settings')),
      button(this, cx, startY + gap * 6, bw, 40, 'menu.replays', () => this.scene.start('ui-replays'), { name: 'btn-replays' }),
      button(this, cx, startY + gap * 7, bw, 40, 'menu.credits', () => this.scene.start('ui-credits')),
    ];
    staggerIn(this, buttons.map((b) => b.container));

    label(this, cx, height - 24, 'menu.tapToStart', { size: 12, color: UI_COLORS.textDim });

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
