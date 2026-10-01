/**
 * Shared animated backdrop for the visual kit (brief: "neon clockwork + Indian
 * rangoli/jaali geometric" motif). Used by both the menu suite and GameScene so
 * every screen shares one premium, layered background instead of a flat fill.
 *
 * It is drawn procedurally with Phaser Graphics (no image assets, no runtime
 * network): a deep vertical gradient wash, a parallax starfield, a slowly
 * rotating neon clockwork ring, and a central rangoli/jaali lattice. Everything
 * is presentation-only and never touches the sim.
 *
 * FROZEN API (scenes adopt it uniformly):
 *   createBackdrop(scene, opts?) -> Backdrop
 *   backdrop.update(dtMs)        // advance animation (safe to call every frame)
 *   backdrop.resize(w, h)        // re-layout on viewport change
 *   backdrop.destroy()           // tear down
 *   backdrop.setDepth(depth)
 * Honors reduced-motion: when on, it renders a single static frame and update()
 * becomes a no-op, so there is always a graceful static fallback.
 */

import Phaser from 'phaser';
import { GRADIENTS, GLOWS, lerpColor } from './colors.js';

export interface BackdropOpts {
  /** Depth to place the backdrop at (default -100, behind everything). */
  depth?: number;
  /** Accent colour for the neon lattice (default a soft blue). */
  accent?: number;
  /** Secondary accent (default teal). */
  accent2?: number;
  /** When true, draw a single static frame and skip animation. */
  reducedMotion?: boolean;
  /** Star count (kept modest for the perf budget; default 48). */
  stars?: number;
}

interface Star {
  x: number;
  y: number;
  r: number;
  /** Parallax factor 0.2..1. */
  p: number;
  tw: number;
}

export interface Backdrop {
  update(dtMs: number): void;
  resize(w: number, h: number): void;
  setDepth(depth: number): void;
  destroy(): void;
}

export function createBackdrop(scene: Phaser.Scene, opts: BackdropOpts = {}): Backdrop {
  const depth = opts.depth ?? -100;
  const accent = opts.accent ?? GLOWS.accent;
  const accent2 = opts.accent2 ?? GLOWS.accent2;
  const reduced = opts.reducedMotion === true;
  const starCount = Math.max(0, opts.stars ?? 48);

  let w = scene.scale.width;
  let h = scene.scale.height;

  // Static wash + starfield (painted once; cheap).
  const washGfx = scene.add.graphics().setDepth(depth);
  const starGfx = scene.add.graphics().setDepth(depth + 1);
  // Animated neon lattice (clockwork ring + rangoli/jaali), redrawn per frame.
  const latticeGfx = scene.add.graphics().setDepth(depth + 2);

  const stars: Star[] = [];
  for (let i = 0; i < starCount; i++) {
    stars.push({
      x: Math.random() * w,
      y: Math.random() * h,
      r: 0.6 + Math.random() * 1.6,
      p: 0.2 + Math.random() * 0.8,
      tw: Math.random() * Math.PI * 2,
    });
  }

  let time = 0;

  const paintWash = (): void => {
    washGfx.clear();
    const n = 24;
    const bh = h / n;
    for (let i = 0; i < n; i++) {
      const tt = i / (n - 1);
      washGfx.fillStyle(lerpColor(GRADIENTS.backdrop.top, GRADIENTS.backdrop.bottom, tt), 1);
      washGfx.fillRect(0, i * bh, w, bh + 1);
    }
    // Soft radial accent bloom near the top centre.
    washGfx.fillStyle(accent, 0.05);
    washGfx.fillCircle(w / 2, h * 0.22, Math.max(w, h) * 0.5);
  };

  const paintStars = (): void => {
    starGfx.clear();
    for (const s of stars) {
      const a = reduced ? 0.6 : 0.35 + 0.35 * (0.5 + 0.5 * Math.sin(s.tw + time * 0.002 * s.p));
      starGfx.fillStyle(0xcfe0ff, a);
      starGfx.fillCircle(s.x, s.y, s.r);
    }
  };

  const paintLattice = (): void => {
    latticeGfx.clear();
    const cx = w / 2;
    const cy = h * 0.5;
    const rot = reduced ? 0 : time * 0.00012;
    const base = Math.min(w, h) * 0.42;

    // Clockwork ring: concentric rings with tick marks that slowly rotate.
    for (let ring = 0; ring < 2; ring++) {
      const rr = base * (0.65 + ring * 0.28);
      latticeGfx.lineStyle(1, ring === 0 ? accent : accent2, 0.1);
      latticeGfx.strokeCircle(cx, cy, rr);
      const ticks = 24 + ring * 12;
      const dir = ring % 2 === 0 ? 1 : -1;
      for (let i = 0; i < ticks; i++) {
        const ang = (i / ticks) * Math.PI * 2 + rot * dir;
        const r1 = rr - 5;
        const r2 = rr + 5;
        latticeGfx.lineStyle(1, ring === 0 ? accent : accent2, 0.14);
        latticeGfx.beginPath();
        latticeGfx.moveTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
        latticeGfx.lineTo(cx + Math.cos(ang) * r2, cy + Math.sin(ang) * r2);
        latticeGfx.strokePath();
      }
    }

    // Rangoli / jaali lattice: an 8-fold symmetric petal/diamond mandala.
    const petals = 8;
    const pr = base * 0.5;
    const breathe = reduced ? 1 : 1 + Math.sin(time * 0.001) * 0.03;
    for (let i = 0; i < petals; i++) {
      const ang = (i / petals) * Math.PI * 2 + rot * 0.5;
      const px = cx + Math.cos(ang) * pr * breathe;
      const py = cy + Math.sin(ang) * pr * breathe;
      // Diamond petal.
      const pw = base * 0.14;
      const nx = Math.cos(ang);
      const ny = Math.sin(ang);
      const tx = -ny;
      const ty = nx;
      latticeGfx.lineStyle(1, accent2, 0.12);
      latticeGfx.beginPath();
      latticeGfx.moveTo(px - nx * pw, py - ny * pw);
      latticeGfx.lineTo(px + tx * pw * 0.6, py + ty * pw * 0.6);
      latticeGfx.lineTo(px + nx * pw, py + ny * pw);
      latticeGfx.lineTo(px - tx * pw * 0.6, py - ty * pw * 0.6);
      latticeGfx.closePath();
      latticeGfx.strokePath();
      // Jaali spoke to centre.
      latticeGfx.lineStyle(1, accent, 0.08);
      latticeGfx.beginPath();
      latticeGfx.moveTo(cx, cy);
      latticeGfx.lineTo(px, py);
      latticeGfx.strokePath();
    }
    // Small central node.
    latticeGfx.fillStyle(accent, 0.18);
    latticeGfx.fillCircle(cx, cy, base * 0.04);
  };

  const repaintAll = (): void => {
    paintWash();
    paintStars();
    paintLattice();
  };
  repaintAll();

  return {
    update(dtMs: number): void {
      if (reduced) return;
      time += dtMs;
      paintStars();
      paintLattice();
    },
    resize(nw: number, nh: number): void {
      w = nw;
      h = nh;
      repaintAll();
    },
    setDepth(d: number): void {
      washGfx.setDepth(d);
      starGfx.setDepth(d + 1);
      latticeGfx.setDepth(d + 2);
    },
    destroy(): void {
      washGfx.destroy();
      starGfx.destroy();
      latticeGfx.destroy();
    },
  };
}
