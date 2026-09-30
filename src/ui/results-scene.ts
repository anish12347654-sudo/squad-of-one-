/**
 * ResultsScene (brief section 8 + contract 3.1): the post-level screen. Shows
 * the vector star rating, echoes alive, early-victory / rewrite tallies, the
 * Chrono Shard + XP reward, and an Assist Mode marker when assist was used.
 * Records the result into the save (best stars, currency, XP, mastery, replay).
 */

import Phaser from 'phaser';
import { getAudioEngine } from '@audio/audio-engine.js';
import { getSave, updateSave } from './save-context.js';
import { label, button, drawStars, panel, UI_COLORS } from './ui-kit.js';
import { levelReward, recordLevelResult, addReplay, nextLevelId } from '@meta/index.js';
import { CAMPAIGN_LEVELS, campaignLevelById } from '@content/index.js';
import type { ClassId } from '@sim/index.js';
import type { StarCount } from '@meta/index.js';

export const SCENE_RESULTS = 'ui-results';

export interface ResultsData {
  levelId: string;
  won: boolean;
  stars: number;
  echoesAlive: number;
  earlyVictory: boolean;
  rewritesUsed: number;
  assistUsed: boolean;
  wonOnSlot: number;
  /** classId of the deciding slot for mastery XP (or null). */
  masteryClass: ClassId | null;
  /** Portable replay code for the winning run (optional). */
  replayCode?: string;
}

export class ResultsScene extends Phaser.Scene {
  private resultData!: ResultsData;

  constructor() {
    super({ key: SCENE_RESULTS });
  }

  init(data: ResultsData): void {
    this.resultData = data;
  }

  create(): void {
    const { width, height } = this.scale;
    const cx = width / 2;
    this.cameras.main.setBackgroundColor(UI_COLORS.bg);
    const d = this.resultData;

    // Record the outcome into the save (once).
    let reward = { xp: 0, shards: 0 };
    if (d.won) {
      const save = getSave();
      const firstClear = !(save.levels[d.levelId]?.cleared ?? false);
      const r = levelReward(d.stars as StarCount, firstClear);
      reward = { xp: r.xp, shards: r.shards };
      updateSave((s) => {
        let next = recordLevelResult(s, d.levelId, d.stars, d.assistUsed, r, d.masteryClass);
        if (d.replayCode) {
          next = addReplay(next, {
            levelId: d.levelId,
            stars: d.stars,
            wonOnSlot: d.wonOnSlot,
            code: d.replayCode,
          });
        }
        return next;
      });
      getAudioEngine().sfx('victory');
    }

    label(this, cx, height * 0.16, d.won ? 'results.victory' : 'results.defeat', {
      size: 28,
      bold: true,
      color: d.won ? UI_COLORS.text : '#e05a6b',
      name: 'results-title',
    });

    const lvl = campaignLevelById(d.levelId);
    if (lvl) label(this, cx, height * 0.16 + 34, lvl.nameKey, { size: 14, color: UI_COLORS.textDim });

    drawStars(this, cx, height * 0.32, d.stars, 3, 22, 12);

    const pw = Math.min(320, width - 40);
    panel(this, cx - pw / 2, height * 0.42, pw, 150);
    let y = height * 0.42 + 26;
    label(this, cx, y, 'results.echoesAlive', { size: 14, params: { n: d.echoesAlive } });
    y += 26;
    if (d.earlyVictory) {
      label(this, cx, y, 'results.earlyVictory', { size: 14, color: UI_COLORS.accent2Text });
      y += 26;
    }
    label(this, cx, y, 'results.rewrites', { size: 13, color: UI_COLORS.textDim, params: { n: d.rewritesUsed } });
    y += 24;
    label(this, cx, y, 'results.shards', { size: 13, color: UI_COLORS.accent2Text, params: { n: reward.shards } });
    y += 22;
    label(this, cx, y, 'results.xp', { size: 13, color: UI_COLORS.accentText, params: { n: reward.xp } });
    y += 22;
    if (d.assistUsed) label(this, cx, y, 'results.assist', { size: 12, color: UI_COLORS.textDim });

    // Next / Retry / Map.
    const bY = height - 92;
    if (d.won) {
      const next = nextLevelId(getSave(), CAMPAIGN_LEVELS);
      button(this, cx - 90, bY, 170, 44, 'results.next', () => {
        getAudioEngine().sfx('ui');
        if (next) this.scene.start('GameScene', { levelId: next, from: 'ui-results' });
        else this.scene.start('ui-worldmap');
      });
    } else {
      button(this, cx - 90, bY, 170, 44, 'results.retry', () => {
        getAudioEngine().sfx('ui');
        this.scene.start('GameScene', { levelId: d.levelId, from: 'ui-results' });
      });
    }
    button(this, cx + 90, bY, 170, 44, 'menu.quit', () => {
      getAudioEngine().sfx('ui');
      this.scene.start('ui-worldmap');
    });

    this.game.events.emit('results-ready');
  }
}
