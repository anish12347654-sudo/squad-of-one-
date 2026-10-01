/**
 * FirstTimeExperienceScene (brief section 8): the "aha" onboarding.
 *
 * Opens straight into gameplay. Loop 1: you fight a training golem ALONE and
 * are designed to fall short before the loop ends. A short rewind plays. Loop 2:
 * your recorded past self (an echo) fights beside you and the golem falls. The
 * whole beat lands well within 60 seconds, then marks seenIntro and hands off to
 * the world map.
 *
 * It runs a small self-contained encounter through the PURE sim (deterministic),
 * so there is no dependency on the full GameScene wiring. Rendering is minimal
 * vector art; captions are localized.
 */

import Phaser from 'phaser';
import {
  createLevelState,
  step,
  setEchoInputs,
  setEchoRecordings,
  setBossPattern,
  setLevelMinions,
  emptyInput,
  atan2Brads,
  BOSS_RADIUS,
  type SimState,
  type LevelDef,
  type InputFrame,
} from '@sim/index.js';
import { getAudioEngine } from '@audio/audio-engine.js';
import { updateSave, getSave, reducedMotion, reducedFlashing } from './save-context.js';
import { UI_COLORS } from './ui-kit.js';
import { mountBackdrop } from './scene-backdrop.js';
import { fontFamilyForCurrentLocale } from '@i18n/fonts.js';
import { t } from '@i18n/index.js';
import { COLORS, GLOWS, TINTS, lighten, darken } from '@game/render/colors.js';

export const SCENE_FTE = 'ui-fte';

const SECOND = 60;

/** A tiny 2-slot training arena: one weak "golem" boss, gentle slam pattern. */
const GOLEM_ARENA: LevelDef = {
  id: 'fte-golem',
  halfWidth: 360,
  halfHeight: 360,
  loopLength: 6 * SECOND,
  slotCount: 2,
  spawns: [
    { x: -60, y: 200, facing: 3072 },
    { x: 60, y: 200, facing: 3072 },
  ],
  boss: {
    x: 0,
    y: -160,
    maxHp: 260,
    radius: 44,
    speed: 60,
    phaseThreshold: 0.5,
    pattern: [
      { shape: 'slam', telegraphTicks: 50, activeTicks: 6, recoveryTicks: 60, radius: 120, halfArc: 0, damage: 10, maxHpFraction: 1 },
    ],
  },
  starEchoesAlive: 0,
};

type Stage = 'intro' | 'loop1' | 'fail' | 'rewind' | 'loop2' | 'win' | 'done';

export class FirstTimeExperienceScene extends Phaser.Scene {
  private g!: Phaser.GameObjects.Graphics;
  private caption!: Phaser.GameObjects.Text;
  private state!: SimState;
  private stage: Stage = 'intro';
  private stageTimer = 0;
  private recording: InputFrame[] = [];
  private originX = 0;
  private originY = 0;
  private scaleWorld = 1;
  /** Presentation-only animation clock (ms), used for glow/core pulsing. */
  private clock = 0;

  constructor() {
    super({ key: SCENE_FTE });
  }

