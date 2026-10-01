/**
 * Shared menu-scene scaffolding for the visual overhaul (FEAT-002).
 *
 * Every menu scene wants the same premium backdrop treatment: the shared
 * animated clockwork/rangoli backdrop (from the frozen `createBackdrop` kit),
 * driven each frame, re-laid-out on resize, and torn down on shutdown, honouring
 * the reduced-motion accessibility setting. Rather than repeat that lifecycle in
 * a dozen scenes, `mountBackdrop()` wires it once.
 *
 * It also refreshes the scene camera to the current viewport on create. Direct
 * GameScene -> menu returns could leave the menu camera clipped to the right
 * half (the known camera-resize-on-scene-return issue); re-setting the camera
 * viewport/scroll here renders every menu full-frame on return, not only on a
 * fresh page load. Presentation-only; never touches the sim.
 */

import Phaser from 'phaser';
import { reducedMotion } from './save-context.js';
import { createBackdrop, type Backdrop } from '@game/render/backdrop.js';
import { GLOWS, lighten } from '@game/render/colors.js';

export interface MountBackdropOpts {
  /** Accent colour for the neon lattice (e.g. a world palette accent). */
  accent?: number;
  /** Secondary accent. */
  accent2?: number;
}

/**
 * Attach the shared animated backdrop to a scene with the full lifecycle wired
 * (per-frame update, resize re-layout, shutdown teardown) and refresh the
 * camera to the current viewport so returning from the GameScene renders the
 * menu full-frame. Returns the Backdrop (already depth -100, behind content).
 */
export function mountBackdrop(scene: Phaser.Scene, opts: MountBackdropOpts = {}): Backdrop {
  refreshCamera(scene);

  const backdropOpts: Parameters<typeof createBackdrop>[1] = { reducedMotion: reducedMotion() };
  if (opts.accent !== undefined) backdropOpts.accent = opts.accent;
  if (opts.accent2 !== undefined) backdropOpts.accent2 = opts.accent2;
  const backdrop = createBackdrop(scene, backdropOpts);

  const onUpdate = (_time: number, delta: number): void => backdrop.update(delta);
  const onResize = (size: Phaser.Structs.Size): void => {
    refreshCamera(scene);
    backdrop.resize(size.width, size.height);
  };
  scene.events.on(Phaser.Scenes.Events.UPDATE, onUpdate);
  scene.scale.on(Phaser.Scale.Events.RESIZE, onResize);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    scene.events.off(Phaser.Scenes.Events.UPDATE, onUpdate);
    scene.scale.off(Phaser.Scale.Events.RESIZE, onResize);
    backdrop.destroy();
  });

  return backdrop;
}

/**
 * Reset the main camera to the full current viewport. Guards against the
 * camera-clipped-to-right-half case seen on a direct GameScene -> menu return
 * (the camera kept a stale viewport); a fresh page load was unaffected.
 */
export function refreshCamera(scene: Phaser.Scene): void {
  const { width, height } = scene.scale;
  const cam = scene.cameras.main;
  cam.setViewport(0, 0, width, height);
  cam.setScroll(0, 0);
}

/** A glowing brand emblem (the time-loop lens: ring + core + orbiting echoes). */
export interface Emblem {
  destroy(): void;
}

export interface EmblemOpts {
  /** Lens radius in px (default 48). */
  radius?: number;
  /** Primary accent colour (default the kit blue). */
  accent?: number;
  /** Secondary accent for the orbiting echo dots (default teal). */
  accent2?: number;
  /** Depth to render at (default -5, above the backdrop, below text). */
  depth?: number;
}

/**
 * Draw the "time-loop lens" brand mark (matching the PWA icon): a soft glow
 * halo, a neon ring with tick marks, a bright core, and three echo dots that
 * orbit the ring. Animated via a scene tween unless reduced-motion is set, in
 * which case it renders a single static frame. The emblem redraws itself each
 * frame while animating and cleans up on scene shutdown.
 */
