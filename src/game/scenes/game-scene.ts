/**
 * GameScene - the M1 vertical slice.
 *
 * Owns a pure LevelRunner and drives it with the fixed-timestep accumulator
 * (<= 5 ticks/frame, slow down never skip). Rendering interpolates between the
 * previous and current sim states for smooth visuals; input is sampled per
 * frame and applied at tick boundaries. Pauses on visibilitychange.
 *
 * Everything simulation-affecting goes through the pure sim; this scene only
 * reads sim state to draw it, and turns device input into InputFrames. A
 * dev-only hook (window.__SQUAD) feeds tick-exact InputFrames through the same
 * pipeline for e2e + solution replays.
 */

import Phaser from 'phaser';
import {
  LevelRunner,
  cloneSimState,
  setBossPattern,
  TICK_DT_SECONDS,
  BOSS_RADIUS,
  PHASE1_THRESHOLD,
  classStats,
} from '@sim/index.js';
import type { SimState, Unit, ClassId } from '@sim/index.js';
import { ARENA_01, CLASS_PRESENTATION } from '@content/index.js';
import type { LevelDef } from '@sim/index.js';
import { createInputController, type InputController } from '../input.js';
import { COLORS } from '../render/colors.js';
import { installDevHook, type DevHookApi } from '../dev-hook.js';

const MAX_TICKS_PER_FRAME = 5;

type Phase = 'pick' | 'playing' | 'result';

export class GameScene extends Phaser.Scene {
  private level: LevelDef = ARENA_01;
  private runner!: LevelRunner;
  private controller!: InputController;

  private accumulator = 0;
  private prev!: SimState;
  private phase: Phase = 'pick';
  private paused = false;

  // Render objects.
  private world!: Phaser.GameObjects.Graphics;
  private hud!: Phaser.GameObjects.Graphics;
  private overlay!: Phaser.GameObjects.Container;
  private labels: Phaser.GameObjects.Text[] = [];
  private banner!: Phaser.GameObjects.Text;

  // World->screen transform.
  private originX = 0;
  private originY = 0;
  private scaleWorld = 1;

  private devHook: DevHookApi | null = null;

  constructor() {
    super({ key: 'GameScene' });
  }

  create(): void {
    this.cameras.main.setBackgroundColor(COLORS.bg);
    setBossPattern(this.level.boss.pattern);
    this.runner = new LevelRunner(this.level);
    this.prev = cloneSimState(this.runner.state);
    this.controller = createInputController(this);

    this.world = this.add.graphics();
    this.hud = this.add.graphics();
    this.overlay = this.add.container(0, 0);
    this.banner = this.add
      .text(this.scale.width / 2, this.scale.height / 2 - 40, '', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '30px',
        color: '#e8ecff',
        fontStyle: 'bold',
        align: 'center',
      })
      .setOrigin(0.5)
      .setDepth(20);

    this.computeTransform();
    this.showClassPicker();

    // Pause the loop when the tab is hidden (brief 9.4).
    this.game.events.on(Phaser.Core.Events.HIDDEN, this.onHidden, this);
    this.game.events.on(Phaser.Core.Events.VISIBLE, this.onVisible, this);

