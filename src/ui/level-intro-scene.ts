/**
 * LevelIntroScene (brief section 8): story dialogue panels (1-3 localized
 * lines), the mission objective, and - for boss missions - the boss intro
 * title card, before launching the level. "Begin" starts the GameScene with the
 * chosen level id.
 */

import Phaser from 'phaser';
import { getAudioEngine } from '@audio/audio-engine.js';
import { label, button, panel, UI_COLORS } from './ui-kit.js';
import { campaignLevelById, worldById } from '@content/index.js';

export const SCENE_LEVELINTRO = 'ui-levelintro';

export class LevelIntroScene extends Phaser.Scene {
  private levelId = '';

  constructor() {
    super({ key: SCENE_LEVELINTRO });
  }

  init(data: { levelId?: string }): void {
    this.levelId = data.levelId ?? 'tut-1';
  }

  create(): void {
    const { width, height } = this.scale;
    const cx = width / 2;
    this.cameras.main.setBackgroundColor(UI_COLORS.bg);

    const lvl = campaignLevelById(this.levelId);
    if (!lvl) {
      this.scene.start('ui-worldmap');
      return;
    }
    const world = worldById(lvl.worldId);

    // World-tinted backdrop band.
    if (world) {
      const band = this.add.graphics();
      band.fillStyle(world.palette.accent, 0.14);
      band.fillRect(0, height * 0.16, width, 90);
    }

    label(this, cx, height * 0.2, lvl.nameKey, { size: 28, bold: true, name: 'level-title' });
    if (world) {
      label(this, cx, height * 0.2 + 34, world.nameKey, { size: 14, color: UI_COLORS.textDim });
    }

    // Objective line.
    label(this, cx, height * 0.34, `level.objective.${lvl.objective}`, {
      size: 15,
      color: UI_COLORS.accent2Text,
    });

    // Story panel (1-3 lines).
    const storyY = height * 0.44;
    const pw = Math.min(340, width - 40);
    if (lvl.storyKeys.length > 0) {
      panel(this, cx - pw / 2, storyY - 20, pw, 20 + lvl.storyKeys.length * 26 + 12);
      lvl.storyKeys.forEach((key, i) => {
        label(this, cx, storyY + 4 + i * 26, key, { size: 13, color: UI_COLORS.text, wrap: pw - 28 });
      });
    }

    // Tutorial hint, if this level introduces something new.
    if (lvl.tutorialKey) {
      label(this, cx, height * 0.66, lvl.tutorialKey, {
        size: 12,
        color: UI_COLORS.accentText,
        wrap: pw,
      });
    }

    button(this, cx, height - 100, 220, 48, 'level.intro.continue', () => this.begin(), {
      color: UI_COLORS.accent2,
      name: 'btn-begin',
    });
    button(this, cx, height - 42, 200, 42, 'menu.back', () => {
      getAudioEngine().sfx('ui');
      this.scene.start('ui-worldmap');
    });

    this.game.events.emit('levelintro-ready');
  }

  private begin(): void {
    getAudioEngine().sfx('ui');
    this.scene.start('GameScene', { levelId: this.levelId, from: 'ui-levelintro' });
  }
}
