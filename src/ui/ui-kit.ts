/**
 * Shared UI widgets for the menu suite (brief section 8) - the FROZEN visual
 * kit. Upgrading these widgets lifts every menu at once.
 *
 * Every visible string flows through `t()` (the i18n no-hard-coded-strings test
 * scans this layer). Stars are drawn as vector polygons - headless Chromium
 * renders star/emoji glyphs as tofu - and body text uses the locale-aware
 * bundled Noto font family via fontFamilyForCurrentLocale(); headline/display
 * text can opt into the Orbitron display face via fontFamilyForDisplay().
 *
 * FROZEN PUBLIC API (preserved verbatim for scenes + e2e + showcase):
 *   UI_COLORS, LabelOpts, Button
 *   label(scene, x, y, key, opts?)              -> Phaser.GameObjects.Text
 *   button(scene, x, y, w, h, key, onClick, opts?) -> Button
 *   drawStars(scene, cx, cy, filled, max?, radius?, gap?) -> Graphics
 *   starPath(g, cx, cy, outer, inner)           -> void
 *   panel(scene, x, y, w, h, color?, opts?)     -> Graphics
 * The Button shape ({container, setEnabled, setLabel}) and all `name:` object
 * names are unchanged; new look is added via OPTIONAL opts only.
 */

import Phaser from 'phaser';
import { t } from '@i18n/index.js';
import { fontFamilyForCurrentLocale, fontFamilyForDisplay } from '@i18n/fonts.js';
import { textScale, reducedMotion } from './save-context.js';
import { GRADIENTS, GLOWS, TINTS, lighten, type GradientStops } from '@game/render/colors.js';

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

/**
 * Paint a vertical gradient rounded-rect into a Graphics via a stacked-band
 * clip. Cheap enough for menus (static) and used by panels/buttons.
 */
function fillGradientRoundedRect(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  stops: GradientStops,
  steps = 10,
): void {
  const ar = (stops.top >> 16) & 0xff;
  const ag = (stops.top >> 8) & 0xff;
  const ab = stops.top & 0xff;
  const br = (stops.bottom >> 16) & 0xff;
  const bg = (stops.bottom >> 8) & 0xff;
  const bb = stops.bottom & 0xff;
  const n = Math.max(1, Math.floor(steps));
  const bh = h / n;
  for (let i = 0; i < n; i++) {
    const tt = n === 1 ? 0 : i / (n - 1);
    const c =
      ((Math.round(ar + (br - ar) * tt) & 0xff) << 16) |
      ((Math.round(ag + (bg - ag) * tt) & 0xff) << 8) |
      (Math.round(ab + (bb - ab) * tt) & 0xff);
    const by = y + i * bh;
    // Round only the first/last band so the overall silhouette stays rounded.
    const topR = i === 0 ? radius : 0;
    const botR = i === n - 1 ? radius : 0;
    g.fillStyle(c, 1);
    drawPartRoundedRect(g, x, by, w, bh + 1, topR, botR);
  }
}

/** Rounded on the top corners by `topR`, bottom corners by `botR`. */
function drawPartRoundedRect(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  topR: number,
  botR: number,
): void {
  const tr = Math.min(topR, w / 2, h);
  const brd = Math.min(botR, w / 2, h);
  g.beginPath();
  g.moveTo(x + tr, y);
  g.lineTo(x + w - tr, y);
  if (tr > 0) g.arc(x + w - tr, y + tr, tr, -Math.PI / 2, 0);
  g.lineTo(x + w, y + h - brd);
  if (brd > 0) g.arc(x + w - brd, y + h - brd, brd, 0, Math.PI / 2);
  g.lineTo(x + brd, y + h);
  if (brd > 0) g.arc(x + brd, y + h - brd, brd, Math.PI / 2, Math.PI);
  g.lineTo(x, y + tr);
  if (tr > 0) g.arc(x + tr, y + tr, tr, Math.PI, (Math.PI * 3) / 2);
  g.closePath();
  g.fillPath();
}

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
  /** Use the Orbitron display face (titles/headings); falls back for Hindi. */
  display?: boolean;
  /** Soft neon shadow colour behind the glyphs (e.g. for headlines). */
  glow?: number;
}