    // Dev hook for e2e + scripted replays.
    this.devHook = installDevHook(this);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);

    this.game.events.emit('game-ready');
  }

  private onHidden(): void {
    this.paused = true;
  }
  private onVisible(): void {
    this.paused = false;
  }

  /** Fit the arena into the viewport with margins. */
  private computeTransform(): void {
    const w = this.scale.width;
    const h = this.scale.height;
    const marginTop = 150;
    const marginBottom = 200;
    const usableW = w - 40;
    const usableH = h - marginTop - marginBottom;
    const sx = usableW / (this.level.halfWidth * 2);
    const sy = usableH / (this.level.halfHeight * 2);
    this.scaleWorld = Math.min(sx, sy);
    this.originX = w / 2;
    this.originY = marginTop + usableH / 2;
  }

  private wx(x: number): number {
    return this.originX + x * this.scaleWorld;
  }
  private wy(y: number): number {
    return this.originY + y * this.scaleWorld;
  }
  private ws(u: number): number {
    return u * this.scaleWorld;
  }

  // ---- Class picker ----

  private showClassPicker(): void {
    this.phase = 'pick';
    this.clearOverlay();
    const slot = this.runner.recordingSlot;
    const used = this.runner.usedClasses();
    const cx = this.scale.width / 2;

    const title = this.add
      .text(cx, 210, `Record Slot ${slot + 1} of ${this.level.slotCount}`, {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '20px',
        color: '#e8ecff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    this.overlay.add(title);
    const sub = this.add
      .text(cx, 240, 'Pick a class (each usable once)', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '14px',
        color: '#8a93b8',
      })
      .setOrigin(0.5);
    this.overlay.add(sub);

    const ids: ClassId[] = ['guardian', 'medic', 'ranger'];
    ids.forEach((id, i) => {
      const pres = CLASS_PRESENTATION[id];
      const y = 300 + i * 120;
      const disabled = used.includes(id);
      const card = this.add.graphics();
      card.fillStyle(disabled ? 0x1a1f30 : 0x1f2740, 1);
      card.lineStyle(2, disabled ? 0x333c58 : pres.color, 1);
      card.fillRoundedRect(cx - 150, y - 45, 300, 96, 12);
      card.strokeRoundedRect(cx - 150, y - 45, 300, 96, 12);
      this.overlay.add(card);

      const name = this.add
        .text(cx - 120, y - 32, `${pres.name}  ·  ${pres.role}`, {
          fontFamily: 'system-ui, sans-serif',
          fontSize: '18px',
          color: disabled ? '#556' : '#e8ecff',
          fontStyle: 'bold',
        })
        .setOrigin(0, 0);
      this.overlay.add(name);
      const blurb = this.add
        .text(cx - 120, y - 6, pres.blurb, {
          fontFamily: 'system-ui, sans-serif',
          fontSize: '12px',
          color: disabled ? '#445' : '#aab',
          wordWrap: { width: 250 },
        })
        .setOrigin(0, 0);
      this.overlay.add(blurb);

      if (disabled) {
        const usedTxt = this.add
          .text(cx + 120, y - 32, 'used', { fontSize: '12px', color: '#667' })
          .setOrigin(1, 0);
        this.overlay.add(usedTxt);
      } else {
        const hit = this.add
          .zone(cx, y, 300, 96)
          .setOrigin(0.5)
          .setInteractive({ useHandCursor: true });
        hit.on('pointerdown', () => this.pickClass(id));
        this.overlay.add(hit);
      }
    });

    this.banner.setText('');
  }

  /** Public entry so the dev hook can drive class selection. */
  pickClass(id: ClassId): void {
    if (this.phase !== 'pick') return;
    if (this.runner.usedClasses().includes(id)) return;
    this.runner.chooseClass(id);
    this.prev = cloneSimState(this.runner.state);
    this.accumulator = 0;
    this.clearOverlay();
    this.phase = 'playing';
  }

  private clearOverlay(): void {
    this.overlay.removeAll(true);
  }

  // ---- Main loop ----

  override update(_time: number, deltaMs: number): void {
    this.controller.sample();

    if (this.phase === 'playing' && !this.paused) {
      this.accumulator += Math.min(deltaMs / 1000, 0.25);
      let ticks = 0;
      while (this.accumulator >= TICK_DT_SECONDS && ticks < MAX_TICKS_PER_FRAME) {
        this.prev = cloneSimState(this.runner.state);
        const tick = this.runner.state.tick;
        const live = this.controller.frameForTick(tick);
        const result = this.runner.tickWith(live);
        this.accumulator -= TICK_DT_SECONDS;
        ticks++;
        if (this.runner.needsClassChoice()) {
          // A loop ended without a win: move to the next slot's class pick.
          this.showClassPicker();
          this.accumulator = 0;
          break;
        }
        if (result !== 'in_progress') {
          this.showResult(result);
          this.accumulator = 0;
          break;
        }
      }
      if (this.accumulator >= TICK_DT_SECONDS) this.accumulator = 0; // slow down
    }

    const alpha = this.phase === 'playing' ? this.accumulator / TICK_DT_SECONDS : 0;
    this.draw(alpha);
  }

  private showResult(result: string): void {
    this.phase = 'result';
    const stars = this.runner.computeStars();
    if (result === 'won') {
      const early = stars.earlyVictory ? '  ·  Early Victory!' : '';
      this.banner.setText(`VICTORY${early}`);
      this.drawStars(stars.count);
    } else {
      this.banner.setText('TIMELINE FAILED');
    }
    // Offer a restart.
    const cx = this.scale.width / 2;
    const btn = this.add.graphics();
    btn.fillStyle(0x2b60ff, 1);
    btn.fillRoundedRect(cx - 90, this.scale.height - 150, 180, 52, 10);
    this.overlay.add(btn);
    const label = this.add
      .text(cx, this.scale.height - 124, 'Restart', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '18px',
        color: '#ffffff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    this.overlay.add(label);
    const hit = this.add
      .zone(cx, this.scale.height - 124, 180, 52)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    hit.on('pointerdown', () => this.restart());
    this.overlay.add(hit);
  }

  /** Draw `count` filled stars (of 3) below the victory banner, as graphics. */
  private drawStars(count: number): void {
    const cx = this.scale.width / 2;
    const y = this.scale.height / 2 + 6;
    const g = this.add.graphics().setDepth(21);
    for (let i = 0; i < 3; i++) {
      const sx = cx - 44 + i * 44;
      const filled = i < count;
      this.starShape(g, sx, y, 15, filled ? 0xffd24a : 0x39415c);
    }
    this.overlay.add(g);
  }

  private starShape(g: Phaser.GameObjects.Graphics, cx: number, cy: number, r: number, color: number): void {
    const pts: Phaser.Math.Vector2[] = [];
    for (let i = 0; i < 10; i++) {
      const rad = i % 2 === 0 ? r : r * 0.45;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      pts.push(new Phaser.Math.Vector2(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad));
    }
    g.fillStyle(color, 1);
    g.fillPoints(pts, true);
  }

  /**
   * Fast-forward the current loop deterministically (dev/e2e only). Steps the
   * runner without the wall clock, feeding the scripted input source, and
   * mirrors the update() transitions (class pick / result). No-op unless a
   * scripted source is installed, so it cannot affect live play.
   */
  fastForward(maxTicks: number): void {
    if (this.phase !== 'playing') return;
    if (!this.controller.scripted) return;
    for (let i = 0; i < maxTicks; i++) {
      this.prev = cloneSimState(this.runner.state);
      const tick = this.runner.state.tick;
      const live = this.controller.frameForTick(tick);
      const result = this.runner.tickWith(live);
      if (this.runner.needsClassChoice()) {
        this.showClassPicker();
        this.accumulator = 0;
        return;
      }
      if (result !== 'in_progress') {
        this.showResult(result);
        this.accumulator = 0;
        return;
      }
    }
  }

  /** Restart the whole level (first-pass fail -> Restart; Rewrite is M2). */
  restart(): void {
    setBossPattern(this.level.boss.pattern);
    this.runner = new LevelRunner(this.level);
    this.prev = cloneSimState(this.runner.state);
    this.accumulator = 0;
    this.controller.setScriptedSource(null);
    this.showClassPicker();
  }

  // ---- Rendering ----

  private draw(alpha: number): void {
    this.world.clear();
    this.hud.clear();
    this.disposeLabels();

    const cur = this.runner.state;
    this.drawArena();
    this.drawAttacks(cur);
    this.drawUnits(cur, this.prev, alpha);
    this.drawProjectiles(cur, this.prev, alpha);
    this.drawThreatLine(cur, alpha);
    this.drawHud(cur);
  }

  private disposeLabels(): void {
    for (const l of this.labels) l.destroy();
    this.labels.length = 0;
  }

  private label(x: number, y: number, text: string, size: number, color: string, bold = false): void {
    const t = this.add
      .text(x, y, text, {
        fontFamily: 'system-ui, sans-serif',
        fontSize: `${size}px`,
        color,
        fontStyle: bold ? 'bold' : 'normal',
      })
      .setOrigin(0.5)
      .setDepth(8);
    this.labels.push(t);
  }

  private drawArena(): void {
    const g = this.world;
    const x = this.wx(-this.level.halfWidth);
    const y = this.wy(-this.level.halfHeight);
    const w = this.ws(this.level.halfWidth * 2);
    const h = this.ws(this.level.halfHeight * 2);
    g.fillStyle(COLORS.arena, 1);
    g.fillRoundedRect(x, y, w, h, 14);
    g.lineStyle(2, COLORS.arenaEdge, 1);
    g.strokeRoundedRect(x, y, w, h, 14);
  }

  private lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
  }

  private unitById(state: SimState, id: number): Unit | undefined {
    for (const u of state.units) if (u.id === id) return u;
    return undefined;
  }

  private drawUnits(cur: SimState, prev: SimState, alpha: number): void {
    const g = this.world;
    for (const u of cur.units) {
      const p = this.unitById(prev, u.id);
      const ix = p ? this.lerp(p.x, u.x, alpha) : u.x;
      const iy = p ? this.lerp(p.y, u.y, alpha) : u.y;
      const sx = this.wx(ix);
      const sy = this.wy(iy);

      if (u.kind === 'boss') {
        if (!u.alive) continue;
        const r = this.ws(BOSS_RADIUS);
        g.fillStyle(COLORS.boss, 1);
        g.fillCircle(sx, sy, r);
        g.fillStyle(COLORS.bossCore, 1);
        g.fillCircle(sx, sy, r * 0.45);
        // Facing tick.
        const fx = sx + Math.cos((u.facing / 4096) * Math.PI * 2) * r;
        const fy = sy + Math.sin((u.facing / 4096) * Math.PI * 2) * r;
        g.lineStyle(3, 0xffffff, 0.8);
        g.lineBetween(sx, sy, fx, fy);
        continue;
      }

      if (!u.alive) {
        // Dead player-team unit: faint marker.
        g.fillStyle(0x33384a, 0.5);
        g.fillCircle(sx, sy, this.ws(10));
        continue;
      }

      const cls = u.classId as ClassId;
      const pres = CLASS_PRESENTATION[cls];
      const isYou = u.kind === 'player';
      const r = Math.max(11, this.ws(20));
      const alphaFill = isYou ? 1 : 0.55;
      g.fillStyle(pres.color, alphaFill);
      this.drawSilhouette(g, sx, sy, r, pres.silhouette, u.facing);
      if (isYou) {
        g.lineStyle(3, COLORS.youOutline, 1);
        g.strokeCircle(sx, sy, r + 3);
      }
      // Sanctuary aura.
      if (u.sanctuaryTicks > 0) {
        g.lineStyle(2, 0x81c784, 0.5);
        g.strokeCircle(sx, sy, r + 8);
      }
      // Charge indicator (Ranger).
      if (u.chargeTicks > 0) {
        g.lineStyle(3, 0xffe08a, 0.9);
        g.strokeCircle(sx, sy, r + 6);
      }

      // Mini HP bar + badge.
      const barW = this.ws(34);
      const bx = sx - barW / 2;
      const by = sy - r - 12;
      g.fillStyle(COLORS.hpBack, 0.9);
      g.fillRect(bx, by, barW, 4);
      const frac = Math.max(0, u.hp / u.maxHp);
      g.fillStyle(frac > 0.35 ? COLORS.hpFill : COLORS.hpFillLow, 1);
      g.fillRect(bx, by, barW * frac, 4);

      const badge = isYou ? 'YOU' : `${u.slot + 1}`;
      this.label(sx, sy, badge, isYou ? 9 : 10, isYou ? '#ffffff' : '#0b0f1a', true);
    }
  }

  private drawSilhouette(
    g: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    r: number,
    shape: string,
    facing: number,
  ): void {
    if (shape === 'shield') {
      g.fillRoundedRect(x - r, y - r, r * 2, r * 2, 4);
    } else if (shape === 'cross') {
      g.fillCircle(x, y, r);
    } else {
      // arrow: triangle pointing along facing.
      const a = (facing / 4096) * Math.PI * 2;
      const tip = { x: x + Math.cos(a) * r * 1.4, y: y + Math.sin(a) * r * 1.4 };
      const back1 = { x: x + Math.cos(a + 2.5) * r, y: y + Math.sin(a + 2.5) * r };
      const back2 = { x: x + Math.cos(a - 2.5) * r, y: y + Math.sin(a - 2.5) * r };
      g.fillTriangle(tip.x, tip.y, back1.x, back1.y, back2.x, back2.y);
    }
  }

  private drawProjectiles(cur: SimState, prev: SimState, alpha: number): void {
    const g = this.world;
    for (const p of cur.projectiles) {
      const pp = prev.projectiles.find((q) => q.id === p.id);
      const ix = pp ? this.lerp(pp.x, p.x, alpha) : p.x;
      const iy = pp ? this.lerp(pp.y, p.y, alpha) : p.y;
      const sx = this.wx(ix);
      const sy = this.wy(iy);
      if (p.piercing) {
        g.fillStyle(0xffe08a, 1);
        g.fillCircle(sx, sy, this.ws(7));
      } else {
        g.fillStyle(0xffd27a, 1);
        g.fillCircle(sx, sy, this.ws(4));
      }
    }
  }

  private drawAttacks(cur: SimState): void {
    const g = this.world;
    for (const a of cur.attacks) {
      const telegraphing = a.telegraphTicks > 0;
      const color = telegraphing ? COLORS.telegraph : COLORS.telegraphSafe;
      const fillAlpha = telegraphing ? 0.22 : 0.4;
      const sx = this.wx(a.x);
      const sy = this.wy(a.y);
      if (a.shape === 'slam') {
        g.fillStyle(color, fillAlpha);
        g.fillCircle(sx, sy, this.ws(a.radius));
        g.lineStyle(2, color, 0.9);
        g.strokeCircle(sx, sy, this.ws(a.radius));
      } else if (a.shape === 'cone') {
        this.drawCone(g, sx, sy, this.ws(a.radius), a.angle, a.halfArc, color, fillAlpha);
      } else {
        // charge lane
        const ang = (a.angle / 4096) * Math.PI * 2;
        const dx = Math.cos(ang);
        const dy = Math.sin(ang);
        const len = this.ws(a.radius);
        const halfW = this.ws(a.halfArc);
        const ex = sx + dx * len;
        const ey = sy + dy * len;
        const nx = -dy * halfW;
        const ny = dx * halfW;
        g.fillStyle(color, fillAlpha);
        g.fillPoints(
          [
            new Phaser.Math.Vector2(sx + nx, sy + ny),
            new Phaser.Math.Vector2(ex + nx, ey + ny),
            new Phaser.Math.Vector2(ex - nx, ey - ny),
            new Phaser.Math.Vector2(sx - nx, sy - ny),
          ],
          true,
        );
      }
    }
  }

  private drawCone(
    g: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    radius: number,
    angle: number,
    halfArc: number,
    color: number,
    fillAlpha: number,
  ): void {
    const a0 = ((angle - halfArc) / 4096) * Math.PI * 2;
    const a1 = ((angle + halfArc) / 4096) * Math.PI * 2;
    const pts: Phaser.Math.Vector2[] = [new Phaser.Math.Vector2(x, y)];
    const steps = 12;
    for (let i = 0; i <= steps; i++) {
      const a = a0 + ((a1 - a0) * i) / steps;
      pts.push(new Phaser.Math.Vector2(x + Math.cos(a) * radius, y + Math.sin(a) * radius));
    }
    g.fillStyle(color, fillAlpha);
    g.fillPoints(pts, true);
  }

  private drawThreatLine(cur: SimState, alpha: number): void {
    const boss = cur.units.find((u) => u.kind === 'boss');
    if (!boss || !boss.alive || cur.boss.targetId < 0) return;
    const target = this.unitById(cur, cur.boss.targetId);
    if (!target || !target.alive) return;
    const pboss = this.unitById(this.prev, boss.id);
    const bx = this.wx(pboss ? this.lerp(pboss.x, boss.x, alpha) : boss.x);
    const by = this.wy(pboss ? this.lerp(pboss.y, boss.y, alpha) : boss.y);
    const ptar = this.unitById(this.prev, target.id);
    const tx = this.wx(ptar ? this.lerp(ptar.x, target.x, alpha) : target.x);
    const ty = this.wy(ptar ? this.lerp(ptar.y, target.y, alpha) : target.y);
    this.world.lineStyle(2, COLORS.threatLine, 0.6);
    this.world.lineBetween(bx, by, tx, ty);
  }

  private drawHud(cur: SimState): void {
    const g = this.hud;
    const w = this.scale.width;

    // --- Boss HP bar with phase ticks (top) ---
    const boss = cur.units.find((u) => u.kind === 'boss');
    if (boss) {
      const bw = w - 80;
      const bx = 40;
      const by = 40;
      g.fillStyle(COLORS.hpBack, 1);
      g.fillRoundedRect(bx, by, bw, 14, 6);
      const frac = Math.max(0, boss.hp / boss.maxHp);
      g.fillStyle(COLORS.boss, 1);
      g.fillRoundedRect(bx, by, bw * frac, 14, 6);
      // Phase-1 threshold tick.
      const tickX = bx + bw * PHASE1_THRESHOLD;
      g.lineStyle(2, 0xffffff, 0.8);
      g.lineBetween(tickX, by - 3, tickX, by + 17);
      this.label(w / 2, 25, `THE WARDEN   ${Math.ceil(boss.hp)} / ${boss.maxHp}`, 12, '#e8ecff', true);
    }

    // --- Slot timeline (class icon + alive/dead) top-left under boss bar ---
    const slotY = 70;
    for (let s = 0; s < this.level.slotCount; s++) {
      const sx = 52 + s * 44;
      const cls = cur.slotClasses[s];
      const unit = cur.units.find((u) => u.slot === s && (u.kind === 'player' || u.kind === 'echo'));
      const isRecording = s === this.runner.recordingSlot && this.phase !== 'result';
      g.lineStyle(isRecording ? 3 : 1, isRecording ? 0xffffff : 0x3a4358, 1);
      if (cls) {
        const pres = CLASS_PRESENTATION[cls];
        const alive = unit ? unit.alive : true;
        g.fillStyle(pres.color, alive ? 1 : 0.25);
      } else {
        g.fillStyle(0x2a3350, 1);
      }
      g.fillRoundedRect(sx - 16, slotY - 16, 32, 32, 6);
      g.strokeRoundedRect(sx - 16, slotY - 16, 32, 32, 6);
      const short = cls ? CLASS_PRESENTATION[cls].name[0] : '·';
      this.label(sx, slotY, short ?? '·', 14, '#0b0f1a', true);
    }

    // --- Loop timer ring (top-right) ---
    const ringX = w - 46;
    const ringY = 76;
    const ringR = 20;
    const tfrac = Math.min(1, cur.tick / cur.loopLength);
    g.lineStyle(4, 0x2a3350, 1);
    g.strokeCircle(ringX, ringY, ringR);
    this.drawStrokeArc(g, ringX, ringY, ringR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - tfrac), 0x64b5ff, 4);
    const secsLeft = Math.max(0, Math.ceil((cur.loopLength - cur.tick) / 60));
    this.label(ringX, ringY, `${secsLeft}`, 13, '#e8ecff', true);

    // --- Cooldown rings for the live player (bottom) ---
    const you = cur.units.find((u) => u.kind === 'player' && u.alive);
    if (you && you.classId) {
      const stats = classStats(you.classId);
      const baseY = this.scale.height - 70;
      this.drawCooldown(g, this.scale.width - 60, baseY, 26, you.skillCd, stats.skillCd, 0xffcf5a, 'SKL');
      this.drawCooldown(g, this.scale.width - 122, baseY, 24, you.dashCd, stats.dashCd, 0x64b5ff, 'DSH');
    }
  }

  private drawCooldown(
    g: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    r: number,
    cd: number,
    max: number,
    color: number,
    label: string,
  ): void {
    // Base disc.
    g.fillStyle(0x1a2036, 0.95);
    g.fillCircle(x, y, r);
    const ready = cd <= 0 || max <= 0;
    if (ready) {
      // Ready: bright full ring.
      g.lineStyle(3, color, 1);
      g.strokeCircle(x, y, r);
    } else {
      // On cooldown: dim ring + a shrinking sweep that empties as it recharges.
      g.lineStyle(3, 0x39415c, 1);
      g.strokeCircle(x, y, r);
      const frac = cd / max; // 1 -> just used, 0 -> ready
      const start = -Math.PI / 2;
      const end = start + Math.PI * 2 * (1 - frac);
      this.drawStrokeArc(g, x, y, r, start, end, color, 3);
    }
    this.label(x, y, label, 9, ready ? '#e8ecff' : '#8a93b8', true);
  }

  private drawStrokeArc(
    g: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    r: number,
    start: number,
    end: number,
    color: number,
    width: number,
  ): void {
    if (end <= start) return;
    g.lineStyle(width, color, 0.95);
    g.beginPath();
    g.arc(x, y, r, start, end, false);
    g.strokePath();
  }

  private onShutdown(): void {
    this.game.events.off(Phaser.Core.Events.HIDDEN, this.onHidden, this);
    this.game.events.off(Phaser.Core.Events.VISIBLE, this.onVisible, this);
    this.controller?.destroy();
    this.devHook?.dispose();
  }

  // Expose for the dev hook.
  getRunner(): LevelRunner {
    return this.runner;
  }
  getInput(): InputController {
    return this.controller;
  }
  getPhase(): Phase {
    return this.phase;
  }
}
