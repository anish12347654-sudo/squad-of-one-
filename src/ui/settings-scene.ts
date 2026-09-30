/**
 * SettingsScene (brief section 8): every accessibility + audio option, each
 * wired to the SaveSettings and applied immediately (locale/font, volumes,
 * haptics, shake, flashing, colour-blind identity, text size, left-handed,
 * Assist Mode). Also exposes save export/import codes.
 */

import Phaser from 'phaser';
import { getAudioEngine } from '@audio/audio-engine.js';
import { vibrate } from '@platform/index.js';
import { exportSaveCode, importSaveCode } from '@platform/index.js';
import { getSave, updateSave, setSave } from './save-context.js';
import { label, button, UI_COLORS } from './ui-kit.js';
import { LOCALES, t } from '@i18n/index.js';
import type { SaveSettings } from '@meta/index.js';

export const SCENE_SETTINGS = 'ui-settings';

/** A labelled toggle/slider row. */
export class SettingsScene extends Phaser.Scene {
  constructor() {
    super({ key: SCENE_SETTINGS });
  }

  create(): void {
    const { width, height } = this.scale;
    const cx = width / 2;
    this.cameras.main.setBackgroundColor(UI_COLORS.bg);
    label(this, cx, 34, 'settings.title', { size: 24, bold: true, name: 'settings-title' });

    const listX = Math.max(20, cx - 180);
    const listW = Math.min(360, width - 40);
    let y = 76;
    const rowH = 40;

    const s = getSave().settings;

    // Language (cycle through locales).
    this.rowValue(listX, y, listW, 'settings.language', this.localeLabel(), () => {
      const ids = LOCALES.map((l) => l.id);
      const idx = ids.indexOf(getSave().settings.locale);
      const nextLocale = ids[(idx + 1) % ids.length]!;
      updateSave((sv) => ({ ...sv, settings: { ...sv.settings, locale: nextLocale } }));
      this.scene.restart();
    });
    y += rowH;

    // Volume sliders (stepped 0/0.25/0.5/0.75/1).
    y = this.slider(listX, y, listW, rowH, 'settings.volumeMaster', 'volumeMaster', s.volumeMaster);
    y = this.slider(listX, y, listW, rowH, 'settings.volumeMusic', 'volumeMusic', s.volumeMusic);
    y = this.slider(listX, y, listW, rowH, 'settings.volumeSfx', 'volumeSfx', s.volumeSfx);

    // Toggles.
    y = this.toggle(listX, y, listW, rowH, 'settings.screenShake', 'screenShake', s.screenShake);
    y = this.toggle(listX, y, listW, rowH, 'settings.reducedFlashing', 'reducedFlashing', s.reducedFlashing);
    y = this.toggle(listX, y, listW, rowH, 'settings.colorBlind', 'colorBlind', s.colorBlind);
    y = this.toggle(listX, y, listW, rowH, 'settings.leftHanded', 'leftHanded', s.leftHanded);
    y = this.toggle(listX, y, listW, rowH, 'settings.haptics', 'haptics', s.haptics, () => vibrate('tap'));
    y = this.toggle(listX, y, listW, rowH, 'settings.assistMode', 'assistMode', s.assistMode);

    // Text size cycle.
    y = this.rowValue(listX, y, listW, 'settings.textSize', this.textSizeLabel(), () => {
      const order: SaveSettings['textSize'][] = ['small', 'medium', 'large'];
      const idx = order.indexOf(getSave().settings.textSize);
      const next = order[(idx + 1) % order.length]!;
      updateSave((sv) => ({ ...sv, settings: { ...sv.settings, textSize: next } }));
      this.scene.restart();
    });

    label(this, cx, y + 8, 'settings.assistNote', { size: 10, color: UI_COLORS.textDim, wrap: listW });
    y += 30;

    // Export / import codes.
    button(this, cx - 90, y + 10, 170, 38, 'settings.export', () => this.exportCode());
    button(this, cx + 90, y + 10, 170, 38, 'settings.import', () => this.importCode());

    button(this, cx, height - 34, 200, 42, 'menu.back', () => {
      getAudioEngine().sfx('ui');
      this.scene.start('ui-title');
    });

    this.game.events.emit('settings-ready');
  }

  private localeLabel(): string {
    const meta = LOCALES.find((l) => l.id === getSave().settings.locale) ?? LOCALES[0]!;
    return meta.label;
  }

