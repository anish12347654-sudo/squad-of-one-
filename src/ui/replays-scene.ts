/**
 * ReplaysScene (brief sections 8 + 6.4): the player's top stored replays plus a
 * replay-code box. You can paste a `/#r=<code>` code, Load & Play it back
 * deterministically, or "Beat This Run" to start the same level fresh against
 * that score. Version/content mismatch shows a clear localized message and
 * never desyncs silently.
 *
 * Reads StoredReplay entries from the save; all strings via t().
 */

import Phaser from 'phaser';
import { getAudioEngine } from '@audio/audio-engine.js';
import { getSave } from './save-context.js';
import { label, button, drawStars, panel, UI_COLORS } from './ui-kit.js';
import { campaignLevelById } from '@content/index.js';
import { t } from '@i18n/index.js';
import { decodeForThisBuild, playbackFrom } from '@game/replay-link.js';
import type { ReplayPlayback } from '@game/replay-link.js';

export const SCENE_REPLAYS = 'ui-replays';

export class ReplaysScene extends Phaser.Scene {
  private codeInput: HTMLInputElement | null = null;
  private statusLabel: Phaser.GameObjects.Text | null = null;
  /** Last successfully decoded playback (for Load & Play / Beat This Run). */
  private pending: ReplayPlayback | null = null;

  constructor() {
    super({ key: SCENE_REPLAYS });
  }

  create(): void {
    const { width, height } = this.scale;
    const cx = width / 2;
    this.cameras.main.setBackgroundColor(UI_COLORS.bg);

    label(this, cx, 30, 'replays.title', { size: 22, bold: true, name: 'replays-title' });

    // --- Replay-code box (paste / load / beat) ---
    const boxW = Math.min(340, width - 32);
    panel(this, cx - boxW / 2, 52, boxW, 116);
    label(this, cx, 66, 'replays.enter', { size: 13, color: UI_COLORS.textDim });
    this.mountCodeInput(cx, 92, boxW - 40);

    button(this, cx - 80, 138, 150, 32, 'replays.load', () => this.onLoad(), {
      color: UI_COLORS.accent2,
      name: 'btn-load-replay',
    });
    button(this, cx + 80, 138, 150, 32, 'replays.beatThis', () => this.onBeatThis(), {
      name: 'btn-beat-run',
    });
    this.statusLabel = label(this, cx, 176, 'replays.paste', {
      size: 11,
      color: UI_COLORS.textDim,
      wrap: boxW,
      name: 'replay-status',
    });

    // --- Top stored replays ---
    const replays = getSave().replays;
    const listX = Math.max(16, cx - 170);
    const listW = Math.min(340, width - 32);
    if (replays.length === 0) {
      label(this, cx, 240, 'replays.empty', { size: 13, color: UI_COLORS.textDim, wrap: listW });
    } else {
      let y = 214;
      for (const r of replays.slice(0, 9)) {
        const lvl = campaignLevelById(r.levelId);
        const levelName = lvl ? t(lvl.nameKey) : r.levelId;
        panel(this, listX, y - 14, listW, 34);
        label(this, listX + 12, y, 'replays.entry', {
          size: 11,
          color: UI_COLORS.text,
          origin: 0,
          align: 'left',
          params: { level: levelName, stars: r.stars, slot: r.wonOnSlot + 1 },
          name: 'replay-row',
        });
        drawStars(this, listX + listW - 90, y, r.stars, 3, 7, 4);
        // Tapping a stored row plays it back.
        const z = this.add.zone(listX + listW / 2, y, listW, 34).setOrigin(0.5).setInteractive({ useHandCursor: true });
        z.on('pointerdown', () => this.playCode(r.code));
        y += 40;
      }
    }

    button(this, cx, height - 30, 200, 40, 'menu.back', () => {
      getAudioEngine().sfx('ui');
      this.teardownInput();
      this.scene.start('ui-title');
    });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardownInput());
    this.game.events.emit('replays-ready');
  }

  /** Mount an HTML text input overlaying the canvas for pasting a code. */
  private mountCodeInput(cx: number, cy: number, w: number): void {
    if (typeof document === 'undefined') return;
    const canvas = this.game.canvas;
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = t('replays.paste');
    input.setAttribute('data-testid', 'replay-code-input');
    input.style.position = 'absolute';
    input.style.zIndex = '20';
    input.style.font = '13px sans-serif';
    input.style.padding = '4px 8px';
    input.style.border = '1px solid #2a3350';
    input.style.borderRadius = '6px';
    input.style.background = '#0b0f1a';
    input.style.color = '#e8ecff';
    this.positionInput(input, canvas, cx, cy, w);
    document.body.appendChild(input);
    this.codeInput = input;
  }

  /** Position the HTML input over the canvas (accounts for FIT letterboxing). */
  private positionInput(input: HTMLInputElement, canvas: HTMLCanvasElement, cx: number, cy: number, w: number): void {
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width / this.scale.width;
    const scaleY = rect.height / this.scale.height;
    input.style.left = `${rect.left + (cx - w / 2) * scaleX}px`;
    input.style.top = `${rect.top + (cy - 12) * scaleY}px`;
    input.style.width = `${w * scaleX}px`;
    input.style.height = `${24 * scaleY}px`;
  }

  private teardownInput(): void {
    this.codeInput?.remove();
    this.codeInput = null;
  }

  /** Read the code from the input (or the dev hook value). */
  private currentCode(): string {
    return this.codeInput?.value.trim() ?? '';
  }

  /** Decode + remember the current code; set a localized status. Returns ok. */
  private decodeCurrent(): boolean {
    const code = this.currentCode();
    if (!code) {
      this.setStatus('replays.invalid');
      return false;
    }
    const res = decodeForThisBuild(code);
    if (!res.ok) {
      this.setStatus(res.reason === 'version-mismatch' ? 'replays.mismatch' : 'replays.invalid');
      this.pending = null;
      return false;
    }
    if (!campaignLevelById(res.payload.levelId)) {
      this.setStatus('replays.invalid');
      this.pending = null;
      return false;
    }
    this.pending = playbackFrom(res);
    return true;
  }

  private onLoad(): void {
    getAudioEngine().sfx('ui');
    if (!this.decodeCurrent() || !this.pending) return;
    this.setStatus('replays.loaded');
    const playback = this.pending;
    this.teardownInput();
    this.scene.start('GameScene', { levelId: playback.levelId, from: 'ui-replays', replay: playback });
  }

  private onBeatThis(): void {
    getAudioEngine().sfx('ui');
    if (!this.decodeCurrent() || !this.pending) return;
    const levelId = this.pending.levelId;
    this.teardownInput();
    // "Beat this run": start the same level fresh (no replay), scored against it.
    this.scene.start('GameScene', { levelId, from: 'ui-replays' });
  }

  /** Play a stored code directly (row tap). */
  private playCode(code: string): void {
    const res = decodeForThisBuild(code);
    if (!res.ok || !campaignLevelById(res.payload.levelId)) {
      this.setStatus(res.ok || res.reason !== 'version-mismatch' ? 'replays.invalid' : 'replays.mismatch');
      return;
    }
    getAudioEngine().sfx('ui');
    const playback = playbackFrom(res);
    this.teardownInput();
    this.scene.start('GameScene', { levelId: playback.levelId, from: 'ui-replays', replay: playback });
  }

  private setStatus(key: string): void {
    if (this.statusLabel) this.statusLabel.setText(t(key));
  }
}
