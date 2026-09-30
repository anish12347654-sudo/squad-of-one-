/**
 * ReplaysScene (brief section 8): the player's top-20 stored replays, best
 * first. Each entry shows the level name, stars (vector) and the winning loop.
 * Reads StoredReplay entries from the save.
 */

import Phaser from 'phaser';
import { getAudioEngine } from '@audio/audio-engine.js';
import { getSave } from './save-context.js';
import { label, button, drawStars, panel, UI_COLORS } from './ui-kit.js';
import { campaignLevelById } from '@content/index.js';
import { t } from '@i18n/index.js';

export const SCENE_REPLAYS = 'ui-replays';

export class ReplaysScene extends Phaser.Scene {
  constructor() {
    super({ key: SCENE_REPLAYS });
  }

  create(): void {
    const { width, height } = this.scale;
    const cx = width / 2;
    this.cameras.main.setBackgroundColor(UI_COLORS.bg);

    label(this, cx, 34, 'replays.title', { size: 24, bold: true, name: 'replays-title' });

    const replays = getSave().replays;
    const listX = Math.max(20, cx - 180);
    const listW = Math.min(360, width - 40);

    if (replays.length === 0) {
      label(this, cx, height * 0.42, 'replays.empty', { size: 14, color: UI_COLORS.textDim, wrap: listW });
    } else {
      let y = 80;
      for (const r of replays.slice(0, 12)) {
        const lvl = campaignLevelById(r.levelId);
        const levelName = lvl ? t(lvl.nameKey) : r.levelId;
        panel(this, listX, y - 16, listW, 34);
        // Runtime-composed value (localized level name + loop), not a static key.
        this.add
          .text(listX + 12, y, `${levelName}`, {
            fontFamily: 'sans-serif',
            fontSize: '13px',
            color: UI_COLORS.text,
          })
          .setOrigin(0, 0.5)
          .setName('replay-row');
        label(this, listX + 12, y + 12, 'replays.entry', {
          size: 9,
          color: UI_COLORS.textDim,
          origin: 0,
          align: 'left',
          params: { level: levelName, stars: r.stars, slot: r.wonOnSlot + 1 },
        });
        drawStars(this, listX + listW - 56, y, r.stars, 3, 7, 4);
        y += 40;
      }
    }

    button(this, cx, height - 34, 200, 42, 'menu.back', () => {
      getAudioEngine().sfx('ui');
      this.scene.start('ui-title');
    });

    this.game.events.emit('replays-ready');
  }
}
