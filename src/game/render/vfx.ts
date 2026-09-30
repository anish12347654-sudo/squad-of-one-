/**
 * Presentation-only juice (brief section 8). NEVER touches the sim: shake,
 * flashes, slow-mo and particles are pure render effects. Object-pooled with
 * hard caps so a busy fight never allocates per tick or spawns unbounded VFX.
 *
 * All of this lives in src/game (impure) and is safe to use Math/timers.
 */

import Phaser from 'phaser';

/** Max simultaneous pooled particles (particle cap, section 8). */
const MAX_PARTICLES = 220;
/** Max simultaneous floating damage-number labels. */
const MAX_NUMBERS = 40;

interface Particle {
  spr: Phaser.GameObjects.Arc;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  drag: number;
  active: boolean;
}

interface FloatNumber {
  txt: Phaser.GameObjects.Text;
  vy: number;
  life: number;
  maxLife: number;
  active: boolean;
}

export class Vfx {
  private particles: Particle[] = [];
  private numbers: FloatNumber[] = [];
  private depth: number;

  constructor(scene: Phaser.Scene, depth = 15) {
    this.depth = depth;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const spr = scene.add.circle(0, 0, 3, 0xffffff, 1).setDepth(depth).setVisible(false);
      this.particles.push({ spr, vx: 0, vy: 0, life: 0, maxLife: 1, drag: 0.92, active: false });
    }
    for (let i = 0; i < MAX_NUMBERS; i++) {
      const txt = scene.add
        .text(0, 0, '', { fontFamily: 'system-ui, sans-serif', fontSize: '16px', color: '#ffffff', fontStyle: 'bold' })
        .setOrigin(0.5)
        .setDepth(depth + 1)
        .setVisible(false);
      this.numbers.push({ txt, vy: 0, life: 0, maxLife: 1, active: false });
    }
  }

  /** Emit a burst of `count` particles from (x,y). */
  burst(x: number, y: number, color: number, count: number, speed = 3, life = 24, size = 3): void {
    let emitted = 0;
    for (const p of this.particles) {
      if (emitted >= count) break;
      if (p.active) continue;
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.9);
      p.spr.setPosition(x, y).setFillStyle(color, 1).setRadius(size * (0.6 + Math.random() * 0.8)).setVisible(true).setAlpha(1).setDepth(this.depth);
      p.vx = Math.cos(a) * s;
      p.vy = Math.sin(a) * s;
      p.life = life;
      p.maxLife = life;
      p.drag = 0.9;
      p.active = true;
      emitted++;
    }
  }

  /** A directional spark trail (e.g. beam / dash). */
  spark(x: number, y: number, dirX: number, dirY: number, color: number, count = 4): void {
    let emitted = 0;
    for (const p of this.particles) {
      if (emitted >= count) break;
      if (p.active) continue;
      p.spr.setPosition(x, y).setFillStyle(color, 1).setRadius(2 + Math.random() * 2).setVisible(true).setAlpha(1);
      const jitter = (Math.random() - 0.5) * 1.5;
      p.vx = dirX * 4 + jitter;
      p.vy = dirY * 4 + jitter;
      p.life = 16;
      p.maxLife = 16;
      p.drag = 0.85;
      p.active = true;
      emitted++;
    }
  }

  /** Floating damage number. */
  damageNumber(x: number, y: number, amount: number, color = '#ffffff'): void {
    const rounded = Math.round(amount);
    if (rounded <= 0) return;
    for (const n of this.numbers) {
      if (n.active) continue;
      n.txt
        .setText(`${rounded}`)
        .setPosition(x + (Math.random() - 0.5) * 14, y)
        .setColor(color)
        .setVisible(true)
        .setAlpha(1)
        .setScale(1);
      n.vy = -1.1;
      n.life = 40;
      n.maxLife = 40;
      n.active = true;
      return;
    }
  }

  /** Camera shake (presentation-only). */
  shake(camera: Phaser.Cameras.Scene2D.Camera, durationMs: number, intensity: number): void {
    camera.shake(durationMs, intensity);
  }

  /** Full-screen colour flash. */
  flash(camera: Phaser.Cameras.Scene2D.Camera, durationMs: number, r: number, g: number, b: number): void {
    camera.flash(durationMs, r, g, b);
  }

  /** Step all pooled VFX by one rendered frame. */
  update(): void {
    for (const p of this.particles) {
      if (!p.active) continue;
      p.spr.x += p.vx;
      p.spr.y += p.vy;
      p.vx *= p.drag;
      p.vy *= p.drag;
      p.life -= 1;
      const t = p.life / p.maxLife;
      p.spr.setAlpha(Math.max(0, t));
      if (p.life <= 0) {
        p.active = false;
        p.spr.setVisible(false);
      }
    }
    for (const n of this.numbers) {
      if (!n.active) continue;
      n.txt.y += n.vy;
      n.vy *= 0.96;
      n.life -= 1;
      const t = n.life / n.maxLife;
      n.txt.setAlpha(Math.max(0, t));
      if (n.life <= 0) {
        n.active = false;
        n.txt.setVisible(false);
      }
    }
  }

  destroy(): void {
    for (const p of this.particles) p.spr.destroy();
    for (const n of this.numbers) n.txt.destroy();
    this.particles.length = 0;
    this.numbers.length = 0;
  }
}