  create(): void {
    // A dev/e2e deep-link (?scene= or ?level=) takes over routing in main.ts;
    // the FTE must not also start the title menu (which would run two scenes).
    if (typeof window !== 'undefined') {
      const q = new URLSearchParams(window.location.search);
      if (q.get('scene') || q.get('level')) {
        this.scene.stop();
        return;
      }
    }
    // Returning players skip straight to the menu.
    if (getSave().seenIntro) {
      this.scene.start('ui-title');
      return;
    }
    const { width, height } = this.scale;
    this.cameras.main.setBackgroundColor(UI_COLORS.bg);
    // Premium animated backdrop so the very first impression reads as polished.
    mountBackdrop(this);
    this.originX = width / 2;
    this.originY = height * 0.42;
    this.scaleWorld = Math.min((width - 60) / (GOLEM_ARENA.halfWidth * 2), (height * 0.5) / (GOLEM_ARENA.halfHeight * 2));

    this.g = this.add.graphics();
    this.caption = this.add
      .text(width / 2, height - 70, '', {
        fontFamily: fontFamilyForCurrentLocale(),
        fontSize: '16px',
        color: UI_COLORS.text,
        align: 'center',
        wordWrap: { width: width - 40 },
      })
      .setOrigin(0.5)
      .setName('fte-caption');
    this.caption.setShadow(0, 0, '#64b5ff', 10, true, true);

    // Let a tap skip the whole intro (accessibility / returning players).
    const skip = (): void => this.finish();
    this.input.keyboard?.on('keydown-ESC', skip);

    // Allow audio start on first tap.
    this.input.once('pointerdown', () => {
      const a = getAudioEngine();
      a.unlock();
      a.startMusic();
    });

    this.beginStage('intro');
    this.game.events.emit('fte-ready');
  }

  private beginStage(stage: Stage): void {
    this.stage = stage;
    this.stageTimer = 0;
    if (stage === 'intro') {
      this.setCaption('fte.line1');
      this.resetSim(1); // one live player, no echo
    } else if (stage === 'loop1') {
      this.setCaption('fte.line2');
      this.recording = [];
      this.resetSim(1);
    } else if (stage === 'fail') {
      this.setCaption('fte.fail');
      getAudioEngine().sfx('hit');
    } else if (stage === 'rewind') {
      this.setCaption('hud.rewind');
    } else if (stage === 'loop2') {
      this.setCaption('fte.line3');
      this.resetSim(2); // live player + one echo replaying loop 1
    } else if (stage === 'win') {
      this.setCaption('fte.win');
      getAudioEngine().sfx('victory');
    } else if (stage === 'done') {
      this.finish();
    }
  }

  private setCaption(key: string): void {
    this.caption.setText(t(key));
  }

  /** Build a fresh sim state with `slots` player slots (2 = echo present). */
  private resetSim(slots: number): void {
    setBossPattern(GOLEM_ARENA.boss.pattern);
    setLevelMinions([]);
    // Loop 1: only slot 0 exists (you are alone). Loop 2: slot 1 is live and
    // slot 0 replays as your echo.
    if (slots === 2) {
      this.state = createLevelState(GOLEM_ARENA, 1, ['ranger', 'ranger'], true);
    } else {
      this.state = createLevelState(GOLEM_ARENA, 0, ['ranger', null], true);
    }
  }

  override update(_time: number, deltaMs: number): void {
    if (this.stage === 'done') return;
    this.stageTimer += deltaMs;
    this.clock += deltaMs;

    // Fixed-ish stepping: advance the sim while in a play stage.
    const playing = this.stage === 'loop1' || this.stage === 'loop2';
    if (playing) {
      const stepsThisFrame = Math.min(5, Math.max(1, Math.round(deltaMs / (1000 / 60))));
      for (let i = 0; i < stepsThisFrame; i++) this.tickOnce();
    }

    this.render();
    this.advanceStage();
  }

  /** Drive one sim tick with a simple scripted "attack the golem" input. */
  private tickOnce(): void {
    if (this.state.outcome !== 'running') return;
    const boss = this.state.units.find((u) => u.kind === 'boss');
    const me = this.state.units.find((u) => u.kind === 'player');
    let input = emptyInput();
    if (boss && me) {
      const aim = (atan2Brads(boss.y - me.y, boss.x - me.x) >> 4) & 0xff;
      // Keep a ranged standoff and fire (ranger auto-fires within range).
      const d = Math.hypot(boss.x - me.x, boss.y - me.y);
      let moveX = 0;
      let moveY = 0;
      if (d > 220) {
        const len = d || 1;
        moveX = Math.round(((boss.x - me.x) / len) * 100);
        moveY = Math.round(((boss.y - me.y) / len) * 100);
      }
      input = { moveX, moveY, aim, aimActive: true, buttons: 0 };
    }

    // Echo (slot 0) replays loop 1's recording during loop 2.
    if (this.stage === 'loop2') {
      const echoBuf = new Map<number, InputFrame>();
      const t = this.state.tick;
      echoBuf.set(0, t < this.recording.length ? this.recording[t]! : emptyInput());
      setEchoInputs(echoBuf);
    } else {
      setEchoInputs(new Map());
      // Record loop-1 inputs so the echo can replay them.
      this.recording.push({ ...input });
    }
    setEchoRecordings(new Map());
    this.state = step(this.state, input);
  }

