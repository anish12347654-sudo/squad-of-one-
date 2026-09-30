/**
 * TimeChessScene (brief section 6.3): the 1v1 arena duel. Five 15-second loops;
 * every loop both sides record simultaneously while all prior loops of both
 * sides replay. Score = control-zone time + units alive at the end.
 *
 * Modes: vs a DETERMINISTIC AI bot (3 difficulties) and local 2-player (split
 * keyboard: P1 WASD+J, P2 arrows+numpad0; split touch zones on tablets). The
 * duel simulation is the pure engine-free Time-Chess sim in src/content; this
 * scene only drives it with input and renders it. All strings via t().
 */

import Phaser from 'phaser';
import { getAudioEngine } from '@audio/audio-engine.js';
import { label, button, panel, UI_COLORS } from './ui-kit.js';
import { t } from '@i18n/index.js';
import {
  beginTcLoop,
  stepTc,
  tcScore,
  aliveCount,
  aiSource,
  defaultPlans,
  TC_CLASSES,
  TC_LOOP_TICKS,
  TC_LOOPS,
  TC_ARENA_HALF,
  TC_ZONE_RADIUS,
  inZone,
  type TcState,
  type TcRecordedLoop,
  type TcLoopPlan,
  type TcInputSource,
  type TcDifficulty,
  type PlayerSide,
} from '@content/index.js';
import { emptyInput, BUTTON_SKILL, atan2Brads } from '@sim/index.js';
import type { InputFrame } from '@sim/index.js';

export const SCENE_TIME_CHESS = 'ui-timechess';

type Mode = 'menu' | 'playing' | 'result';

declare global {
  interface Window {
    __SQUAD_TC?: {
      setDifficulty(d: TcDifficulty): void;
      startVsAi(): void;
      fastForward(): void;
      mode(): Mode;
      scores(): { a: number; b: number };
    };
  }
}

export class TimeChessScene extends Phaser.Scene {
  private mode: Mode = 'menu';
  private difficulty: TcDifficulty = 'normal';
  private local2p = false;

  // Match state.
  private plans: TcLoopPlan[] = [];
  private recorded: TcRecordedLoop[] = [];
  private loop = 0;
  private state!: TcState;
  private framesA: InputFrame[] = [];
  private framesB: InputFrame[] = [];
  private sourceB: TcInputSource = aiSource(1, 'normal');
  private accumulator = 0;

  // Rendering.
  private gfx!: Phaser.GameObjects.Graphics;
  private hud: Phaser.GameObjects.Text[] = [];
  /** Interactive widgets (buttons) for the current screen; destroyed on change. */
  private widgets: Phaser.GameObjects.GameObject[] = [];
  private keys: Record<string, Phaser.Input.Keyboard.Key> = {};

  constructor() {
    super({ key: SCENE_TIME_CHESS });
  }

  create(): void {
    this.cameras.main.setBackgroundColor(UI_COLORS.bg);
    this.gfx = this.add.graphics().setDepth(1);
    this.bindKeys();
    this.showMenu();
    this.installDevHook();
    this.game.events.emit('timechess-ready');
  }

