/**
 * WorldMapScene (brief section 6.1): the campaign map with per-level stars and
 * linear unlock gates, grouped by world. Selecting an unlocked level opens the
 * Level Intro (story + objective + boss title card). Reads progression from the
 * save; all text is localized.
 */

import Phaser from 'phaser';
import { getAudioEngine } from '@audio/audio-engine.js';
import { getSave } from './save-context.js';
import { label, button, drawStars, panel, UI_COLORS } from './ui-kit.js';
import { CAMPAIGN_LEVELS, WORLDS } from '@content/index.js';
import { levelStatuses, totalStars, maxStars } from '@meta/index.js';

export const SCENE_WORLDMAP = 'ui-worldmap';

export class WorldMapScene extends Phaser.Scene {
  constructor() {
    super({ key: SCENE_WORLDMAP });
  }

  create(): void {
    const { width, height } = this.scale;
    const cx = width / 2;
    this.cameras.main.setBackgroundColor(UI_COLORS.bg);

    const save = getSave();
    const statuses = levelStatuses(save, CAMPAIGN_LEVELS);

    label(this, cx, 40, 'map.title', { size: 26, bold: true, name: 'map-title' });
    label(this, cx, 70, 'map.progress', {
      size: 14,
      color: UI_COLORS.accent2Text,
      params: { stars: totalStars(save, CAMPAIGN_LEVELS), max: maxStars(CAMPAIGN_LEVELS) },
    });

    // Scrollable content is unnecessary at these counts; lay out compactly.
    const marginTop = 100;
    const rowH = 34;
    const worldGap = 14;
    let y = marginTop;
    const listW = Math.min(360, width - 30);
    const listX = cx - listW / 2;

    for (const world of WORLDS) {
      const levels = CAMPAIGN_LEVELS.filter((l) => l.worldId === world.id);
      if (levels.length === 0) continue;
      // World header bar.
      const hg = this.add.graphics();
      hg.fillStyle(world.palette.accent, 0.18);
      hg.fillRoundedRect(listX, y - 12, listW, 24, 6);
      label(this, listX + 12, y, world.nameKey, { size: 14, bold: true, origin: 0, align: 'left' });
      y += 26;

      for (const lvl of levels) {
        const st = statuses.find((s) => s.id === lvl.id)!;
        const rowY = y;
        panel(this, listX, rowY - rowH / 2 + 2, listW, rowH - 6, st.unlocked ? UI_COLORS.panel : 0x121626);

        if (st.unlocked) {
          label(this, listX + 12, rowY, lvl.nameKey, { size: 13, origin: 0, align: 'left' });
          label(this, listX + 12, rowY + 12, `level.objective.${lvl.objective}`, {
            size: 9,
            color: UI_COLORS.textDim,
            origin: 0,
            align: 'left',
          });
          drawStars(this, listX + listW - 60, rowY, st.bestStars, 3, 7, 4);
          const zone = this.add
            .zone(listX + listW / 2, rowY, listW, rowH)
            .setOrigin(0.5)
            .setInteractive({ useHandCursor: true });
          zone.on('pointerdown', () => this.openLevel(lvl.id));
        } else {
          label(this, listX + 12, rowY, 'common.locked', {
            size: 12,
            color: UI_COLORS.textDim,
            origin: 0,
            align: 'left',
          });
          // Padlock as a small vector rectangle (no glyph).
          const lock = this.add.graphics();
          lock.fillStyle(UI_COLORS.panelEdge, 1);
          lock.fillRoundedRect(listX + listW - 30, rowY - 6, 12, 12, 3);
        }
        y += rowH;
      }
      y += worldGap;
    }

    button(this, cx, height - 34, 200, 42, 'menu.back', () => {
      getAudioEngine().sfx('ui');
      this.scene.start('ui-title');
    });

    this.game.events.emit('worldmap-ready');
  }

  private openLevel(levelId: string): void {
    getAudioEngine().sfx('ui');
    this.scene.start('ui-levelintro', { levelId });
  }
}
