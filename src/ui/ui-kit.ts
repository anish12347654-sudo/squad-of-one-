/**
 * Shared UI widgets for the menu suite (brief section 8).
 *
 * Every visible string flows through `t()` (the i18n no-hard-coded-strings test
 * scans this layer). Stars are drawn as vector polygons - headless Chromium
 * renders star/emoji glyphs as tofu - and text uses the locale-aware bundled
 * Noto font family via fontFamilyForCurrentLocale().
 */

import Phaser from 'phaser';
import { t } from '@i18n/index.js';
import { fontFamilyForCurrentLocale } from '@i18n/fonts.js';
import { textScale } from './save-context.js';

export const UI_COLORS = {
  bg: 0x0b0f1a,
  panel: 0x161d33,
  panelEdge: 0x2a3350,
  /** Numeric accents for Graphics fills/strokes. */
  accent: 0x64b5ff,
  accent2: 0x64ffda,
  gold: 0xffcc4d,
  goldEmpty: 0x39415c,
  /** CSS colour strings for text objects. */
  text: '#e8ecff',
  textDim: '#8a93b8',
  accentText: '#64b5ff',
  accent2Text: '#64ffda',
  dangerText: '#e05a6b',
  okText: '#5be08a',
  danger: 0xe05a6b,
  ok: 0x5be08a,
} as const;

/** Options for a localized text object. */
export interface LabelOpts {
  size?: number;
  color?: string;
  bold?: boolean;
  align?: 'left' | 'center' | 'right';
  origin?: number;
  wrap?: number;
  params?: Record<string, string | number>;
  name?: string;
}

/**
 * Create a localized text object. `key` is an i18n key; the string is resolved
 * with t() and the current locale's font is applied. Text size honours the
 * accessibility text-scale setting.
 */
export function label(
  scene: Phaser.Scene,
  x: number,
  y: number,
  key: string,
  opts: LabelOpts = {},
): Phaser.GameObjects.Text {
  const size = Math.round((opts.size ?? 16) * textScale());
  const style: Phaser.Types.GameObjects.Text.TextStyle = {
    fontFamily: fontFamilyForCurrentLocale(),
    fontSize: `${size}px`,
    color: opts.color ?? UI_COLORS.text,
    fontStyle: opts.bold ? 'bold' : 'normal',
    align: opts.align ?? 'center',
  };
  if (opts.wrap) style.wordWrap = { width: opts.wrap };
  const txt = scene.add
    .text(x, y, t(key, opts.params), style)
    .setOrigin(opts.origin ?? 0.5, 0.5);
  if (opts.name) txt.setName(opts.name);
  return txt;
}

/** A tappable button (rounded panel + centered localized label). */
export interface Button {
  container: Phaser.GameObjects.Container;
  setEnabled(on: boolean): void;
  setLabel(key: string, params?: Record<string, string | number>): void;
}

export function button(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  key: string,
  onClick: () => void,
  opts: { color?: number; params?: Record<string, string | number>; name?: string } = {},
): Button {
  const container = scene.add.container(x, y);
  const bg = scene.add.graphics();
  const accent = opts.color ?? UI_COLORS.accent;
  let enabled = true;

  const draw = (hover: boolean): void => {
    bg.clear();
    bg.fillStyle(enabled ? (hover ? 0x22304f : UI_COLORS.panel) : 0x121626, 1);
    bg.lineStyle(2, enabled ? accent : UI_COLORS.panelEdge, 1);
    bg.fillRoundedRect(-w / 2, -h / 2, w, h, 10);
    bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 10);
  };
  draw(false);
  container.add(bg);

  const labelOpts: LabelOpts = { size: 17, bold: true, color: UI_COLORS.text };
  if (opts.params) labelOpts.params = opts.params;
  const txt = label(scene, 0, 0, key, labelOpts);
  container.add(txt);
  if (opts.name) container.setName(opts.name);

  const zone = scene.add.zone(0, 0, w, h).setOrigin(0.5).setInteractive({ useHandCursor: true });
  zone.on('pointerover', () => draw(true));
  zone.on('pointerout', () => draw(false));
  zone.on('pointerdown', () => {
    if (enabled) onClick();
  });
  container.add(zone);

  return {
    container,
    setEnabled(on: boolean): void {
      enabled = on;
      draw(false);
      txt.setColor(on ? UI_COLORS.text : UI_COLORS.textDim);
    },
    setLabel(k: string, params?: Record<string, string | number>): void {
      txt.setText(t(k, params));
    },
  };
}

/**
 * Draw a row of `max` stars, `filled` of them gold, as vector polygons (no font
 * glyphs so headless Chromium never renders tofu). Returns the graphics object.
 */
export function drawStars(
  scene: Phaser.Scene,
  cx: number,
  cy: number,
  filled: number,
  max = 3,
  radius = 12,
  gap = 6,
): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  const total = max * (radius * 2) + (max - 1) * gap;
  let x = cx - total / 2 + radius;
  for (let i = 0; i < max; i++) {
    const on = i < filled;
    g.fillStyle(on ? UI_COLORS.gold : UI_COLORS.goldEmpty, 1);
    g.lineStyle(1.5, on ? 0xffe08a : UI_COLORS.panelEdge, 1);
    starPath(g, x, cy, radius, radius * 0.45);
    g.fillPath();
    g.strokePath();
    x += radius * 2 + gap;
  }
  return g;
}

/** Trace a five-point star into a graphics path (does not fill/stroke). */
export function starPath(
  g: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  outer: number,
  inner: number,
): void {
  g.beginPath();
  const points = 5;
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    // Start at the top point (-90deg) and go clockwise.
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    const px = cx + Math.cos(a) * r;
    const py = cy + Math.sin(a) * r;
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.closePath();
}

/** A framed panel background. */
export function panel(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  color: number = UI_COLORS.panel,
): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  g.fillStyle(color, 1);
  g.lineStyle(2, UI_COLORS.panelEdge, 1);
  g.fillRoundedRect(x, y, w, h, 12);
  g.strokeRoundedRect(x, y, w, h, 12);
  return g;
}