  /** Dev/e2e hook: start + fast-forward a vs-AI match deterministically. */
  private installDevHook(): void {
    if (typeof window === 'undefined') return;
    window.__SQUAD_TC = {
      setDifficulty: (d: TcDifficulty) => {
        this.difficulty = d;
      },
      startVsAi: () => this.startMatch(false),
      fastForward: () => this.fastForwardMatch(),
      mode: () => this.mode,
      scores: () => ({ a: tcScore(this.state, 'a'), b: tcScore(this.state, 'b') }),
    };
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (typeof window !== 'undefined') delete window.__SQUAD_TC;
    });
  }

  private bindKeys(): void {
    const kb = this.input.keyboard;
    if (!kb) return;
    const K = Phaser.Input.Keyboard.KeyCodes;
    this.keys = {
      w: kb.addKey(K.W), a: kb.addKey(K.A), s: kb.addKey(K.S), d: kb.addKey(K.D), j: kb.addKey(K.J),
      up: kb.addKey(K.UP), down: kb.addKey(K.DOWN), left: kb.addKey(K.LEFT), right: kb.addKey(K.RIGHT),
      numpad0: kb.addKey(K.NUMPAD_ZERO), enter: kb.addKey(K.ENTER),
    };
  }

  // ================= Menu =================

  private clearHud(): void {
    for (const h of this.hud) h.destroy();
    this.hud.length = 0;
    for (const w of this.widgets) w.destroy();
    this.widgets.length = 0;
  }

  /** Create a button and track it so clearHud() removes it on a screen change. */
  private btn(
    x: number,
    y: number,
    w: number,
    h: number,
    key: string,
    onClick: () => void,
    opts: { color?: number; params?: Record<string, string | number>; name?: string } = {},
  ): ReturnType<typeof button> {
    const b = button(this, x, y, w, h, key, onClick, opts);
    this.widgets.push(b.container);
    return b;
  }

  private showMenu(): void {
    this.mode = 'menu';
    this.clearHud();
    this.gfx.clear();
    const { width, height } = this.scale;
    const cx = width / 2;

    this.hud.push(label(this, cx, 44, 'timechess.title', { size: 26, bold: true, name: 'tc-title' }));
    this.hud.push(label(this, cx, 76, 'timechess.subtitle', { size: 12, color: UI_COLORS.textDim, wrap: width - 40 }));
    this.hud.push(label(this, cx, 108, 'timechess.rules', { size: 12, color: UI_COLORS.accent2Text, wrap: width - 40 }));

    const diffKeyMap: Record<TcDifficulty, string> = {
      easy: 'timechess.difficulty.easy',
      normal: 'timechess.difficulty.normal',
      hard: 'timechess.difficulty.hard',
    };
    const diffBtn = this.btn(cx, 170, 260, 40, 'timechess.difficulty', () => {
      const order: TcDifficulty[] = ['easy', 'normal', 'hard'];
      this.difficulty = order[(order.indexOf(this.difficulty) + 1) % order.length]!;
      diffBtn.setLabel('timechess.difficulty', { level: t(diffKeyMap[this.difficulty]) });
      getAudioEngine().sfx('ui');
    }, { params: { level: t(diffKeyMap[this.difficulty]) }, name: 'tc-difficulty' });

    this.btn(cx, 226, 260, 44, 'timechess.vsAi', () => this.startMatch(false), {
      color: UI_COLORS.accent2, name: 'tc-vs-ai',
    });
    this.btn(cx, 282, 260, 44, 'timechess.local2p', () => this.startMatch(true), { name: 'tc-2p' });

    this.hud.push(label(this, cx, 336, 'timechess.p1keys', { size: 11, color: UI_COLORS.textDim }));
    this.hud.push(label(this, cx, 356, 'timechess.p2keys', { size: 11, color: UI_COLORS.textDim }));

    this.btn(cx, height - 40, 200, 40, 'menu.back', () => {
      getAudioEngine().sfx('ui');
      this.scene.start('ui-title');
    });
  }

  // ================= Match =================

  /** Start a match. `local2p` false -> side B is the deterministic AI bot. */
  startMatch(local2p: boolean): void {
    getAudioEngine().sfx('ui');
    this.local2p = local2p;
    // Distinct class cycles per side so each side's per-loop class is unique.
    const classesA = TC_CLASSES;
    const classesB = [...TC_CLASSES.slice(2), ...TC_CLASSES.slice(0, 2)];
    this.plans = defaultPlans(classesA, classesB);
    this.recorded = [];
    this.loop = 0;
    // Deterministic AI seed derived from the difficulty (stable per difficulty).
    const seed = this.difficulty === 'easy' ? 101 : this.difficulty === 'normal' ? 202 : 303;
    this.sourceB = aiSource(seed, this.difficulty);
    this.beginLoop();
    this.mode = 'playing';
    this.clearHud();
  }

  private beginLoop(): void {
    const plan = this.plans[this.loop]!;
    this.state = beginTcLoop(this.loop, plan.classA, plan.classB, this.recorded);
    this.framesA = [];
    this.framesB = [];
    this.accumulator = 0;
  }

  /** Sample split-keyboard input for a side this frame. */
  private liveFrame(side: PlayerSide): InputFrame {
    const f = emptyInput();
    let kx = 0;
    let ky = 0;
    let attack = false;
    if (side === 'a') {
      if (this.keys.a?.isDown) kx -= 1;
      if (this.keys.d?.isDown) kx += 1;
      if (this.keys.w?.isDown) ky -= 1;
      if (this.keys.s?.isDown) ky += 1;
      attack = this.keys.j?.isDown ?? false;
    } else {
      if (this.keys.left?.isDown) kx -= 1;
      if (this.keys.right?.isDown) kx += 1;
      if (this.keys.up?.isDown) ky -= 1;
      if (this.keys.down?.isDown) ky += 1;
      attack = this.keys.numpad0?.isDown ?? false;
    }
    if (kx !== 0 || ky !== 0) {
      const len = Math.sqrt(kx * kx + ky * ky);
      f.moveX = Math.round((kx / len) * 127);
      f.moveY = Math.round((ky / len) * 127);
      f.aim = (atan2Brads(ky, kx) >> 4) & 0xff;
      f.aimActive = true;
    }
    if (attack) f.buttons |= BUTTON_SKILL;
    return f;
  }

  override update(_time: number, deltaMs: number): void {
    if (this.mode !== 'playing') return;
    const dt = Math.min(deltaMs / 1000, 0.1);
    this.accumulator += dt;
    const step = 1 / 60;
    let ticks = 0;
    while (this.accumulator >= step && ticks < 5 && !this.state.finished) {
      this.tickMatch();
      this.accumulator -= step;
      ticks++;
    }
    this.render();
    if (this.state.finished) this.advanceLoop();
  }

  /** Advance the duel by one tick, recording both active sides' frames. */
  private tickMatch(): void {
    const tick = this.state.tick;
    let frameA = emptyInput();
    let frameB = emptyInput();
    for (const u of this.state.units) {
      if (u.loop !== this.loop) continue;
      if (u.side === 'a') frameA = this.liveFrame('a');
      else frameB = this.local2p ? this.liveFrame('b') : this.sourceB(this.state, 'b', u.x, u.y, tick);
    }
    this.framesA.push(frameA);
    this.framesB.push(frameB);

    const recIndex = new Map<string, TcRecordedLoop>();
    for (const r of this.recorded) recIndex.set(`${r.side}:${r.loop}`, r);

    this.state = stepTc(this.state, (u) => {
      if (u.loop === this.loop) return u.side === 'a' ? frameA : frameB;
      const rec = recIndex.get(`${u.side}:${u.loop}`);
      return rec?.frames[tick] ?? emptyInput();
    });
  }

  private advanceLoop(): void {
    const plan = this.plans[this.loop]!;
    this.recorded.push(
      { side: 'a', loop: this.loop, classId: plan.classA, frames: this.framesA },
      { side: 'b', loop: this.loop, classId: plan.classB, frames: this.framesB },
    );
    this.loop += 1;
    if (this.loop >= TC_LOOPS) {
      this.showResult();
    } else {
      this.beginLoop();
    }
  }

  /**
   * Fast-forward the whole match immediately (dev/e2e). Used to verify a vs-AI
   * match runs to completion deterministically without wall-clock stepping.
   */
  fastForwardMatch(): void {
    if (this.mode !== 'playing') return;
    let guard = 0;
    while (this.mode === 'playing' && guard < TC_LOOPS * TC_LOOP_TICKS + 100) {
      while (!this.state.finished) this.tickMatch();
      this.advanceLoop();
      guard++;
    }
    this.render();
  }

  // ================= Rendering =================

  private worldToScreen(x: number, y: number): { sx: number; sy: number; scale: number } {
    const { width, height } = this.scale;
    const usable = Math.min(width - 40, height - 260);
    const scale = usable / (TC_ARENA_HALF * 2);
    const ox = width / 2;
    const oy = 210 + usable / 2;
    return { sx: ox + x * scale, sy: oy + y * scale, scale };
  }

  private render(): void {
    const g = this.gfx;
    g.clear();
    const c = this.worldToScreen(0, 0);
    const half = TC_ARENA_HALF * c.scale;
    // Arena.
    g.fillStyle(0x11152a, 1);
    g.fillRect(c.sx - half, c.sy - half, half * 2, half * 2);
    g.lineStyle(2, UI_COLORS.panelEdge, 1);
    g.strokeRect(c.sx - half, c.sy - half, half * 2, half * 2);
    // Control zone.
    g.fillStyle(UI_COLORS.accent2, 0.12);
    g.fillCircle(c.sx, c.sy, TC_ZONE_RADIUS * c.scale);
    g.lineStyle(2, UI_COLORS.accent2, 0.6);
    g.strokeCircle(c.sx, c.sy, TC_ZONE_RADIUS * c.scale);

    // Units.
    for (const u of this.state.units) {
      if (!u.alive) continue;
      const p = this.worldToScreen(u.x, u.y);
      const active = u.loop === this.loop;
      const color = u.side === 'a' ? UI_COLORS.accent : UI_COLORS.danger;
      g.fillStyle(color, active ? 1 : 0.5);
      g.fillCircle(p.sx, p.sy, active ? 12 : 9);
      if (inZone(u.x, u.y)) {
        g.lineStyle(2, 0xffffff, 0.8);
        g.strokeCircle(p.sx, p.sy, active ? 15 : 12);
      }
      // HP arc.
      const barW = 24;
      g.fillStyle(0x0b0f1a, 0.8);
      g.fillRect(p.sx - barW / 2, p.sy - 20, barW, 3);
      g.fillStyle(u.hp / u.maxHp > 0.35 ? UI_COLORS.ok : UI_COLORS.danger, 1);
      g.fillRect(p.sx - barW / 2, p.sy - 20, barW * Math.max(0, u.hp / u.maxHp), 3);
    }

    // HUD text.
    this.clearHud();
    const { width } = this.scale;
    const cx = width / 2;
    this.hud.push(label(this, cx, 30, 'timechess.loop', { size: 16, bold: true, params: { n: this.loop + 1, max: TC_LOOPS }, name: 'tc-loop' }));
    const zoneA = this.state.zoneTicks.a;
    const zoneB = this.state.zoneTicks.b;
    this.hud.push(label(this, 20, 60, 'timechess.you', { size: 13, color: UI_COLORS.accentText, origin: 0, align: 'left' }));
    this.hud.push(label(this, 20, 80, 'timechess.zone', { size: 11, color: UI_COLORS.textDim, origin: 0, align: 'left' }));
    this.hud.push(this.value(20, 96, `${zoneA}`, UI_COLORS.accentText, 0));
    this.hud.push(label(this, width - 20, 60, 'timechess.opponent', { size: 13, color: UI_COLORS.dangerText, origin: 1, align: 'right' }));
    this.hud.push(label(this, width - 20, 80, 'timechess.zone', { size: 11, color: UI_COLORS.textDim, origin: 1, align: 'right' }));
    this.hud.push(this.value(width - 20, 96, `${zoneB}`, UI_COLORS.dangerText, 1));
  }

  /** A raw (non-i18n) numeric value; used for live scores composed at runtime. */
  private value(x: number, y: number, text: string, color: string, origin: number): Phaser.GameObjects.Text {
    return this.add
      .text(x, y, text, { fontFamily: 'monospace', fontSize: '14px', color })
      .setOrigin(origin, 0.5)
      .setDepth(3);
  }

  // ================= Result =================

  private showResult(): void {
    this.mode = 'result';
    this.clearHud();
    const { width, height } = this.scale;
    const cx = width / 2;
    const scoreA = tcScore(this.state, 'a');
    const scoreB = tcScore(this.state, 'b');
    const outcome = scoreA === scoreB ? 'timechess.draw' : scoreA > scoreB ? 'timechess.win' : 'timechess.lose';

    this.widgets.push(panel(this, cx - 160, height * 0.3, 320, 200));
    this.hud.push(label(this, cx, height * 0.3 + 30, outcome, { size: 22, bold: true, name: 'tc-outcome' }));
    this.hud.push(label(this, cx - 70, height * 0.3 + 76, 'timechess.you', { size: 14, color: UI_COLORS.accentText }));
    this.hud.push(label(this, cx + 70, height * 0.3 + 76, 'timechess.opponent', { size: 14, color: UI_COLORS.dangerText }));
    this.hud.push(this.value(cx - 70, height * 0.3 + 104, `${scoreA}`, UI_COLORS.text, 0.5));
    this.hud.push(this.value(cx + 70, height * 0.3 + 104, `${scoreB}`, UI_COLORS.text, 0.5));
    this.hud.push(label(this, cx, height * 0.3 + 140, 'timechess.alive', {
      size: 12,
      color: UI_COLORS.textDim,
      name: 'tc-alive',
    }));
    this.hud.push(
      this.value(cx, height * 0.3 + 160, `${aliveCount(this.state, 'a')} — ${aliveCount(this.state, 'b')}`, UI_COLORS.text, 0.5),
    );

    this.btn(cx - 90, height - 60, 170, 44, 'timechess.again', () => this.showMenu());
    this.btn(cx + 90, height - 60, 170, 44, 'menu.back', () => {
      getAudioEngine().sfx('ui');
      this.scene.start('ui-title');
    });

    this.game.events.emit('timechess-result', { scoreA, scoreB });
  }

  /** Dev/e2e: current mode. */
  getMode(): Mode {
    return this.mode;
  }
}