/**
 * Create a localized text object. `key` is an i18n key; the string is resolved
 * with t() and the current locale's font is applied. Text size honours the
 * accessibility text-scale setting. Set `display` to use the Orbitron headline
 * face (Latin only; Hindi gracefully falls back to the Devanagari/Noto family).
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
    fontFamily: opts.display ? fontFamilyForDisplay() : fontFamilyForCurrentLocale(),
    fontSize: `${size}px`,
    color: opts.color ?? UI_COLORS.text,
    fontStyle: opts.bold ? 'bold' : 'normal',
    align: opts.align ?? 'center',
  };
  if (opts.wrap) style.wordWrap = { width: opts.wrap };
  const txt = scene.add
    .text(x, y, t(key, opts.params), style)
    .setOrigin(opts.origin ?? 0.5, 0.5);
  if (opts.glow !== undefined) {
    const hex = `#${(opts.glow & 0xffffff).toString(16).padStart(6, '0')}`;
    txt.setShadow(0, 0, hex, 12, true, true);
  }
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
  const radius = 12;
  let enabled = true;

  // 0 = idle, 1 = hover, 2 = pressed, 3 = disabled.
  const draw = (state: number): void => {
    bg.clear();
    const left = -w / 2;
    const top = -h / 2;

    if (state !== 3) {
      // Soft drop shadow (offset dark rounded rect) for lift off the backdrop.
      bg.fillStyle(GLOWS.shadow, 0.5);
      drawPartRoundedRect(bg, left + 1.5, top + 4, w, h, radius, radius);
      // Outer accent glow halo (stronger on hover).
      const glowA = state === 1 ? 0.3 : 0.16;
      bg.fillStyle(accent, glowA);
      drawPartRoundedRect(bg, left - 2, top - 2, w + 4, h + 4, radius + 2, radius + 2);
    }

    const stops =
      state === 3
        ? GRADIENTS.buttonDisabled
        : state === 2
          ? GRADIENTS.buttonActive
          : state === 1
            ? GRADIENTS.buttonHover
            : GRADIENTS.button;
    fillGradientRoundedRect(bg, left, top, w, h, radius, stops, 10);

    // Inner highlight bevel along the top edge for a lit, raised look.
    if (state !== 3) {
      bg.lineStyle(1.5, lighten(stops.top, 0.35), 0.55);
      bg.beginPath();
      bg.moveTo(left + radius, top + 1);
      bg.lineTo(left + w - radius, top + 1);
      bg.strokePath();
    }

    // Accent edge stroke.
    bg.lineStyle(1.5, state === 3 ? UI_COLORS.panelEdge : accent, state === 3 ? 0.6 : 1);
    bg.strokeRoundedRect(left, top, w, h, radius);
  };
  draw(0);
  container.add(bg);

  const labelOpts: LabelOpts = { size: 17, bold: true, color: UI_COLORS.text };
  if (opts.params) labelOpts.params = opts.params;
  const txt = label(scene, 0, 0, key, labelOpts);
  container.add(txt);
  if (opts.name) container.setName(opts.name);

  const animate = (scale: number): void => {
    if (reducedMotion()) {
      container.setScale(1);
      return;
    }
    scene.tweens.add({
      targets: container,
      scaleX: scale,
      scaleY: scale,
      duration: 90,
      ease: 'Quad.easeOut',
    });
  };

  const zone = scene.add.zone(0, 0, w, h).setOrigin(0.5).setInteractive({ useHandCursor: true });
  zone.on('pointerover', () => {
    if (enabled) {
      draw(1);
      animate(1.04);
    }
  });
  zone.on('pointerout', () => {
    if (enabled) {
      draw(0);
      animate(1);
    }
  });
  zone.on('pointerdown', () => {
    if (enabled) {
      draw(2);
      animate(0.97);
      onClick();
    }
  });
  zone.on('pointerup', () => {
    if (enabled) {
      draw(1);
      animate(1.04);
    }
  });
  container.add(zone);

  return {
    container,
    setEnabled(on: boolean): void {
      enabled = on;
      draw(on ? 0 : 3);
      container.setScale(1);
      txt.setColor(on ? UI_COLORS.text : UI_COLORS.textDim);
    },
    setLabel(k: string, params?: Record<string, string | number>): void {
      txt.setText(t(k, params));
    },
  };
}

/**
 * Draw a row of `max` stars, `filled` of them with a gold gradient + soft glow,
 * as vector polygons (no font glyphs so headless Chromium never renders tofu).
 * Returns the graphics object.
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
    if (on) {
      // Soft gold glow halo behind filled stars.
      g.fillStyle(GLOWS.gold, 0.22);
      starPath(g, x, cy, radius * 1.35, radius * 0.6);
      g.fillPath();
      // Gold gradient: bright core over a deeper gold rim.
      g.fillStyle(GRADIENTS.gold.bottom, 1);
      starPath(g, x, cy, radius, radius * 0.45);
      g.fillPath();
      g.fillStyle(GRADIENTS.gold.top, 1);
      starPath(g, x, cy - radius * 0.18, radius * 0.72, radius * 0.33);
      g.fillPath();
      g.lineStyle(1.5, 0xffe8a8, 1);
      starPath(g, x, cy, radius, radius * 0.45);
      g.strokePath();
    } else {
      g.fillStyle(UI_COLORS.goldEmpty, 1);
      g.lineStyle(1.5, UI_COLORS.panelEdge, 1);
      starPath(g, x, cy, radius, radius * 0.45);
      g.fillPath();
      g.strokePath();
    }
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

/** Options for a framed panel. */
export interface PanelOpts {
  /** Accent colour for the subtle top edge line (e.g. UI_COLORS.accent). */
  accent?: number;
  /** Corner radius (default 12). */
  radius?: number;
  /** Draw a soft drop shadow (default true). */
  shadow?: boolean;
}