  private textSizeLabel(): string {
    return t(`settings.textSize.${getSave().settings.textSize}`);
  }

  /** A row with a localized label and a raw (already-localized) value button. */
  private rowValue(x: number, y: number, w: number, key: string, value: string, onClick: () => void): number {
    label(this, x, y, key, { size: 14, origin: 0, align: 'left' });
    const b = this.add.container(x + w - 60, y);
    const bg = this.add.graphics();
    bg.fillStyle(UI_COLORS.panel, 1);
    bg.lineStyle(2, UI_COLORS.accent, 1);
    bg.fillRoundedRect(-56, -14, 112, 28, 8);
    bg.strokeRoundedRect(-56, -14, 112, 28, 8);
    b.add(bg);
    // Value is a runtime label (locale endonym / size word), not a static key.
    const vt = this.add
      .text(0, 0, value, { fontFamily: 'sans-serif', fontSize: '13px', color: UI_COLORS.text })
      .setOrigin(0.5);
    b.add(vt);
    const zone = this.add.zone(0, 0, 112, 28).setOrigin(0.5).setInteractive({ useHandCursor: true });
    zone.on('pointerdown', () => {
      getAudioEngine().sfx('ui');
      onClick();
    });
    b.add(zone);
    return y + 40;
  }

  private toggle(
    x: number,
    y: number,
    w: number,
    rowH: number,
    key: string,
    field: keyof SaveSettings,
    initial: boolean,
    onOn?: () => void,
  ): number {
    label(this, x, y, key, { size: 14, origin: 0, align: 'left' });
    const b = button(
      this,
      x + w - 60,
      y,
      100,
      28,
      initial ? 'common.on' : 'common.off',
      () => {
        const cur = getSave().settings[field] as boolean;
        const next = !cur;
        updateSave((sv) => ({ ...sv, settings: { ...sv.settings, [field]: next } }));
        b.setLabel(next ? 'common.on' : 'common.off');
        if (next && onOn) onOn();
      },
      { color: initial ? UI_COLORS.accent2 : UI_COLORS.accent },
    );
    return y + rowH;
  }

  private slider(
    x: number,
    y: number,
    w: number,
    rowH: number,
    key: string,
    field: 'volumeMaster' | 'volumeMusic' | 'volumeSfx',
    initial: number,
  ): number {
    label(this, x, y, key, { size: 14, origin: 0, align: 'left' });
    const trackX = x + w - 130;
    const trackW = 110;
    const g = this.add.graphics();
    const redraw = (v: number): void => {
      g.clear();
      g.fillStyle(UI_COLORS.panelEdge, 1);
      g.fillRoundedRect(trackX, y - 4, trackW, 8, 4);
      g.fillStyle(UI_COLORS.accent, 1);
      g.fillRoundedRect(trackX, y - 4, trackW * v, 8, 4);
      g.fillStyle(0xffffff, 1);
      g.fillCircle(trackX + trackW * v, y, 7);
    };
    redraw(initial);
    // Stepped: each tap advances by 0.25 (wraps). Keeps it deterministic + testable.
    const zone = this.add.zone(trackX + trackW / 2, y, trackW + 20, 26).setOrigin(0.5).setInteractive({ useHandCursor: true });
    zone.on('pointerdown', () => {
      getAudioEngine().sfx('ui');
      const cur = getSave().settings[field];
      const next = cur >= 1 ? 0 : Math.min(1, Math.round((cur + 0.25) * 100) / 100);
      updateSave((sv) => ({ ...sv, settings: { ...sv.settings, [field]: next } }));
      redraw(next);
    });
    return y + rowH;
  }

  private exportCode(): void {
    const code = exportSaveCode(getSave());
    // Surface the code by writing it as a runtime value label (not a key).
    const { width, height } = this.scale;
    this.add
      .text(width / 2, height - 88, code.slice(0, 40) + '...', {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: UI_COLORS.textDim,
      })
      .setOrigin(0.5)
      .setName('export-code');
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(code).catch(() => undefined);
    }
  }

  private importCode(): void {
    if (typeof window === 'undefined' || !window.prompt) return;
    const code = window.prompt(t('settings.import'));
    if (!code) return;
    try {
      const imported = importSaveCode(code);
      setSave(imported);
      this.scene.restart();
    } catch {
      /* ignore invalid codes */
    }
  }
}