  private advanceStage(): void {
    switch (this.stage) {
      case 'intro':
        if (this.stageTimer > 2200) this.beginStage('loop1');
        break;
      case 'loop1':
        // Loop 1 ends (timeout by design) or golem somehow dies early.
        if (this.state.outcome !== 'running' || this.state.tick >= GOLEM_ARENA.loopLength) {
          this.beginStage(this.state.outcome === 'won' ? 'win' : 'fail');
        }
        break;
      case 'fail':
        if (this.stageTimer > 1600) this.beginStage('rewind');
        break;
      case 'rewind':
        if (this.stageTimer > 1400) this.beginStage('loop2');
        break;
      case 'loop2':
        if (this.state.outcome === 'won') this.beginStage('win');
        else if (this.state.tick >= GOLEM_ARENA.loopLength) this.beginStage('win'); // safety: still celebrate
        break;
      case 'win':
        if (this.stageTimer > 2600) this.beginStage('done');
        break;
      default:
        break;
    }
  }

  private wx(x: number): number {
    return this.originX + x * this.scaleWorld;
  }
  private wy(y: number): number {
    return this.originY + y * this.scaleWorld;
  }

  /**
   * Premium presentation layer, mirroring the GameScene look so the very first
   * screen reads as the same polished game: entities get a soft glow halo, a
   * gradient body (darker base + lighter top cap), a bright energy core with a
   * white highlight and a class/identity rim; the slam telegraph + active slam
   * bloom instead of a flat disc; projectiles get a glow; the arena floor has
   * gradient + edge depth. Cheap (reuses the single `this.g`, no per-frame
   * allocations) and accessibility-aware (reduced motion/flashing tone down the
   * pulsing + glow). Purely cosmetic: never reads back into the sim.
   */
  private render(): void {
    const g = this.g;
    g.clear();

    const calm = reducedMotion();
    // Slow glow/core pulse (static when reduced motion is on).
    const pulse = calm ? 0.5 : 0.5 + 0.5 * Math.sin(this.clock * 0.004);
    // Scales down bloom/flash intensity when reduced flashing is requested.
    const flashK = reducedFlashing() ? 0.5 : 1;

    this.drawArena(g, pulse, flashK);

    // Rewind flourish: draw scanlines when rewinding.
    if (this.stage === 'rewind') {
      g.lineStyle(1, GLOWS.accent, 0.3 * flashK);
      for (let yy = -GOLEM_ARENA.halfHeight; yy < GOLEM_ARENA.halfHeight; yy += 18) {
        g.lineBetween(this.wx(-GOLEM_ARENA.halfWidth), this.wy(yy), this.wx(GOLEM_ARENA.halfWidth), this.wy(yy));
      }
    }

    for (const a of this.state?.attacks ?? []) {
      if (a.shape !== 'slam') continue;
      this.drawSlam(g, a.x, a.y, a.radius * this.scaleWorld, a.telegraphTicks > 0, pulse, flashK);
    }

    for (const p of this.state?.projectiles ?? []) {
      this.drawProjectile(g, this.wx(p.x), this.wy(p.y));
    }

    for (const u of this.state?.units ?? []) {
      if (!u.alive) continue;
      if (u.kind === 'boss') {
        this.drawGolem(g, this.wx(u.x), this.wy(u.y), BOSS_RADIUS * this.scaleWorld, Math.max(0, u.hp / u.maxHp), pulse, flashK);
      } else {
        this.drawUnit(g, this.wx(u.x), this.wy(u.y), u.kind === 'player', flashK);
      }
    }
  }

