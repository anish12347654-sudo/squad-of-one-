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
import { t } from '@i18n/index.js';
import { exportVictoryClip, exportResultCard, copyToClipboard } from './share-actions.js';
import type { ResultCardData } from '@platform/index.js';

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
  /** Portable replay code for the winning run (optional; used by share + save). */
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

    // Share options (M4): export clip, result card, and copy the replay code.
    if (d.won) {
      const sy = height - 176;
      button(this, cx - 100, sy, 130, 38, 'share.clip', () => {
        getAudioEngine().sfx('ui');
        this.toast('share.exporting');
        void exportVictoryClip(this.game).then((key) => this.toast(key));
      }, { color: UI_COLORS.accent2, name: 'btn-share-clip' });
      button(this, cx + 40, sy, 130, 38, 'share.card', () => {
        getAudioEngine().sfx('ui');
        void exportResultCard(this.resultCard(lvl ? t(lvl.nameKey) : d.levelId)).then((key) => this.toast(key));
      }, { name: 'btn-share-card' });
      if (d.replayCode) {
        const code = d.replayCode;
        button(this, cx, sy + 44, 220, 34, 'share.copyCode', () => {
          getAudioEngine().sfx('ui');
          void copyToClipboard(code).then((ok) => this.toast(ok ? 'replays.codeCopied' : 'share.downloaded'));
        }, { name: 'btn-copy-code' });
      }
    }

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

  private toastLabel: Phaser.GameObjects.Text | null = null;

  /** Show a small localized status line (share progress / outcome). */
  private toast(key: string): void {
    const { width, height } = this.scale;
    this.toastLabel?.destroy();
    this.toastLabel = label(this, width / 2, height - 24, key, {
      size: 12,
      color: UI_COLORS.accent2Text,
      name: 'results-toast',
    });
  }

  /** Build the result-card payload from the current result data. */
  private resultCard(levelName: string): ResultCardData {
    const d = this.resultData;
    return {
      title: t('results.victory'),
      levelName,
      stars: d.stars,
      maxStars: 3,
      rows: [
        { label: t('results.echoesAlive', { n: d.echoesAlive }), value: `${d.echoesAlive}` },
        { label: t('results.rewrites', { n: d.rewritesUsed }), value: `${d.rewritesUsed}` },
      ],
      seedText: t('common.slot', { n: d.wonOnSlot + 1 }),
      footer: t('brand.title'),
      accent: 0x64b5ff,
    };
  }
}