/**
 * A glass/gradient panel background with a soft drop shadow, subtle inner
 * border and an optional accent edge. `color` is kept for API compatibility: a
 * matching gradient is derived from it so existing callers get the new look
 * without changing their call sites.
 */
export function panel(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  color: number = UI_COLORS.panel,
  opts: PanelOpts = {},
): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  const radius = opts.radius ?? 12;
  const stops: GradientStops =
    color === UI_COLORS.panel
      ? GRADIENTS.panel
      : { top: lighten(color, 0.14), bottom: color };

  // Soft drop shadow.
  if (opts.shadow !== false) {
    g.fillStyle(GLOWS.shadow, 0.45);
    drawPartRoundedRect(g, x + 2, y + 5, w, h, radius, radius);
  }

  // Gradient glass fill.
  fillGradientRoundedRect(g, x, y, w, h, radius, stops, 12);

  // Subtle inner border + top inner highlight for the glass bevel.
  g.lineStyle(1, TINTS.innerLight, 0.18);
  g.strokeRoundedRect(x + 1.5, y + 1.5, w - 3, h - 3, radius - 1);
  g.lineStyle(2, UI_COLORS.panelEdge, 1);
  g.strokeRoundedRect(x, y, w, h, radius);

  // Optional accent edge along the top.
  if (opts.accent !== undefined) {
    g.lineStyle(2, opts.accent, 0.9);
    g.beginPath();
    g.moveTo(x + radius, y + 1);
    g.lineTo(x + w - radius, y + 1);
    g.strokePath();
  }

  return g;
}