  /** Arena floor with a soft vertical gradient + a glowing edge for depth. */
  private drawArena(g: Phaser.GameObjects.Graphics, pulse: number, flashK: number): void {
    const x = this.wx(-GOLEM_ARENA.halfWidth);
    const y = this.wy(-GOLEM_ARENA.halfHeight);
    const w = GOLEM_ARENA.halfWidth * 2 * this.scaleWorld;
    const h = GOLEM_ARENA.halfHeight * 2 * this.scaleWorld;
    // Dropped shadow beneath the floor so it reads as a raised slab.
    g.fillStyle(TINTS.shadow, 0.45);
    g.fillRoundedRect(x - 3, y + 4, w + 6, h + 6, 12);
    // Gradient fill (darker base + lighter top cap) via two stacked rounds.
    g.fillStyle(darken(COLORS.arena, 0.25), 1);
    g.fillRoundedRect(x, y, w, h, 10);
    g.fillStyle(lighten(COLORS.arena, 0.1), 0.5);
    g.fillRoundedRect(x, y, w, h * 0.55, 10);
    // Soft inner vignette toward the base.
    g.fillStyle(TINTS.innerDark, 0.4);
    g.fillRoundedRect(x, y + h * 0.6, w, h * 0.4, 10);
    // Glowing edge (gentle pulse) + crisp rim.
    g.lineStyle(3, COLORS.arenaEdge, (0.4 + pulse * 0.25) * flashK);
    g.strokeRoundedRect(x, y, w, h, 10);
    g.lineStyle(1, lighten(COLORS.arenaEdge, 0.3), 0.6);
    g.strokeRoundedRect(x + 1.5, y + 1.5, w - 3, h - 3, 9);
  }

  /**
   * Friendly/echo unit: soft glow halo + gradient body + bright energy core
   * with a white highlight + rim (the live "you" gets a bright white rim, the
   * echo a class-coloured rim). Mirrors GameScene drawUnits().
   */
  private drawUnit(g: Phaser.GameObjects.Graphics, sx: number, sy: number, isYou: boolean, flashK: number): void {
    const base = isYou ? GLOWS.accent : 0x9d8cff;
    const r = 13;
    const bodyAlpha = isYou ? 1 : 0.78;
    const topCol = lighten(base, isYou ? 0.35 : 0.2);
    const botCol = darken(base, 0.35);

    // Soft outer glow halo.
    g.fillStyle(base, (isYou ? 0.24 : 0.16) * flashK);
    g.fillCircle(sx, sy, r + (isYou ? 9 : 6));

    // Gradient body: darker base + lighter top cap.
    g.fillStyle(botCol, bodyAlpha);
    g.fillCircle(sx, sy, r);
    g.fillStyle(topCol, bodyAlpha * 0.65);
    g.fillCircle(sx, sy - r * 0.28, r * 0.82);

    // Bright energy core + white highlight dot.
    g.fillStyle(lighten(base, 0.6), isYou ? 0.95 : 0.72);
    g.fillCircle(sx, sy, r * 0.32);
    g.fillStyle(0xffffff, isYou ? 0.9 : 0.6);
    g.fillCircle(sx - r * 0.1, sy - r * 0.1, r * 0.14);

    // Rim: bright white for you, class-coloured for the echo.
    if (isYou) {
      g.lineStyle(3, COLORS.youOutline, 1);
      g.strokeCircle(sx, sy, r + 3);
      g.lineStyle(1.5, lighten(base, 0.4), 0.9);
      g.strokeCircle(sx, sy, r + 5);
    } else {
      g.lineStyle(2, lighten(base, 0.3), 0.9);
      g.strokeCircle(sx, sy, r + 2);
    }
  }