export function createEmblem(
  scene: Phaser.Scene,
  cx: number,
  cy: number,
  opts: EmblemOpts = {},
): Emblem {
  const radius = opts.radius ?? 48;
  const accent = opts.accent ?? GLOWS.accent;
  const accent2 = opts.accent2 ?? GLOWS.accent2;
  const depth = opts.depth ?? -5;
  const reduced = reducedMotion();

  const g = scene.add.graphics().setDepth(depth);

  const paint = (phase: number, pulse: number): void => {
    g.clear();
    // Soft outer glow halo (pulses gently).
    g.fillStyle(GLOWS.bloom, 0.1 + pulse * 0.06);
    g.fillCircle(cx, cy, radius * (1.5 + pulse * 0.1));
    g.fillStyle(accent, 0.12 + pulse * 0.05);
    g.fillCircle(cx, cy, radius * 1.15);

    // Neon ring with tick marks.
    g.lineStyle(2.5, accent, 0.9);
    g.strokeCircle(cx, cy, radius);
    g.lineStyle(1.5, lighten(accent, 0.3), 0.5);
    g.strokeCircle(cx, cy, radius * 0.78);
    const ticks = 24;
    for (let i = 0; i < ticks; i++) {
      const a = (i / ticks) * Math.PI * 2 + phase * 0.4;
      const r1 = radius - 4;
      const r2 = radius + 4;
      g.lineStyle(1.5, accent, 0.4);
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      g.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
      g.strokePath();
    }

    // Bright lens core.
    g.fillStyle(lighten(accent, 0.5), 0.9);
    g.fillCircle(cx, cy, radius * 0.26);
    g.fillStyle(0xffffff, 0.9);
    g.fillCircle(cx - radius * 0.06, cy - radius * 0.06, radius * 0.12);

    // Three orbiting echo dots.
    for (let i = 0; i < 3; i++) {
      const a = phase + (i / 3) * Math.PI * 2;
      const ex = cx + Math.cos(a) * radius;
      const ey = cy + Math.sin(a) * radius;
      g.fillStyle(accent2, 0.3);
      g.fillCircle(ex, ey, 7);
      g.fillStyle(lighten(accent2, 0.3), 1);
      g.fillCircle(ex, ey, 3.5);
    }
  };

  paint(reduced ? -Math.PI / 2 : 0, 0);

  let tween: Phaser.Tweens.Tween | null = null;
  if (!reduced) {
    const anim = { phase: 0 };
    tween = scene.tweens.add({
      targets: anim,
      phase: Math.PI * 2,
      duration: 9000,
      repeat: -1,
      onUpdate: () => {
        const pulse = 0.5 + 0.5 * Math.sin(anim.phase * 2);
        paint(anim.phase, pulse);
      },
    });
  }

  const destroy = (): void => {
    tween?.remove();
    tween = null;
    g.destroy();
  };
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, destroy);

  return { destroy };
}

/**
 * Give a list of containers/text objects a staggered fade+rise entrance. Honors
 * reduced-motion by snapping them straight to their resting state. Objects must
 * already be positioned at their resting y.
 */
export function staggerIn(
  scene: Phaser.Scene,
  targets: Array<Phaser.GameObjects.Container | Phaser.GameObjects.Text>,
  opts: { from?: number; step?: number; duration?: number } = {},
): void {
  if (reducedMotion()) return;
  const rise = opts.from ?? 16;
  const step = opts.step ?? 55;
  const duration = opts.duration ?? 260;
  targets.forEach((obj, i) => {
    const restY = obj.y;
    obj.setAlpha(0);
    obj.y = restY + rise;
    scene.tweens.add({
      targets: obj,
      y: restY,
      alpha: 1,
      delay: i * step,
      duration,
      ease: 'Quad.easeOut',
    });
  });
}
