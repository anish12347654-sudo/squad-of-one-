/**
 * DailyScene (brief section 6.2): the Daily Paradox lobby. Today's date seeds a
 * deterministic level + two modifiers (computed OUTSIDE the sim). Shows the
 * challenge, the local best, and launches the modified level in GameScene.
 * All strings via t().
 */

import Phaser from 'phaser';
import { getAudioEngine } from '@audio/audio-engine.js';
import { getSave } from './save-context.js';
import { label, button, panel, UI_COLORS } from './ui-kit.js';
import { mountBackdrop } from './scene-backdrop.js';
import { t } from '@i18n/index.js';
import { resolveDaily, dateKeyOf, campaignLevelById, scoreDaily } from '@content/index.js';
import type { DailyChallenge } from '@content/index.js';
import { LevelRunner } from '@sim/index.js';
import { ALL_BOTS } from '@content/bots.js';

export const SCENE_DAILY = 'ui-daily';

declare global {
  interface Window {
    __SQUAD_DAILY?: { playToResult(): void };
  }
}

export class DailyScene extends Phaser.Scene {
  private challenge!: DailyChallenge;

  constructor() {
    super({ key: SCENE_DAILY });
  }

  /** Optional injected date key (dev/e2e); defaults to today's UTC date. */
  init(data: { dateKey?: string }): void {
    const dateKey = data.dateKey ?? dateKeyOf(new Date());
    this.challenge = resolveDaily(dateKey);
  }

  create(): void {
    const { width, height } = this.scale;
    const cx = width / 2;
    this.cameras.main.setBackgroundColor(UI_COLORS.bg);
    mountBackdrop(this, { accent: UI_COLORS.gold, accent2: UI_COLORS.accent2 });

    label(this, cx, 40, 'daily.title', { size: 28, bold: true, display: true, glow: UI_COLORS.gold, name: 'daily-title' });
    label(this, cx, 70, 'daily.subtitle', { size: 12, color: UI_COLORS.textDim, wrap: width - 40 });
    label(this, cx, 96, 'daily.date', { size: 12, color: UI_COLORS.accentText, params: { date: this.challenge.dateKey } });

    const lvl = campaignLevelById(this.challenge.levelId);
    const levelName = lvl ? t(lvl.nameKey) : this.challenge.levelId;

    const boxW = Math.min(340, width - 32);
    panel(this, cx - boxW / 2, 128, boxW, 210);
    label(this, cx, 150, 'daily.level', { size: 15, params: { level: levelName } });
    label(this, cx, 176, 'daily.modifiers', { size: 13, color: UI_COLORS.accent2Text, bold: true });

    let y = 202;
    for (const m of this.challenge.modifiers) {
      label(this, cx, y, m.nameKey, { size: 14, bold: true });
      label(this, cx, y + 18, m.descKey, { size: 11, color: UI_COLORS.textDim, wrap: boxW - 30 });
      y += 46;
    }

    label(this, cx, 316, 'daily.seed', { size: 10, color: UI_COLORS.textDim, params: { seed: this.challenge.seed } });

    const best = getSave().dailyBest[this.challenge.dateKey];
    if (best !== undefined) {
      label(this, cx, 356, 'daily.best', { size: 14, color: '#ffcc4d', params: { score: best }, name: 'daily-best' });
    } else {
      label(this, cx, 356, 'daily.noBest', { size: 13, color: UI_COLORS.textDim, name: 'daily-best' });
    }

    button(this, cx, height - 110, 240, 48, 'daily.play', () => this.playDaily(), {
      color: UI_COLORS.accent2,
      name: 'btn-play-daily',
    });
    button(this, cx, height - 46, 200, 40, 'menu.back', () => {
      getAudioEngine().sfx('ui');
      this.scene.start('ui-title');
    });

    this.installDevHook();
    this.game.events.emit('daily-ready');
  }

  private playDaily(): void {
    getAudioEngine().sfx('ui');
    this.scene.start('GameScene', {
      from: 'ui-daily',
      def: this.challenge.def,
      daily: {
        dateKey: this.challenge.dateKey,
        seed: this.challenge.seed,
        levelId: this.challenge.levelId,
        modifierNameKeys: this.challenge.modifiers.map((m) => m.nameKey),
      },
    });
  }

  /**
   * Dev/e2e: run the daily headlessly with its reference plan and jump straight
   * to the Daily results scene with a real computed score. Deterministic; no
   * wall-clock gameplay loop (avoids flakiness in headless CI).
   */
  private installDevHook(): void {
    // Compile-time gated (see time-chess-scene): stripped from the release build.
    if (!__DEV_TOOLS__) return;
    if (typeof window === 'undefined') return;
    window.__SQUAD_DAILY = {
      playToResult: () => this.playToResult(),
    };
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (typeof window !== 'undefined') delete window.__SQUAD_DAILY;
    });
  }

  private playToResult(): void {
    const runner = new LevelRunner(this.challenge.def);
    const plan = this.challenge.classPlan;
    let planIndex = 0;
    let guard = 0;
    const maxTicks = this.challenge.def.slotCount * (this.challenge.def.loopLength + 4);
    while (runner.result === 'in_progress' && guard < maxTicks) {
      guard++;
      if (runner.needsClassChoice()) {
        const cls = plan[planIndex++] ?? plan[plan.length - 1];
        if (!cls) break;
        runner.chooseClass(cls);
        continue;
      }
      if (runner.awaitingDecision()) break;
      const slot = runner.recordingSlot;
      const cls = runner.slotClasses[slot];
      const bot = cls ? ALL_BOTS[cls] : undefined;
      const frame = bot
        ? bot(runner.state, slot, runner.state.tick)
        : { moveX: 0, moveY: 0, aim: 0, aimActive: false, buttons: 0 };
      runner.tickWith(frame);
    }
    const won = runner.result === 'won';
    const stars = runner.computeStars();
    const score = scoreDaily({
      won,
      winTick: runner.state.tick,
      loopLength: this.challenge.def.loopLength,
      echoesAlive: stars.echoesAlive,
      rewritesUsed: stars.rewritesUsed,
      wonOnSlot: runner.wonOnSlot,
      slotCount: this.challenge.def.slotCount,
    });
    this.scene.start('ui-daily-results', {
      dateKey: this.challenge.dateKey,
      seed: this.challenge.seed,
      levelId: this.challenge.levelId,
      modifierNameKeys: this.challenge.modifiers.map((m) => m.nameKey),
      won,
      score,
      stars: stars.count,
      echoesAlive: stars.echoesAlive,
      rewritesUsed: stars.rewritesUsed,
      wonOnSlot: runner.wonOnSlot,
    });
  }
}