  /**
   * Training golem: a lighter-weight drawBoss — gradient-shaded body, glowing
   * pulsing energy core, outer glow halo, facing-free, with the HP bar on top.
   */
  private drawGolem(g: Phaser.GameObjects.Graphics, sx: number, sy: number, r: number, frac: number, pulse: number, flashK: number): void {
    // Outer glow halo (gently pulsing).
    g.fillStyle(GLOWS.danger, (0.1 + pulse * 0.08) * flashK);
    g.fillCircle(sx, sy, r * (1.3 + pulse * 0.12));

    // Gradient body: darker rim base + lighter top cap.
    g.fillStyle(darken(COLORS.boss, 0.3), 1);
    g.fillCircle(sx, sy, r);
    g.fillStyle(lighten(COLORS.boss, 0.18), 0.9);
    g.fillCircle(sx, sy - r * 0.22, r * 0.82);

    // Glowing energy core (pulses) + white hotspot.
    const coreR = r * (0.4 + pulse * 0.1);
    g.fillStyle(lighten(COLORS.bossCore, pulse * 0.3), 0.95);
    g.fillCircle(sx, sy, coreR);
    g.fillStyle(0xffffff, 0.85);
    g.fillCircle(sx - coreR * 0.15, sy - coreR * 0.15, coreR * 0.4);

    // HP bar (shadowed back + gradient fill), kept above the body.
    const w = r * 2;
    const bx = sx - w / 2;
    const by = sy - r - 12;
    g.fillStyle(TINTS.shadow, 0.5);
    g.fillRect(bx - 1, by - 1, w + 2, 7);
    g.fillStyle(COLORS.hpBack, 0.95);
    g.fillRect(bx, by, w, 5);
    const hpCol = frac > 0.35 ? COLORS.hpFill : COLORS.hpFillLow;
    g.fillStyle(hpCol, 1);
    g.fillRect(bx, by, w * frac, 5);
    g.fillStyle(lighten(hpCol, 0.4), 0.7);
    g.fillRect(bx, by, w * frac, 2);
  }

  /** Slam read: soft outward-booming glow ring + bloom fill + crisp rim. */
  private drawSlam(g: Phaser.GameObjects.Graphics, x: number, y: number, rr: number, telegraphing: boolean, pulse: number, flashK: number): void {
    const sx = this.wx(x);
    const sy = this.wy(y);
    const color = telegraphing ? COLORS.telegraph : COLORS.telegraphSafe;
    const fillAlpha = (telegraphing ? 0.22 : 0.42) * (0.7 + pulse * 0.3) * flashK;
    // Soft glow ring that booms outward with the pulse.
    g.lineStyle(6, color, 0.12 * pulse * flashK);
    g.strokeCircle(sx, sy, rr);
    g.fillStyle(color, fillAlpha);
    g.fillCircle(sx, sy, rr);
    g.lineStyle(2.5, lighten(color, 0.3), 0.95);
    g.strokeCircle(sx, sy, rr);
  }

  /** Projectile: soft glow halo + bright core + white-hot centre. */
  private drawProjectile(g: Phaser.GameObjects.Graphics, sx: number, sy: number): void {
    const col = COLORS.convergence;
    g.fillStyle(col, 0.25);
    g.fillCircle(sx, sy, 8);
    g.fillStyle(col, 1);
    g.fillCircle(sx, sy, 4);
    g.fillStyle(lighten(col, 0.5), 0.9);
    g.fillCircle(sx, sy, 2);
  }

  private finish(): void {
    this.stage = 'done';
    if (!getSave().seenIntro) {
      updateSave((s) => ({ ...s, seenIntro: true }));
    }
    this.scene.start('ui-title');
    this.game.events.emit('fte-done');
  }
}
