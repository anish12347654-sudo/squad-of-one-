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
import { updateSave, getSave } from './save-context.js';
import { UI_COLORS } from './ui-kit.js';
import { mountBackdrop } from './scene-backdrop.js';
import { fontFamilyForCurrentLocale } from '@i18n/fonts.js';
import { t } from '@i18n/index.js';

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

  private render(): void {
    const g = this.g;
    g.clear();
    // Arena.
    g.fillStyle(0x141a2e, 1);
    g.fillRoundedRect(
      this.wx(-GOLEM_ARENA.halfWidth),
      this.wy(-GOLEM_ARENA.halfHeight),
      GOLEM_ARENA.halfWidth * 2 * this.scaleWorld,
      GOLEM_ARENA.halfHeight * 2 * this.scaleWorld,
      10,
    );

    // Rewind flourish: draw scanlines when rewinding.
    if (this.stage === 'rewind') {
      g.lineStyle(1, 0x64b5ff, 0.3);
      for (let yy = -GOLEM_ARENA.halfHeight; yy < GOLEM_ARENA.halfHeight; yy += 18) {
        g.lineBetween(this.wx(-GOLEM_ARENA.halfWidth), this.wy(yy), this.wx(GOLEM_ARENA.halfWidth), this.wy(yy));
      }
    }

    for (const a of this.state?.attacks ?? []) {
      if (a.shape !== 'slam') continue;
      g.fillStyle(a.telegraphTicks > 0 ? 0xff5544 : 0xffd24a, a.telegraphTicks > 0 ? 0.25 : 0.4);
      g.fillCircle(this.wx(a.x), this.wy(a.y), a.radius * this.scaleWorld);
    }

    for (const p of this.state?.projectiles ?? []) {
      g.fillStyle(0x9fe3ff, 1);
      g.fillCircle(this.wx(p.x), this.wy(p.y), 4);
    }

    for (const u of this.state?.units ?? []) {
      if (!u.alive) continue;
      if (u.kind === 'boss') {
        g.fillStyle(0xe05a6b, 1);
        g.fillCircle(this.wx(u.x), this.wy(u.y), BOSS_RADIUS * this.scaleWorld);
        // HP bar.
        const w = BOSS_RADIUS * 2 * this.scaleWorld;
        g.fillStyle(0x20263c, 1);
        g.fillRect(this.wx(u.x) - w / 2, this.wy(u.y) - BOSS_RADIUS * this.scaleWorld - 10, w, 5);
        g.fillStyle(0x5be08a, 1);
        g.fillRect(this.wx(u.x) - w / 2, this.wy(u.y) - BOSS_RADIUS * this.scaleWorld - 10, w * Math.max(0, u.hp / u.maxHp), 5);
      } else {
        g.fillStyle(u.kind === 'player' ? 0x64b5ff : 0x9d8cff, 1);
        g.fillCircle(this.wx(u.x), this.wy(u.y), 12);
        if (u.kind === 'player') {
          g.lineStyle(2, 0xffffff, 1);
          g.strokeCircle(this.wx(u.x), this.wy(u.y), 14);
        }
      }
    }
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
