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
  /** Radius grows (>1) or shrinks (<1) over life for pop/shrink feels. */
  grow: number;
  baseR: number;
  /** Gravity pull per frame (px). 0 = none. */
  gravity: number;
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
      // ADD blend mode gives pooled particles a glowing, additive look so
      // overlapping sparks read as bright energy (bloom-friendly). Still a
      // single pooled Arc per particle - no per-tick allocation.
      const spr = scene.add.circle(0, 0, 3, 0xffffff, 1);
      spr.setBlendMode(Phaser.BlendModes.ADD).setDepth(depth).setVisible(false);
      this.particles.push({ spr, vx: 0, vy: 0, life: 0, maxLife: 1, drag: 0.92, active: false, grow: 1, baseR: 3, gravity: 0 });
    }
    for (let i = 0; i < MAX_NUMBERS; i++) {
      const txt = scene.add
        .text(0, 0, '', {
          fontFamily: 'system-ui, sans-serif',
          fontSize: '16px',
          color: '#ffffff',
          fontStyle: 'bold',
          stroke: '#05070d',
          strokeThickness: 3,
        })
        .setOrigin(0.5)
        .setDepth(depth + 1)
        .setVisible(false);
      txt.setShadow(0, 1, '#05070d', 2, true, true);
      this.numbers.push({ txt, vy: 0, life: 0, maxLife: 1, active: false });
    }
  }

  /** Grab the next free pooled particle, or null if the cap is reached. */
  private free(): Particle | null {
    for (const p of this.particles) if (!p.active) return p;
    return null;
  }

  /** Emit a burst of `count` particles from (x,y). */
  burst(x: number, y: number, color: number, count: number, speed = 3, life = 24, size = 3): void {
    let emitted = 0;
    for (const p of this.particles) {
      if (emitted >= count) break;
      if (p.active) continue;
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.9);
      const r = size * (0.6 + Math.random() * 0.8);
      p.spr.setPosition(x, y).setFillStyle(color, 1).setRadius(r).setVisible(true).setAlpha(1).setDepth(this.depth);
      p.vx = Math.cos(a) * s;
      p.vy = Math.sin(a) * s;
      p.life = life;
      p.maxLife = life;
      p.drag = 0.9;
      p.grow = 0.55; // shrink as they fade (ember feel)
      p.baseR = r;
      p.gravity = 0;
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
      const r = 2 + Math.random() * 2;
      p.spr.setPosition(x, y).setFillStyle(color, 1).setRadius(r).setVisible(true).setAlpha(1);
      const jitter = (Math.random() - 0.5) * 1.5;
      p.vx = dirX * 4 + jitter;
      p.vy = dirY * 4 + jitter;
      p.life = 16;
      p.maxLife = 16;
      p.drag = 0.85;
      p.grow = 0.5;
      p.baseR = r;
      p.gravity = 0;
      p.active = true;
      emitted++;
    }
  }

  /**
   * A single soft trail dot that lingers and fades (projectile/beam/dash
   * trails). Cheap - one pooled particle. `drift` nudges it along a direction.
   */
  trail(x: number, y: number, color: number, size = 3, life = 12, driftX = 0, driftY = 0): void {
    const p = this.free();
    if (!p) return;
    p.spr.setPosition(x, y).setFillStyle(color, 1).setRadius(size).setVisible(true).setAlpha(0.9).setDepth(this.depth);
    p.vx = driftX;
    p.vy = driftY;
    p.life = life;
    p.maxLife = life;
    p.drag = 0.9;
    p.grow = 0.4;
    p.baseR = size;
    p.gravity = 0;
    p.active = true;
  }

  /**
   * An expanding ring of particles (impact burst / shockwave). Particles fly
   * outward evenly then shrink - reads as a crisp impact.
   */
  ring(x: number, y: number, color: number, count = 10, speed = 3.5, life = 18, size = 3): void {
    let emitted = 0;
    const base = Math.random() * Math.PI * 2;
    for (let i = 0; i < count; i++) {
      const p = this.free();
      if (!p) break;
      const a = base + (i / count) * Math.PI * 2;
      p.spr.setPosition(x, y).setFillStyle(color, 1).setRadius(size).setVisible(true).setAlpha(1).setDepth(this.depth);
      p.vx = Math.cos(a) * speed;
      p.vy = Math.sin(a) * speed;
      p.life = life;
      p.maxLife = life;
      p.drag = 0.82;
      p.grow = 0.3;
      p.baseR = size;
      p.gravity = 0;
      p.active = true;
      emitted++;
    }
    void emitted;
  }

  /**
   * A soft aura of slow orbiting-ish motes around a point (heal / shield /
   * charge). `count` kept small so this stays within the cap during busy fights.
   */
  aura(x: number, y: number, radius: number, color: number, count = 3, life = 22): void {
    for (let i = 0; i < count; i++) {
      const p = this.free();
      if (!p) break;
      const a = Math.random() * Math.PI * 2;
      const px = x + Math.cos(a) * radius;
      const py = y + Math.sin(a) * radius;
      const r = 2 + Math.random() * 2;
      p.spr.setPosition(px, py).setFillStyle(color, 1).setRadius(r).setVisible(true).setAlpha(0.9).setDepth(this.depth);
      // Drift gently toward the centre (heal) - purely cosmetic.
      p.vx = -Math.cos(a) * 0.5;
      p.vy = -Math.sin(a) * 0.5 - 0.6;
      p.life = life;
      p.maxLife = life;
      p.drag = 0.94;
      p.grow = 0.5;
      p.baseR = r;
      p.gravity = 0;
      p.active = true;
    }
  }

  /** Twinkling sparkles rising from a point (shard grab pickup). */
  sparkle(x: number, y: number, color: number, count = 6): void {
    for (let i = 0; i < count; i++) {
      const p = this.free();
      if (!p) break;
      const r = 1.5 + Math.random() * 2;
      p.spr
        .setPosition(x + (Math.random() - 0.5) * 16, y + (Math.random() - 0.5) * 8)
        .setFillStyle(color, 1)
        .setRadius(r)
        .setVisible(true)
        .setAlpha(1)
        .setDepth(this.depth);
      p.vx = (Math.random() - 0.5) * 1.2;
      p.vy = -1.4 - Math.random() * 1.2;
      p.life = 26;
      p.maxLife = 26;
      p.drag = 0.96;
      p.grow = 1.3; // twinkle: briefly grow
      p.baseR = r;
      p.gravity = -0.04; // float upward
      p.active = true;
    }
  }

  /** Glitchy scatter for paradox VFX (jittery square-ish shards via dots). */
  glitch(x: number, y: number, color: number, count = 6): void {
    for (let i = 0; i < count; i++) {
      const p = this.free();
      if (!p) break;
      const r = 2 + Math.random() * 3;
      p.spr
        .setPosition(x + (Math.random() - 0.5) * 24, y + (Math.random() - 0.5) * 24)
        .setFillStyle(color, 1)
        .setRadius(r)
        .setVisible(true)
        .setAlpha(0.9)
        .setDepth(this.depth);
      p.vx = (Math.random() - 0.5) * 5;
      p.vy = (Math.random() - 0.5) * 5;
      p.life = 12 + Math.floor(Math.random() * 8);
      p.maxLife = p.life;
      p.drag = 0.8;
      p.grow = 0.3;
      p.baseR = r;
      p.gravity = 0;
      p.active = true;
    }
  }

  /**
   * Floating damage number. `big` renders a larger, punchier number (used for
   * heavy hits) so impact reads at a glance; still a single pooled Text object.
   */
  damageNumber(x: number, y: number, amount: number, color = '#ffffff', big = false): void {
    const rounded = Math.round(amount);
    if (rounded <= 0) return;
    for (const n of this.numbers) {
      if (n.active) continue;
      n.txt
        .setText(`${rounded}`)
        .setFontSize(big ? 22 : 16)
        .setPosition(x + (Math.random() - 0.5) * 14, y)
        .setColor(color)
        .setVisible(true)
        .setAlpha(1)
        .setScale(big ? 1.25 : 1);
      n.vy = big ? -1.5 : -1.1;
      n.life = big ? 46 : 40;
      n.maxLife = n.life;
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
      p.vy += p.gravity;
      p.spr.x += p.vx;
      p.spr.y += p.vy;
      p.vx *= p.drag;
      p.vy *= p.drag;
      p.life -= 1;
      const t = p.life / p.maxLife;
      p.spr.setAlpha(Math.max(0, t));
      // Radius eases between baseR*grow (at death) and baseR (at birth) so
      // embers shrink and sparkles briefly swell.
      p.spr.setRadius(Math.max(0.3, p.baseR * (p.grow + (1 - p.grow) * t)));
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
