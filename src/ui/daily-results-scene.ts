/**
 * DailyResultsScene (brief section 6.2): shows the Daily Paradox score, records
 * the local best, and offers a shareable PNG result card. All strings via t().
 */

import Phaser from 'phaser';
import { getAudioEngine } from '@audio/audio-engine.js';
import { updateSave } from './save-context.js';
import { label, button, drawStars, panel, UI_COLORS } from './ui-kit.js';
import { t } from '@i18n/index.js';
import { recordDailyResult } from '@meta/index.js';
import { campaignLevelById } from '@content/index.js';
import { exportResultCard } from './share-actions.js';
import type { ResultCardData } from '@platform/index.js';

export const SCENE_DAILY_RESULTS = 'ui-daily-results';

export interface DailyResultsData {
  dateKey: string;
  seed: number;
  levelId: string;
  modifierNameKeys: string[];
  won: boolean;
  score: number;
  stars: number;
  echoesAlive: number;
  rewritesUsed: number;
  wonOnSlot: number;
}

export class DailyResultsScene extends Phaser.Scene {
  private resultData!: DailyResultsData;
  private newBest = false;

  constructor() {
    super({ key: SCENE_DAILY_RESULTS });
  }

  init(data: DailyResultsData): void {
    this.resultData = data;
  }

  create(): void {
    const { width, height } = this.scale;
    const cx = width / 2;
    this.cameras.main.setBackgroundColor(UI_COLORS.bg);
    const d = this.resultData;

    // Record the local best (once).
    updateSave((s) => {
      const res = recordDailyResult(s, d.dateKey, d.score);
      this.newBest = res.newBest;
      return res.save;
    });

    label(this, cx, height * 0.14, d.won ? 'results.victory' : 'results.defeat', {
      size: 26,
      bold: true,
      color: d.won ? UI_COLORS.text : UI_COLORS.dangerText,
      name: 'daily-results-title',
    });
    label(this, cx, height * 0.14 + 32, 'daily.title', { size: 13, color: UI_COLORS.textDim });

    drawStars(this, cx, height * 0.3, d.stars, 3, 20, 12);

    const pw = Math.min(320, width - 40);
    panel(this, cx - pw / 2, height * 0.4, pw, 140);
    let y = height * 0.4 + 26;
    label(this, cx, y, 'daily.score', { size: 18, bold: true, color: '#ffcc4d', params: { score: d.score }, name: 'daily-score' });
    y += 30;
    if (this.newBest) {
      label(this, cx, y, 'daily.newBest', { size: 13, color: UI_COLORS.accent2Text });
      y += 26;
    }
    label(this, cx, y, 'results.echoesAlive', { size: 13, params: { n: d.echoesAlive } });
    y += 24;
    label(this, cx, y, 'results.rewrites', { size: 12, color: UI_COLORS.textDim, params: { n: d.rewritesUsed } });

    // Share result card.
    button(this, cx, height - 150, 220, 42, 'daily.share', () => {
      getAudioEngine().sfx('ui');
      this.toast('share.exporting');
      void exportResultCard(this.card()).then((key) => this.toast(key));
    }, { color: UI_COLORS.accent2, name: 'btn-daily-share' });

    button(this, cx, height - 92, 200, 44, 'menu.quit', () => {
      getAudioEngine().sfx('ui');
      this.scene.start('ui-title');
    });

    this.game.events.emit('daily-results-ready');
  }

  private toastLabel: Phaser.GameObjects.Text | null = null;
  private toast(key: string): void {
    const { width, height } = this.scale;
    this.toastLabel?.destroy();
    this.toastLabel = label(this, width / 2, height - 30, key, { size: 12, color: UI_COLORS.accent2Text, name: 'daily-toast' });
  }

  private card(): ResultCardData {
    const d = this.resultData;
    const lvl = campaignLevelById(d.levelId);
    const levelName = lvl ? t(lvl.nameKey) : d.levelId;
    const mods = d.modifierNameKeys.map((k) => t(k)).join(' + ');
    return {
      title: t('daily.title'),
      levelName: `${levelName} · ${mods}`,
      stars: d.stars,
      maxStars: 3,
      rows: [
        { label: t('daily.score', { score: d.score }), value: `${d.score}` },
        { label: t('results.echoesAlive', { n: d.echoesAlive }), value: `${d.echoesAlive}` },
      ],
      seedText: t('daily.seed', { seed: d.seed }),
      footer: `${t('brand.title')} · ${d.dateKey}`,
      accent: 0xffcc4d,
    };
  }
}
