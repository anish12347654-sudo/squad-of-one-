/**
 * TitleScene - the main menu (brief section 8).
 *
 * Localized title + tagline (from the branding i18n keys) and the primary menu:
 * Continue / World Map / Shop / Settings / Replays / Credits. Boots audio on
 * first interaction. Emits 'title-ready' for e2e.
 */

import Phaser from 'phaser';
import { getAudioEngine } from '@audio/audio-engine.js';
import { getSave, applySettings, reducedMotion } from './save-context.js';
import { label, button, UI_COLORS, starPath } from './ui-kit.js';
import { createBackdrop, type Backdrop } from '@game/render/backdrop.js';
import { CAMPAIGN_LEVELS } from '@content/index.js';
import { nextLevelId } from '@meta/index.js';

export const SCENE_TITLE = 'ui-title';

export class TitleScene extends Phaser.Scene {
  private backdrop: Backdrop | null = null;

  constructor() {
    super({ key: SCENE_TITLE });
  }

  create(): void {
    applySettings(getSave().settings);
    const { width, height } = this.scale;
    const cx = width / 2;
    this.cameras.main.setBackgroundColor(UI_COLORS.bg);

    // Shared animated backdrop (neon clockwork + rangoli/jaali lattice).
    this.backdrop = createBackdrop(this, { reducedMotion: reducedMotion() });
    this.events.on(Phaser.Scenes.Events.UPDATE, this.onUpdate, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);
    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this);

    // Decorative emblem: a vector star ring (no glyph tofu).
    const emblem = this.add.graphics();
    emblem.fillStyle(UI_COLORS.accent, 0.12);
    starPath(emblem, cx, height * 0.2, 70, 30);
    emblem.fillPath();

    label(this, cx, height * 0.2, 'brand.title', {
      size: 40,
      bold: true,
      name: 'title-text',
      display: true,
      glow: UI_COLORS.accent,
    });
    label(this, cx, height * 0.2 + 46, 'brand.tagline', {
      size: 16,
      color: UI_COLORS.textDim,
      name: 'tagline-text',
    });

    const save = getSave();
    const next = nextLevelId(save, CAMPAIGN_LEVELS);
    const startY = height * 0.38;
    const bw = Math.min(300, width - 60);
    const gap = 46;

    button(this, cx, startY, bw, 40, next ? 'menu.continue' : 'menu.play', () => this.goMap(), {
      color: UI_COLORS.accent2,
      name: 'btn-continue',
    });
    button(this, cx, startY + gap, bw, 40, 'menu.worldMap', () => this.goMap(), { name: 'btn-map' });
    button(this, cx, startY + gap * 2, bw, 40, 'menu.daily', () => this.scene.start('ui-daily'), {
      color: UI_COLORS.gold,
      name: 'btn-daily',
    });
    button(this, cx, startY + gap * 3, bw, 40, 'menu.timeChess', () => this.scene.start('ui-timechess'), {
      name: 'btn-timechess',
    });
    button(this, cx, startY + gap * 4, bw, 40, 'menu.shop', () => this.scene.start('ui-shop'));
    button(this, cx, startY + gap * 5, bw, 40, 'menu.settings', () => this.scene.start('ui-settings'));
    button(this, cx, startY + gap * 6, bw, 40, 'menu.replays', () => this.scene.start('ui-replays'), { name: 'btn-replays' });
    button(this, cx, startY + gap * 7, bw, 40, 'menu.credits', () => this.scene.start('ui-credits'));

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

  private onUpdate(_time: number, delta: number): void {
    this.backdrop?.update(delta);
  }

  private onResize(gameSize: Phaser.Structs.Size): void {
    this.backdrop?.resize(gameSize.width, gameSize.height);
  }

  private onShutdown(): void {
    this.events.off(Phaser.Scenes.Events.UPDATE, this.onUpdate, this);
    this.scale.off(Phaser.Scale.Events.RESIZE, this.onResize, this);
    this.backdrop?.destroy();
    this.backdrop = null;
  }

  private goMap(): void {
    getAudioEngine().sfx('ui');
    this.scene.start('ui-worldmap');
  }
}
