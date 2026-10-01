/**
 * GameScene - the full M2 core loop.
 *
 * Owns a pure LevelRunner driven by the fixed-timestep accumulator (<= 5
 * ticks/frame, slow down never skip). Rendering interpolates between the
 * previous and current sim states. Every simulation-affecting decision goes
 * through the pure sim; this scene only reads sim state to draw it and turns
 * device input into InputFrames.
 *
 * Phases (M2):
 *   pick      - class picker for the current slot
 *   planning  - timeline scrubber over a Web Worker pre-sim (+ 3-2-1 countdown)
 *   playing   - live recording of the current slot
 *   decision  - all slots recorded, no win: rewrite a slot or restart
 *   rewind    - tape-rewind transition between loops (chromatic/VHS filter)
 *   cinematic - victory slow-mo replay with camera cuts + labels
 *   result    - final stars + restart
 *
 * Presentation-only juice (shake/flash/slow-mo/particles) never alters sim ticks.
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
  CONVERGENCE_CHARGE,
} from '@sim/index.js';
import type { SimState, Unit, ClassId, ParadoxEvent } from '@sim/index.js';
import { ARENA_02, CLASS_PRESENTATION, campaignLevelById, worldById } from '@content/index.js';
import type { LevelDef } from '@sim/index.js';
import { createInputController, type InputController } from '../input.js';
import { COLORS, GLOWS, TINTS, lerpColor, lighten, darken } from '../render/colors.js';
import { createBackdrop, type Backdrop } from '../render/backdrop.js';
import { reducedFlashing, reducedMotion, screenShakeEnabled, colorBlindMode } from '@ui/save-context.js';
import { installDevHook, type DevHookApi } from '../dev-hook.js';
import { DebugOverlay } from '../debug-overlay.js';
import { Vfx } from '../render/vfx.js';
import { installFilters, type SceneFilters } from '../render/filters.js';
import { buildPreSimRequest, runPreSimClient, type PreSimRun } from '../presim-client.js';
import { getAudioEngine, type AudioEngine } from '@audio/audio-engine.js';
import { ALL_BOTS, shardGrabberBot } from '@content/bots.js';
import { buildReplayCode, type ReplayPlayback } from '../replay-link.js';
import { emptyInput } from '@sim/index.js';
import { exportVictoryClip, copyToClipboard } from '@ui/share-actions.js';
import { scoreDaily } from '@content/index.js';

/** Daily Paradox run config passed into GameScene. */
export interface DailyConfig {
  dateKey: string;
  seed: number;
  levelId: string;
  /** i18n name keys for the two active modifiers (for the result card). */
  modifierNameKeys: string[];
}

const MAX_TICKS_PER_FRAME = 5;

type Phase = 'pick' | 'planning' | 'playing' | 'decision' | 'rewind' | 'cinematic' | 'result';

/** All classes shown in the picker, in display order. */
const ALL_CLASSES: ClassId[] = ['guardian', 'medic', 'ranger', 'pyromancer', 'rogue', 'engineer', 'avatar'];

export class GameScene extends Phaser.Scene {
  private level: LevelDef = ARENA_02;
  private runner!: LevelRunner;
  private controller!: InputController;
  private audio!: AudioEngine;

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
  private vfx!: Vfx;
  private filters!: SceneFilters;
  /** Shared animated clockwork/rangoli backdrop behind the arena. */
  private backdrop!: Backdrop;

  // Cinematic bloom: a base intensity (scaled by reduced-flashing) that the
  // Convergence/victory crescendo briefly pushes above, then eases back. Purely
  // a Filters tuning value - never read by the sim.
  private baseBloom = 1;
  private bloomPulse = 0; // extra bloom added by the crescendo, decays to 0
  /** Global clock (ms) for presentation-only pulsing (boss core, auras). */
  private clock = 0;
  /** World palette accent + floor colour (visual tint only). */
  private worldAccent: number = GLOWS.accent;
  private worldFloor: number = COLORS.arena;

  // World->screen transform.
  private originX = 0;
  private originY = 0;
  private scaleWorld = 1;

  private devHook: DevHookApi | null = null;

  // Dev-only debug overlay (tick / state hash / FPS / entity count). Only
  // created under __DEV_TOOLS__; absent from the shipped release bundle.
  private debug: DebugOverlay | null = null;

  // Auto resolution scaling: when the measured FPS drops below 50 we lower the
  // renderer resolution (and raise it back when we recover), per brief 9.6.
  private fpsSamples: number[] = [];
  private currentResScale = 1;
  private resCooldown = 0;

  // Paradox presentation bookkeeping.
  private seenParadox = 0;
  /** Interactable ids already seen as "taken" (for one-shot grab sparkles). */
  private grabbedShards = new Set<number>();
  /** Last-rendered boss HP, for presentation-only damage numbers (never sim). */
  private lastBossHp = -1;
  /** Accumulated boss damage since the last damage number was flushed. */
  private bossDmgAccum = 0;
  private floatingTexts: { text: string; x: number; y: number; life: number }[] = [];
  private timelineMarkers: ParadoxEvent[] = [];

  // Planning-phase scrubber state.
  private preSim: PreSimRun | null = null;
  private scrubTick = 0;
  private ghostOn: Set<number> = new Set();
  private countdown = 0; // ticks remaining in the 3-2-1

  // Loop snapshot ring for the rewind transition + cinematic.
  private snapshots: SimState[] = [];
  private rewindIndex = 0;
  private rewindTimer = 0;
  private cinematicTimer = 0;
  private cinematicCuts: { tick: number; label: string }[] = [];

  constructor() {
    super({ key: 'GameScene' });
  }

  /** Whether this run was launched from the UI (route results to ResultsScene). */
  private fromUi = false;

  init(data: {
    levelId?: string;
    from?: string;
    replay?: ReplayPlayback;
    def?: LevelDef;
    daily?: DailyConfig;
  }): void {
    this.fromUi = data.from !== undefined;
    this.replay = data.replay ?? null;
    this.daily = data.daily ?? null;
    if (data.def) {
      // A raw LevelDef override (Daily Paradox: campaign level + modifiers).
      this.level = data.def;
      this.campaignLevelId = null;
    } else if (data.levelId) {
      const lvl = campaignLevelById(data.levelId);
      if (lvl) {
        this.level = lvl.def;
        this.campaignLevelId = data.levelId;
      }
    }
  }

  private campaignLevelId: string | null = null;
  /** Non-null when this scene is playing back a shared replay code. */
  private replay: ReplayPlayback | null = null;
  /** Non-null when this run is a Daily Paradox (custom scoring + result card). */
  private daily: DailyConfig | null = null;

  create(): void {
    this.cameras.main.setBackgroundColor(COLORS.bg);
    this.audio = getAudioEngine();
    setBossPattern(this.level.boss.pattern);
    this.runner = new LevelRunner(this.level);
    this.prev = cloneSimState(this.runner.state);
    this.controller = createInputController(this);

    // Shared animated backdrop (world-palette-tinted clockwork/rangoli) behind
    // the arena. Depth -100 keeps it under all gameplay graphics. Honors
    // reduced-motion (static single frame). Presentation-only.
    const bdOpts: Parameters<typeof createBackdrop>[1] = { reducedMotion: reducedMotion(), stars: 40 };
    const campLevel = this.campaignLevelId ? campaignLevelById(this.campaignLevelId) : undefined;
    const worldTheme = campLevel ? worldById(campLevel.worldId) : undefined;
    this.worldAccent = worldTheme?.palette.accent ?? GLOWS.accent;
    this.worldFloor = worldTheme?.palette.floor ?? COLORS.arena;
    bdOpts.accent = this.worldAccent;
    bdOpts.accent2 = GLOWS.accent2;
    this.backdrop = createBackdrop(this, bdOpts);

    this.world = this.add.graphics();
    this.hud = this.add.graphics();
    this.vfx = new Vfx(this, 12);
    // Cinematic bloom + vignette on the whole rendered frame via the main
    // camera's internal FilterList. Phaser 4 filters applied to a single
    // Graphics object only render that object's bounds into a texture, which
    // composites to a fraction of a FIT-scaled canvas and clips the view;
    // filtering the camera post-processes the full frame. Scaled down when the
    // accessibility "reduced flashing" setting is on.
    this.baseBloom = reducedFlashing() ? 0.4 : 1;
    this.filters = installFilters(this.cameras.main, { bloom: this.baseBloom, vignette: true });
    this.overlay = this.add.container(0, 0).setDepth(30);
    this.banner = this.add
      .text(this.scale.width / 2, this.scale.height / 2 - 40, '', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '30px',
        color: '#e8ecff',
        fontStyle: 'bold',
        align: 'center',
      })
      .setOrigin(0.5)
      .setDepth(31);

    this.computeTransform();
    if (this.replay) this.beginReplay(this.replay);
    else this.showClassPicker();

    this.game.events.on(Phaser.Core.Events.HIDDEN, this.onHidden, this);
    this.game.events.on(Phaser.Core.Events.VISIBLE, this.onVisible, this);

    // Unlock audio on the first pointer/tap (contract 8).
    this.input.once('pointerdown', () => {
      this.audio.unlock();
      this.audio.startMusic();
    });

    // Dev/e2e-only tools (tick-exact input hook + debug overlay). Gated on the
    // compile-time define `__DEV_TOOLS__` so Rollup strips them (and their
    // imports) from the release build.
    if (__DEV_TOOLS__) {
      this.devHook = installDevHook(this);
      this.debug = new DebugOverlay(this);
    }
    // Live responsive layout: recompute the world transform on any resize
    // (portrait/landscape flips, safe-area changes). Phaser FIT already scales
    // the canvas; this keeps the arena centred within the new logical size.
    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);
    this.game.events.emit('game-ready');
  }

  private onHidden(): void {
    this.paused = true;
  }
  private onVisible(): void {
    this.paused = false;
  }

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

  // ================= Class picker =================

  private showClassPicker(): void {
    this.phase = 'pick';
    this.clearOverlay();
    const slot = this.runner.recordingSlot;
    const cx = this.scale.width / 2;

    this.overlayText(cx, 150, `Record Slot ${slot + 1} of ${this.level.slotCount}`, 20, '#e8ecff', true);
    this.overlayText(cx, 178, `Time Shards: ${this.runner.shards}   ·   pick a class (each usable once)`, 13, '#8a93b8');
    if (this.runner.canRewrite()) {
      this.overlayText(cx, 197, 'Tip: you can also spend a Shard to Rewrite an earlier slot from the results screen.', 10, '#64ffda');
    }

    const startY = 218;
    const rowH = 78;
    ALL_CLASSES.forEach((id, i) => {
      const pres = CLASS_PRESENTATION[id];
      const y = startY + i * rowH;
      const canPick = this.runner.canChoose(id, slot);
      const card = this.add.graphics();
      card.fillStyle(canPick ? 0x1f2740 : 0x171b28, 1);
      card.lineStyle(2, canPick ? pres.color : 0x2a3350, 1);
      card.fillRoundedRect(cx - 165, y - 30, 330, rowH - 12, 10);
      card.strokeRoundedRect(cx - 165, y - 30, 330, rowH - 12, 10);
      this.overlay.add(card);
      // Silhouette swatch.
      const swatch = this.add.graphics();
      swatch.fillStyle(canPick ? pres.color : 0x3a4358, 1);
      this.drawSilhouette(swatch, cx - 138, y + 2, 14, pres.silhouette, 0);
      this.overlay.add(swatch);

      this.overlayText(cx - 108, y - 14, `${pres.name}  ·  ${pres.role}`, 15, canPick ? '#e8ecff' : '#556', true, 0);
      this.overlayText(cx - 108, y + 8, pres.blurb, 11, canPick ? '#aab' : '#445', false, 0, 250);

      if (!canPick) {
        const reason = this.runner.usedClasses().includes(id) ? 'used' : id === 'avatar' ? 'last slot' : 'locked';
        this.overlayText(cx + 150, y - 14, reason, 10, '#667', false, 1);
      } else {
        const hit = this.add.zone(cx, y + 2, 330, rowH - 12).setOrigin(0.5).setInteractive({ useHandCursor: true });
        hit.on('pointerdown', () => this.pickClass(id));
        this.overlay.add(hit);
      }
    });
    this.banner.setText('');
  }

  /** Pick the class for the current recording slot, then enter planning. */
  pickClass(id: ClassId): void {
    if (this.phase !== 'pick') return;
    if (!this.runner.canChoose(id, this.runner.recordingSlot)) return;
    this.audio.sfx('ui');
    this.runner.chooseClass(id);
    this.enterPlanning();
  }

  // ================= Planning phase / scrubber =================

  private enterPlanning(): void {
    // If there are no prior recordings to pre-sim, skip straight to countdown.
    const hasEchoes = this.runner.recordings.some((r, s) => r && s !== this.runner.recordingSlot);
    if (!hasEchoes) {
      this.startCountdown();
      return;
    }
    this.phase = 'planning';
    this.clearOverlay();
    this.preSim = null;
    this.scrubTick = 0;
    this.countdown = 0; // no countdown until the player starts recording
    const req = buildPreSimRequest(
      this.level,
      this.runner.recordingSlot,
      this.runner.slotClasses,
      this.runner.recordings,
    );
    this.overlayText(this.scale.width / 2, this.scale.height / 2, 'Simulating timeline...', 16, '#8a93b8', true);
    runPreSimClient(req)
      .then((run) => {
        this.preSim = run;
        if (this.phase === 'planning') this.showScrubber();
      })
      .catch(() => this.startCountdown());
  }

  private showScrubber(): void {
    if (!this.preSim) return;
    this.clearOverlay();
    const cx = this.scale.width / 2;
    const pre = this.preSim.result;
    this.overlayText(cx, 150, 'Planning: scrub the timeline', 18, '#e8ecff', true);
    this.overlayText(
      cx,
      176,
      `pre-sim ${Math.round(this.preSim.elapsedMs)}ms ${this.preSim.usedWorker ? '(worker)' : '(main)'}  ·  final boss HP ${Math.round(pre.finalBossHp)}`,
      12,
      '#8a93b8',
    );

    // Slider track.
    const trackY = this.scale.height - 170;
    const trackX0 = 50;
    const trackX1 = this.scale.width - 50;
    const track = this.add.graphics();
    track.fillStyle(0x2a3350, 1);
    track.fillRoundedRect(trackX0, trackY - 4, trackX1 - trackX0, 8, 4);
    this.overlay.add(track);
    // Paradox markers on the timeline.
    for (const ev of pre.paradoxEvents) {
      const px = trackX0 + ((trackX1 - trackX0) * ev.tick) / this.level.loopLength;
      const m = this.add.graphics();
      m.fillStyle(COLORS.paradox, 1);
      m.fillCircle(px, trackY, 5);
      this.overlay.add(m);
    }
    const knob = this.add.graphics().setName('scrub-knob');
    this.overlay.add(knob);
    this.drawScrubKnob(knob, trackX0, trackX1, trackY);

    const hit = this.add.zone((trackX0 + trackX1) / 2, trackY, trackX1 - trackX0, 44).setOrigin(0.5).setInteractive();
    hit.on('pointerdown', (p: Phaser.Input.Pointer) => this.scrubTo(p.x, trackX0, trackX1));
    hit.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (p.isDown) this.scrubTo(p.x, trackX0, trackX1);
    });
    this.overlay.add(hit);

    // Ghost-path toggles.
    let ty = 206;
    for (const g of pre.ghostPaths) {
      const pres = g.classId ? CLASS_PRESENTATION[g.classId] : null;
      const on = this.ghostOn.has(g.slot);
      const label = `Ghost path: Slot ${g.slot + 1}${pres ? ' · ' + pres.name : ''}  [${on ? 'ON' : 'off'}]`;
      const t = this.overlayText(cx, ty, label, 12, on ? '#e8ecff' : '#667', on);
      const z = this.add.zone(cx, ty, 260, 22).setOrigin(0.5).setInteractive({ useHandCursor: true });
      z.on('pointerdown', () => {
        if (this.ghostOn.has(g.slot)) this.ghostOn.delete(g.slot);
        else this.ghostOn.add(g.slot);
        this.audio.sfx('ui');
        this.showScrubber();
      });
      this.overlay.add(z);
      void t;
      ty += 24;
    }

    // Start button -> 3-2-1 countdown.
    const btnY = this.scale.height - 110;
    this.overlayButton(cx, btnY, 'Start Recording', () => this.startCountdown());
  }

  private drawScrubKnob(knob: Phaser.GameObjects.Graphics, x0: number, x1: number, y: number): void {
    knob.clear();
    const frac = this.scrubTick / this.level.loopLength;
    const kx = x0 + (x1 - x0) * frac;
    knob.fillStyle(0x64b5ff, 1);
    knob.fillCircle(kx, y, 9);
  }

  private scrubTo(pointerX: number, x0: number, x1: number): void {
    const frac = Phaser.Math.Clamp((pointerX - x0) / (x1 - x0), 0, 1);
    this.scrubTick = Math.round(frac * this.level.loopLength);
    const knob = this.overlay.getByName('scrub-knob') as Phaser.GameObjects.Graphics | null;
    if (knob) this.drawScrubKnob(knob, x0, x1, this.scale.height - 170);
  }

  private startCountdown(): void {
    this.phase = 'planning';
    this.clearOverlay();
    this.countdown = 3 * 60; // 3 seconds of 3-2-1
    this.preSim = null;
  }

  // ================= Live play =================

  private beginPlaying(): void {
    this.phase = 'playing';
    this.prev = cloneSimState(this.runner.state);
    this.accumulator = 0;
    this.snapshots = [cloneSimState(this.runner.state)];
    // Reset presentation-only boss-damage tracking at loop start (HP resets).
    this.lastBossHp = -1;
    this.bossDmgAccum = 0;
    this.clearOverlay();
    this.banner.setText('');
  }

  // ================= Main loop =================

  override update(_time: number, deltaMs: number): void {
    this.controller.sample();
    const dt = Math.min(deltaMs / 1000, 0.25);

    if (this.phase === 'planning' && this.countdown > 0) {
      this.countdown -= deltaMs / (1000 / 60);
      if (this.countdown <= 0) this.beginPlaying();
    } else if (this.phase === 'playing' && !this.paused) {
      this.stepPlaying(dt);
    } else if (this.phase === 'rewind') {
      this.updateRewind(dt);
    } else if (this.phase === 'cinematic') {
      this.updateCinematic(dt);
    }

    this.clock += deltaMs;
    this.backdrop.update(deltaMs);

    const alpha = this.phase === 'playing' ? this.accumulator / TICK_DT_SECONDS : 0;
    this.draw(alpha);
    this.vfx.update();
    // Cinematic bloom: ease the crescendo pulse back to the base intensity.
    if (this.bloomPulse > 0.001) {
      this.bloomPulse *= 0.92;
      this.filters.setBloom(Math.min(1.6, this.baseBloom + this.bloomPulse));
    }
    this.filters.update(this.phase === 'rewind');
    this.updateAudioLayers();
    this.updateAutoResolution(deltaMs);
    if (__DEV_TOOLS__ && this.debug) {
      this.debug.update(deltaMs, this.runner.state, this.game.loop.actualFps, this.currentResScale, this.phase);
    }
  }

  private stepPlaying(dt: number): void {
    this.accumulator += dt;
    let ticks = 0;
    while (this.accumulator >= TICK_DT_SECONDS && ticks < MAX_TICKS_PER_FRAME) {
      this.prev = cloneSimState(this.runner.state);
      const tick = this.runner.state.tick;
      const live = this.controller.frameForTick(tick);
      const result = this.runner.tickWith(live);
      this.accumulator -= TICK_DT_SECONDS;
      ticks++;
      this.captureSnapshot();
      this.reactToEvents();
      if (result !== 'in_progress') {
        this.onLoopResolved(result);
        this.accumulator = 0;
        return;
      }
      if (this.runner.needsClassChoice()) {
        if (this.isReplayPlayback && this.replay) {
          const rp = this.replay;
          this.startRewind(() => this.autoPickAndPlay(rp));
        } else {
          this.startRewind(() => this.showClassPicker());
        }
        this.accumulator = 0;
        return;
      }
      if (this.runner.awaitingDecision()) {
        // Daily Paradox is a single attempt: a surviving boss ends the run.
        if (this.daily) {
          this.startRewind(() => this.showResult('failed'));
        } else {
          this.startRewind(() => this.showDecision());
        }
        this.accumulator = 0;
        return;
      }
    }
    if (this.accumulator >= TICK_DT_SECONDS) this.accumulator = 0; // slow down
  }

  private captureSnapshot(): void {
    // Ring buffer of loop snapshots for rewind + cinematic (cap for memory).
    this.snapshots.push(cloneSimState(this.runner.state));
    if (this.snapshots.length > this.level.loopLength + 4) this.snapshots.shift();
  }

  /** Turn newly-raised paradox events + boss death into juice + SFX. */
  private reactToEvents(): void {
    const evs = this.runner.state.paradoxEvents;
    for (let i = this.seenParadox; i < evs.length; i++) {
      const ev = evs[i]!;
      this.timelineMarkers.push(ev);
      // Cap floating texts so repeated paradoxes never stack into an unreadable pile.
      if (this.floatingTexts.length < 3) {
        this.floatingTexts.push({ text: `PARADOX: ${ev.detail}`, x: ev.x, y: ev.y + (this.floatingTexts.length * 40 - 40), life: 150 });
      }
      this.audio.sfx('paradox');
      // Paradox: a red glitch burst + jittery shards + a short bloom pop.
      this.vfx.burst(this.wx(ev.x), this.wy(ev.y), COLORS.paradox, 20, 4, 30, 3);
      this.vfx.glitch(this.wx(ev.x), this.wy(ev.y), COLORS.paradoxGlow, 8);
      this.vfx.ring(this.wx(ev.x), this.wy(ev.y), COLORS.paradox, 10, 3.5, 20, 3);
      this.shakeCam(200, 0.008);
      this.pulseBloom(0.25);
    }
    this.seenParadox = evs.length;
  }

  private onLoopResolved(result: string): void {
    if (result === 'won') {
      // Cinematic boss death: a bloom + shatter burst crescendo, then the
      // victory cinematic. All presentation-only.
      const boss = this.runner.state.units.find((u) => u.kind === 'boss');
      if (boss) {
        const bx = this.wx(boss.x);
        const by = this.wy(boss.y);
        // Shatter burst: outward shockwave ring + a dense ember cloud + a bright core.
        this.vfx.ring(bx, by, 0xffffff, 18, 8, 40, 4);
        this.vfx.ring(bx, by, COLORS.bossCore, 16, 6, 44, 4);
        this.vfx.burst(bx, by, 0xff8a95, 90, 7, 46, 5);
        this.vfx.burst(bx, by, 0xffffff, 60, 5, 40, 4);
        this.vfx.burst(bx, by, GLOWS.gold, 40, 4, 50, 3);
      }
      this.shakeCam(600, 0.02);
      this.flashCam(400, 255, 255, 255);
      this.pulseBloom(0.6);
      this.audio.sfx('victory');
      this.startCinematic();
    } else {
      // Loop timed out (this slot). Handled by needsClassChoice/awaitingDecision.
      if (this.runner.result === 'failed') {
        this.startRewind(() => this.showResult('failed'));
      }
    }
  }

  // ================= Rewind transition =================

  private rewindDone: (() => void) | null = null;

  private startRewind(done: () => void): void {
    if (this.snapshots.length < 2) {
      done();
      return;
    }
    this.phase = 'rewind';
    this.rewindDone = done;
    this.rewindIndex = this.snapshots.length - 1;
    this.rewindTimer = 0;
    this.filters.setRewind(true, 1);
    this.audio.sfx('paradox'); // tape-rewind-ish sweep
    this.clearOverlay();
    this.overlayText(this.scale.width / 2, 120, '<< REWIND', 20, '#9fe3ff', true);
    this.overlayButton(this.scale.width / 2, this.scale.height - 120, 'Skip >', () => this.finishRewind());
  }

  private updateRewind(dt: number): void {
    this.rewindTimer += dt;
    // ~1.2 s total at 8x reverse over the captured snapshots.
    const total = 1.2;
    const frac = Math.min(1, this.rewindTimer / total);
    this.rewindIndex = Math.max(0, Math.round((1 - frac) * (this.snapshots.length - 1)));
    if (frac >= 1) this.finishRewind();
  }

  private finishRewind(): void {
    this.filters.setRewind(false, 0);
    const done = this.rewindDone;
    this.rewindDone = null;
    this.snapshots = [];
    if (done) done();
  }

  // ================= Decision (rewrite / restart) =================

  private showDecision(): void {
    this.phase = 'decision';
    this.clearOverlay();
    const cx = this.scale.width / 2;
    this.banner.setText('');
    this.overlayText(cx, 150, 'The boss survived the timeline', 18, '#e8ecff', true);
    this.overlayText(cx, 178, `Time Shards left: ${this.runner.shards}`, 13, '#8a93b8');

    if (this.runner.canRewrite()) {
      this.overlayText(cx, 210, 'Rewrite a slot (1 shard) — other slots replay in the changed world:', 12, '#aab');
      for (let s = 0; s < this.level.slotCount; s++) {
        const cls = this.runner.slotClasses[s];
        if (!cls) continue;
        const pres = CLASS_PRESENTATION[cls];
        const y = 244 + s * 40;
        this.overlayButton(cx, y, `Rewrite Slot ${s + 1} · ${pres.name}`, () => this.doRewrite(s), 300, pres.color);
      }
    } else {
      this.overlayText(cx, 220, 'No Time Shards left. Restart the level.', 13, '#e57373');
    }
    this.overlayButton(cx, this.scale.height - 120, 'Restart', () => this.restart());
  }

  doRewrite(slot: number, newClass?: ClassId): void {
    // A rewrite is allowed at any between-loops gate (pick or decision) per
    // contract 3.5, as long as the runner says a rewrite is available.
    if (this.phase !== 'decision' && this.phase !== 'pick') return;
    if (!this.runner.canRewrite()) return;
    this.audio.sfx('ui');
    this.runner.rewriteSlot(slot, newClass);
    this.seenParadox = 0;
    this.timelineMarkers = [];
    this.enterPlanning();
  }

  // ================= Victory cinematic =================

  private startCinematic(): void {
    this.phase = 'cinematic';
    this.cinematicTimer = 0;
    // Camera cuts on key moments: phase changes, paradoxes, Convergence, blow.
    this.cinematicCuts = [{ tick: 0, label: 'Timeline complete' }];
    for (const ev of this.timelineMarkers) {
      const cls = this.runner.slotClasses[ev.slot];
      const name = cls ? CLASS_PRESENTATION[cls].name : 'Echo';
      this.cinematicCuts.push({ tick: ev.tick, label: `Slot ${ev.slot + 1} · ${name} → Paradox` });
    }
    this.cinematicCuts.push({ tick: this.runner.state.tick, label: 'The final blow' });
    this.clearOverlay();
    this.overlayText(this.scale.width / 2, 110, 'VICTORY REPLAY', 22, '#ffd24a', true);
    this.overlayButton(this.scale.width / 2, this.scale.height - 120, 'Skip to results >', () => this.showResult('won'));
  }

  private updateCinematic(dt: number): void {
    const prevT = this.cinematicTimer;
    this.cinematicTimer += dt;
    // Cinematic crescendo: periodic light bursts + a sustained bloom glow at the
    // boss's last position, landing the "win" as premium. Presentation-only.
    const boss = this.runner.state.units.find((u) => u.kind === 'boss');
    if (boss) {
      const bx = this.wx(boss.x);
      const by = this.wy(boss.y);
      // Every ~0.5s fire a gold/white light burst.
      if (Math.floor(prevT / 0.5) !== Math.floor(this.cinematicTimer / 0.5)) {
        this.vfx.ring(bx, by, GLOWS.gold, 14, 6, 36, 4);
        this.vfx.burst(bx, by, 0xffffff, 20, 5, 34, 4);
        this.pulseBloom(0.4);
        if (!reducedFlashing() && this.cinematicTimer < 1.5) this.flashCam(260, 255, 240, 200);
      }
    }
    // ~3.5 s of slow-mo cuts, then results.
    if (this.cinematicTimer > 3.5) this.showResult('won');
  }

  // ================= Result =================

  private showResult(result: string): void {
    this.phase = 'result';
    const stars = this.runner.computeStars();

    // A winning run can be shared as a portable replay code (M4).
    let replayCode: string | undefined;
    if (result === 'won') {
      try {
        replayCode = buildReplayCode(this.runner);
        this.lastReplayCode = replayCode;
      } catch {
        replayCode = undefined;
      }
    }

    // Daily Paradox: compute the daily score (outside the sim) + hand off to the
    // Daily results scene, which keeps a local best + a shareable card.
    if (this.daily) {
      const won = result === 'won';
      const score = scoreDaily({
        won,
        winTick: this.runner.state.tick,
        loopLength: this.level.loopLength,
        echoesAlive: stars.echoesAlive,
        rewritesUsed: stars.rewritesUsed,
        wonOnSlot: this.runner.wonOnSlot,
        slotCount: this.level.slotCount,
      });
      this.scene.start('ui-daily-results', {
        dateKey: this.daily.dateKey,
        seed: this.daily.seed,
        levelId: this.daily.levelId,
        modifierNameKeys: this.daily.modifierNameKeys,
        won,
        score,
        stars: stars.count,
        echoesAlive: stars.echoesAlive,
        rewritesUsed: stars.rewritesUsed,
        wonOnSlot: this.runner.wonOnSlot,
      });
      return;
    }

    // When launched from the UI, hand off to the localized ResultsScene which
    // records the outcome into the save + offers Next/Retry/Map + Share.
    if (this.fromUi && this.campaignLevelId) {
      const lastSlot = this.runner.recordingSlot;
      const cls = this.runner.slotClasses[lastSlot] ?? null;
      this.scene.start('ui-results', {
        levelId: this.campaignLevelId,
        won: result === 'won',
        stars: stars.count,
        echoesAlive: stars.echoesAlive,
        earlyVictory: stars.earlyVictory,
        rewritesUsed: stars.rewritesUsed,
        assistUsed: false,
        wonOnSlot: this.runner.wonOnSlot,
        masteryClass: cls,
        ...(replayCode ? { replayCode } : {}),
      });
      return;
    }

    this.clearOverlay();
    const cx = this.scale.width / 2;
    if (result === 'won') {
      this.banner.setText('VICTORY');
      this.drawStars(stars.count);
      this.overlayText(cx, this.scale.height / 2 + 60, `${stars.echoesAlive} echoes alive · ${stars.rewritesUsed} rewrites`, 13, '#aab');
      // Share options (M4): export a victory clip from the live canvas + audio.
      this.overlayButton(cx, this.scale.height - 244, 'Export Clip', () => {
        this.audio.sfx('ui');
        void exportVictoryClip(this.game);
      }, 220, 0x64ffda);
      if (replayCode) {
        const code = replayCode;
        this.overlayButton(cx, this.scale.height - 190, 'Copy Replay Code', () => {
          this.audio.sfx('ui');
          void copyToClipboard(code);
        }, 220, 0x2b60ff);
      }
    } else {
      this.banner.setText('TIMELINE FAILED');
    }
    this.overlayButton(cx, this.scale.height - 120, 'Restart', () => this.restart());
  }

  private drawStars(count: number): void {
    const cx = this.scale.width / 2;
    const y = this.scale.height / 2 + 6;
    const g = this.add.graphics().setDepth(32);
    for (let i = 0; i < 3; i++) {
      const sx = cx - 44 + i * 44;
      this.starShape(g, sx, y, 15, i < count ? 0xffd24a : 0x39415c);
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

  /** Fast-forward the current loop (dev/e2e only). */
  fastForward(maxTicks: number): void {
    if (this.phase === 'planning' && this.countdown > 0) {
      this.beginPlaying();
    }
    if (this.phase !== 'playing') return;
    if (!this.controller.scripted) return;
    for (let i = 0; i < maxTicks; i++) {
      this.prev = cloneSimState(this.runner.state);
      const tick = this.runner.state.tick;
      const live = this.controller.frameForTick(tick);
      const result = this.runner.tickWith(live);
      this.captureSnapshot();
      this.reactToEvents();
      if (result !== 'in_progress') {
        this.onLoopResolved(result);
        this.accumulator = 0;
        return;
      }
      if (this.runner.needsClassChoice()) {
        this.snapshots = [];
        if (this.isReplayPlayback && this.replay) this.autoPickAndPlay(this.replay);
        else this.showClassPicker();
        this.accumulator = 0;
        return;
      }
      if (this.runner.awaitingDecision()) {
        this.snapshots = [];
        if (this.daily) this.showResult('failed');
        else this.showDecision();
        this.accumulator = 0;
        return;
      }
    }
  }

  /** Skip planning/countdown immediately (dev/e2e). */
  skipPlanning(): void {
    if (this.phase === 'planning') this.beginPlaying();
  }

  /**
   * Install a state-aware bot scripted source for the LIVE player (dev/e2e).
   * `shardSlots` optionally maps a slot -> interactable defIndex the bot should
   * grab first (used to author paradox-triggering anchors in the flow).
   */
  driveWithBots(shardSlots: Record<number, number> = {}): void {
    this.controller.setScriptedSource((tick: number) => {
      const slot = this.runner.recordingSlot;
      const cls = this.runner.slotClasses[slot];
      if (!cls) return { moveX: 0, moveY: 0, aim: 0, aimActive: false, buttons: 0 };
      const shardIdx = shardSlots[slot];
      if (shardIdx !== undefined) {
        return shardGrabberBot(this.runner.state, slot, shardIdx);
      }
      const bot = ALL_BOTS[cls];
      return bot ? bot(this.runner.state, slot, tick) : { moveX: 0, moveY: 0, aim: 0, aimActive: false, buttons: 0 };
    });
  }

  // ================= Replay playback (M4, `/#r=<code>`) =================

  /**
   * Deterministically play back a decoded replay code. Auto-picks each slot's
   * recorded class and feeds the recorded input frames through the SAME
   * scripted-source path used by e2e/solutions, so playback is bit-identical to
   * the original run. The final loop reproduces the win, then the cinematic +
   * results run as normal (routed to the ResultsScene when from the UI).
   */
  private beginReplay(playback: ReplayPlayback): void {
    this.isReplayPlayback = true;
    // Recorded frames for the CURRENT recording slot drive the live player.
    this.controller.setScriptedSource((tick: number) => {
      const slot = this.runner.recordingSlot;
      const frames = playback.slotFrames[slot];
      if (!frames) return emptyInput();
      return frames[tick] ?? emptyInput();
    });
    this.autoPickAndPlay(playback);
  }

  private isReplayPlayback = false;

  /** Pick the recorded class for the current slot and start its loop. */
  private autoPickAndPlay(playback: ReplayPlayback): void {
    if (!this.runner.needsClassChoice()) return;
    const slot = this.runner.recordingSlot;
    const cls = playback.slotClasses[slot];
    if (!cls) return;
    this.runner.chooseClass(cls);
    this.beginPlaying();
  }

  restart(): void {
    setBossPattern(this.level.boss.pattern);
    this.runner = new LevelRunner(this.level);
    this.prev = cloneSimState(this.runner.state);
    this.accumulator = 0;
    this.seenParadox = 0;
    this.timelineMarkers = [];
    this.floatingTexts = [];
    this.snapshots = [];
    this.grabbedShards.clear();
    this.lastBossHp = -1;
    this.bossDmgAccum = 0;
    this.controller.setScriptedSource(null);
    this.filters.setRewind(false, 0);
    this.showClassPicker();
  }

  // ================= Rendering =================

  private draw(alpha: number): void {
    this.world.clear();
    this.hud.clear();
    this.disposeLabels();

    // In rewind/cinematic phases we render from the snapshot ring instead of live.
    let cur = this.runner.state;
    let prev = this.prev;
    if (this.phase === 'rewind' && this.snapshots.length > 0) {
      cur = this.snapshots[Math.min(this.rewindIndex, this.snapshots.length - 1)]!;
      prev = cur;
      alpha = 0;
    }

    this.drawArena();
    if (this.phase === 'planning' && this.preSim) this.drawScrubberWorld();
    this.drawInteractables(cur);
    this.drawAttacks(cur);
    this.drawTurrets(cur);
    this.drawUnits(cur, prev, alpha);
    this.drawProjectiles(cur, prev, alpha);
    this.drawConvergence(cur);
    this.drawThreatLine(cur, prev, alpha);
    this.drawFloatingTexts();
    this.drawHud(cur);
    if (this.phase === 'planning' && this.countdown > 0) this.drawCountdown();
  }

  private disposeLabels(): void {
    for (const l of this.labels) l.destroy();
    this.labels.length = 0;
  }

  private label(x: number, y: number, text: string, size: number, color: string, bold = false): void {
    const t = this.add
      .text(x, y, text, { fontFamily: 'system-ui, sans-serif', fontSize: `${size}px`, color, fontStyle: bold ? 'bold' : 'normal' })
      .setOrigin(0.5)
      .setDepth(8);
    this.labels.push(t);
  }

  private overlayText(x: number, y: number, text: string, size: number, color: string, bold = false, originX = 0.5, wrap?: number): Phaser.GameObjects.Text {
    const style: Phaser.Types.GameObjects.Text.TextStyle = {
      fontFamily: 'system-ui, sans-serif',
      fontSize: `${size}px`,
      color,
      fontStyle: bold ? 'bold' : 'normal',
    };
    if (wrap) style.wordWrap = { width: wrap };
    const t = this.add.text(x, y, text, style).setOrigin(originX, 0.5);
    this.overlay.add(t);
    return t;
  }

  private overlayButton(x: number, y: number, text: string, onClick: () => void, width = 200, color = 0x2b60ff): void {
    const g = this.add.graphics();
    g.fillStyle(color, 1);
    g.fillRoundedRect(x - width / 2, y - 24, width, 48, 10);
    this.overlay.add(g);
    this.overlayText(x, y, text, 15, '#ffffff', true);
    const hit = this.add.zone(x, y, width, 48).setOrigin(0.5).setInteractive({ useHandCursor: true });
    hit.on('pointerdown', onClick);
    this.overlay.add(hit);
  }

  private drawArena(): void {
    const g = this.world;
    const x = this.wx(-this.level.halfWidth);
    const y = this.wy(-this.level.halfHeight);
    const w = this.ws(this.level.halfWidth * 2);
    const h = this.ws(this.level.halfHeight * 2);
    const r = 14;

    // Soft drop shadow under the floor plate for depth.
    g.fillStyle(TINTS.shadow, 0.5);
    g.fillRoundedRect(x - 3, y + 5, w + 6, h + 6, r + 2);

    // Gradient floor (lit top -> darker bottom), tinted toward the world floor
    // colour so each world reads distinct. A rounded base plate is overlaid
    // with inset horizontal bands so the gradient never pokes past the rounded
    // corners. Modest band count keeps it cheap.
    const top = lighten(this.worldFloor, 0.18);
    const bottom = darken(this.worldFloor, 0.35);
    g.fillStyle(lerpColor(top, bottom, 0.5), 1);
    g.fillRoundedRect(x, y, w, h, r);
    const bands = 12;
    const inner = r; // keep bands clear of the rounded corners
    const bandH = (h - inner * 2) / bands;
    for (let i = 0; i < bands; i++) {
      const tt = i / (bands - 1);
      g.fillStyle(lerpColor(top, bottom, tt), 0.9);
      g.fillRect(x + 1, y + inner + i * bandH, w - 2, bandH + 1);
    }

    // Re-stroke the rounded edge with a glowing world-accent rim (double stroke:
    // a soft wide halo + a crisp bright edge).
    g.lineStyle(5, this.worldAccent, 0.12);
    g.strokeRoundedRect(x, y, w, h, r);
    g.lineStyle(2, lighten(this.worldAccent, 0.25), 0.85);
    g.strokeRoundedRect(x, y, w, h, r);

    // Faint inner grid lines for a "lit arena" read (very subtle, kept sparse
    // so the per-frame redraw stays cheap under software rasterisation).
    g.lineStyle(1, lighten(this.worldFloor, 0.3), 0.06);
    const cols = 4;
    for (let i = 1; i < cols; i++) {
      const gx = x + (w * i) / cols;
      g.lineBetween(gx, y + 6, gx, y + h - 6);
    }
    const rows = 5;
    for (let i = 1; i < rows; i++) {
      const gy = y + (h * i) / rows;
      g.lineBetween(x + 6, gy, x + w - 6, gy);
    }
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
        this.drawBoss(g, u, sx, sy, cur);
        continue;
      }

      if (!u.alive) {
        // Fallen echo: a dim, hollow husk.
        g.fillStyle(0x2a3042, 0.45);
        g.fillCircle(sx, sy, this.ws(10));
        g.lineStyle(1, 0x3a4358, 0.4);
        g.strokeCircle(sx, sy, this.ws(10));
        continue;
      }

      const cls = u.classId as ClassId;
      const pres = CLASS_PRESENTATION[cls];
      const isYou = u.kind === 'player';
      const r = Math.max(11, this.ws(20));

      if (u.paradox) {
        // Paradox echo: red, glitching, jittering, with scatter shards.
        const jx = (Math.random() - 0.5) * 6;
        const jy = (Math.random() - 0.5) * 6;
        const telegraph = u.paradoxTelegraph > 0;
        // Soft red glow halo.
        g.fillStyle(COLORS.paradoxGlow, 0.14);
        g.fillCircle(sx + jx, sy + jy, r + 8);
        g.fillStyle(COLORS.paradox, telegraph ? 0.5 + Math.random() * 0.4 : 0.9);
        this.drawSilhouette(g, sx + jx, sy + jy, r, pres.silhouette, u.facing);
        g.lineStyle(2, COLORS.paradoxGlow, 0.9);
        g.strokeCircle(sx + jx, sy + jy, r + 4 + Math.random() * 3);
        if (Math.random() < 0.4) {
          g.fillStyle(COLORS.paradoxGlow, 0.7);
          g.fillRect(sx + (Math.random() - 0.5) * 30, sy + (Math.random() - 0.5) * 30, 6, 2);
        }
        // Occasional glitch motes (pooled, within caps).
        if (Math.random() < 0.08) this.vfx.glitch(sx + jx, sy + jy, COLORS.paradoxGlow, 3);
        this.label(sx, sy, 'X', 12, '#ffffff', true);
        continue;
      }

      // --- Layered friendly/echo look: glow halo + gradient body + bright
      // energy core + class-colored rim. The per-class SHAPE (silhouette) and
      // the NUMBER badge are always drawn (colour-blind Assist identity).
      const bodyAlpha = isYou ? 1 : 0.72;
      const topCol = lighten(pres.color, isYou ? 0.35 : 0.2);
      const botCol = darken(pres.color, 0.35);

      // Soft outer glow (brighter for you + under colour-blind mode).
      const glowA = (isYou ? 0.22 : 0.14) * (colorBlindMode() ? 1.4 : 1);
      g.fillStyle(pres.color, glowA);
      g.fillCircle(sx, sy, r + (isYou ? 9 : 6));

      // Gradient body: a darker base silhouette with a lighter top overlay to
      // read as a lit volume (cheap: two silhouette fills).
      g.fillStyle(botCol, bodyAlpha);
      this.drawSilhouette(g, sx, sy, r, pres.silhouette, u.facing);
      g.fillStyle(topCol, bodyAlpha * 0.6);
      this.drawSilhouette(g, sx, sy - r * 0.28, r * 0.82, pres.silhouette, u.facing);

      // Bright energy core.
      g.fillStyle(lighten(pres.color, 0.6), isYou ? 0.95 : 0.7);
      g.fillCircle(sx, sy, r * 0.3);
      g.fillStyle(0xffffff, isYou ? 0.9 : 0.6);
      g.fillCircle(sx - r * 0.08, sy - r * 0.08, r * 0.13);

      // Class-colored rim. The live "you" gets a bright white rim; echoes get
      // a class-colored rim (thicker under colour-blind mode for identity).
      const rimW = colorBlindMode() ? 3 : 2;
      if (isYou) {
        g.lineStyle(3, COLORS.youOutline, 1);
        g.strokeCircle(sx, sy, r + 3);
        g.lineStyle(1.5, lighten(pres.color, 0.4), 0.9);
        g.strokeCircle(sx, sy, r + 5);
      } else {
        g.lineStyle(rimW, lighten(pres.color, 0.3), 0.9);
        g.strokeCircle(sx, sy, r + 2);
      }

      // Status auras.
      if (u.sanctuaryTicks > 0) {
        g.lineStyle(2, 0x81c784, 0.55);
        g.strokeCircle(sx, sy, r + 8);
        if (Math.random() < 0.3) this.vfx.aura(sx, sy, r + 6, 0x9fe6a8, 2, 20);
      }
      if (u.chargeTicks > 0) {
        g.lineStyle(3, 0xffe08a, 0.9);
        g.strokeCircle(sx, sy, r + 6);
      }
      if (u.invulnTicks > 0 && u.invulnHits > 0) {
        g.lineStyle(2, 0xba68c8, 0.85);
        g.strokeCircle(sx, sy, r + 10);
      }

      // HP bar (crisper: shadowed back + gradient fill).
      const barW = this.ws(34);
      const bx = sx - barW / 2;
      const by = sy - r - 12;
      g.fillStyle(TINTS.shadow, 0.5);
      g.fillRect(bx - 1, by - 1, barW + 2, 6);
      g.fillStyle(COLORS.hpBack, 0.95);
      g.fillRect(bx, by, barW, 4);
      const frac = Math.max(0, u.hp / u.maxHp);
      const hpCol = frac > 0.35 ? COLORS.hpFill : COLORS.hpFillLow;
      g.fillStyle(hpCol, 1);
      g.fillRect(bx, by, barW * frac, 4);
      g.fillStyle(lighten(hpCol, 0.4), 0.7);
      g.fillRect(bx, by, barW * frac, 1.5);

      const badge = isYou ? 'YOU' : `${u.slot + 1}`;
      this.label(sx, sy, badge, isYou ? 9 : 10, isYou ? '#ffffff' : '#06080f', true);
    }
  }

  /**
   * Layered boss render: gradient body, glowing energy core that pulses with
   * phase, and a facing beam. Phase 2 (<=50% HP) reads hotter/brighter. All
   * presentation-only; nothing here feeds the sim.
   */
  private drawBoss(g: Phaser.GameObjects.Graphics, u: Unit, sx: number, sy: number, cur: SimState): void {
    const r = this.ws(BOSS_RADIUS);
    const frac = Math.max(0, u.hp / u.maxHp);

    // Presentation-only damage numbers + hit sparks: derived purely from the
    // rendered boss-HP delta during live play. Never read by the sim.
    if (this.phase === 'playing') {
      if (this.lastBossHp >= 0 && u.hp < this.lastBossHp) {
        this.bossDmgAccum += this.lastBossHp - u.hp;
        // Flush as a floating number once a few hits accumulate (keeps the pool
        // uncluttered under rapid fire) and shows big hits boldly.
        if (this.bossDmgAccum >= 8) {
          const big = this.bossDmgAccum >= 60;
          this.vfx.damageNumber(sx + (Math.random() - 0.5) * 20, sy - r * 0.6, this.bossDmgAccum, big ? '#ffd24a' : '#fff0b0', big);
          this.vfx.spark(sx, sy, (Math.random() - 0.5), (Math.random() - 0.5), 0xffe08a, 3);
          this.bossDmgAccum = 0;
        }
      }
      this.lastBossHp = u.hp;
    }
    const phase2 = frac <= PHASE1_THRESHOLD;
    // Pulse speed/strength ramps up in phase 2 for a cinematic "enraged" read.
    const pulseHz = phase2 ? 0.012 : 0.006;
    const pulse = 0.5 + 0.5 * Math.sin(this.clock * pulseHz);

    // Outer glow halo (hotter in phase 2).
    const haloCol = phase2 ? 0xff6b57 : GLOWS.danger;
    g.fillStyle(haloCol, 0.1 + pulse * 0.08);
    g.fillCircle(sx, sy, r * (1.35 + pulse * 0.12));

    // Gradient body: darker rim base + lighter top cap.
    g.fillStyle(darken(COLORS.boss, 0.3), 1);
    g.fillCircle(sx, sy, r);
    g.fillStyle(lighten(COLORS.boss, 0.18), 0.9);
    g.fillCircle(sx, sy - r * 0.22, r * 0.82);

    // Rotating ring of energy nodes (clockwork motif), slow in p1, fast in p2.
    const nodes = 8;
    const spin = this.clock * (phase2 ? 0.0016 : 0.0008);
    g.fillStyle(lighten(haloCol, 0.3), 0.7 + pulse * 0.2);
    for (let i = 0; i < nodes; i++) {
      const a = spin + (i / nodes) * Math.PI * 2;
      g.fillCircle(sx + Math.cos(a) * r * 0.82, sy + Math.sin(a) * r * 0.82, 2.5 + pulse * 1.5);
    }

    // Glowing energy core (pulses with phase).
    const coreR = r * (0.4 + pulse * 0.1);
    g.fillStyle(lighten(COLORS.bossCore, pulse * 0.3), 0.95);
    g.fillCircle(sx, sy, coreR);
    g.fillStyle(0xffffff, 0.85);
    g.fillCircle(sx - coreR * 0.15, sy - coreR * 0.15, coreR * 0.4);

    // Bright facing beam.
    const fx = sx + Math.cos((u.facing / 4096) * Math.PI * 2) * r;
    const fy = sy + Math.sin((u.facing / 4096) * Math.PI * 2) * r;
    g.lineStyle(3, 0xffffff, 0.85);
    g.lineBetween(sx, sy, fx, fy);

    // In phase 2, occasionally shed a few embers for a "seething" feel (pooled).
    if (phase2 && Math.random() < 0.1) {
      this.vfx.aura(sx, sy, r * 0.9, haloCol, 2, 18);
    }
    void cur;
  }

  private drawSilhouette(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number, shape: string, facing: number): void {
    const a = (facing / 4096) * Math.PI * 2;
    if (shape === 'shield') {
      g.fillRoundedRect(x - r, y - r, r * 2, r * 2, 4);
    } else if (shape === 'cross') {
      g.fillRect(x - r * 0.35, y - r, r * 0.7, r * 2);
      g.fillRect(x - r, y - r * 0.35, r * 2, r * 0.7);
    } else if (shape === 'arrow') {
      const tip = { x: x + Math.cos(a) * r * 1.4, y: y + Math.sin(a) * r * 1.4 };
      const b1 = { x: x + Math.cos(a + 2.5) * r, y: y + Math.sin(a + 2.5) * r };
      const b2 = { x: x + Math.cos(a - 2.5) * r, y: y + Math.sin(a - 2.5) * r };
      g.fillTriangle(tip.x, tip.y, b1.x, b1.y, b2.x, b2.y);
    } else if (shape === 'flame') {
      g.fillTriangle(x, y - r * 1.3, x - r, y + r, x + r, y + r);
      g.fillCircle(x, y + r * 0.3, r * 0.6);
    } else if (shape === 'dagger') {
      g.fillTriangle(x, y - r * 1.4, x - r * 0.5, y + r, x + r * 0.5, y + r);
    } else if (shape === 'gear') {
      g.fillCircle(x, y, r);
      for (let i = 0; i < 6; i++) {
        const ga = (i / 6) * Math.PI * 2;
        g.fillRect(x + Math.cos(ga) * r - 2, y + Math.sin(ga) * r - 2, 5, 5);
      }
    } else if (shape === 'diamond') {
      g.fillPoints(
        [
          new Phaser.Math.Vector2(x, y - r * 1.3),
          new Phaser.Math.Vector2(x + r, y),
          new Phaser.Math.Vector2(x, y + r * 1.3),
          new Phaser.Math.Vector2(x - r, y),
        ],
        true,
      );
    } else {
      g.fillCircle(x, y, r);
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
      const hostile = p.hitsEveryone || p.team === 'enemy';
      const coreCol = hostile ? COLORS.paradox : 0xffd27a;
      if (p.visual === 'meteor') {
        // Ground telegraph circle while fused, with a glowing marker + core.
        const ar = this.ws(p.aoeRadius ?? 40);
        g.fillStyle(0xff7043, 0.12);
        g.fillCircle(sx, sy, ar);
        g.lineStyle(2, 0xff7043, 0.9);
        g.strokeCircle(sx, sy, ar);
        g.fillStyle(0xffd27a, 0.4);
        g.fillCircle(sx, sy, this.ws(10));
        g.fillStyle(0xfff2cc, 1);
        g.fillCircle(sx, sy, this.ws(6));
      } else {
        let rad = 4;
        let col = coreCol;
        if (p.piercing || p.visual === 'beam') {
          rad = 7;
          col = hostile ? COLORS.paradox : 0xffe08a;
        } else if (p.visual === 'orb') {
          rad = 6;
          col = hostile ? COLORS.paradox : 0xff7043;
        }
        const rr = this.ws(rad);
        // Soft glow halo + bright white-hot core.
        g.fillStyle(col, 0.25);
        g.fillCircle(sx, sy, rr * 2);
        g.fillStyle(col, 1);
        g.fillCircle(sx, sy, rr);
        g.fillStyle(lighten(col, 0.5), 0.9);
        g.fillCircle(sx, sy, rr * 0.5);
        // Pooled trail dot (cheap, honors reduced-motion by skipping).
        if (!reducedMotion() && Math.random() < 0.6) {
          this.vfx.trail(sx, sy, col, Math.max(2, rr * 0.6), 10);
        }
      }
    }
  }

  private drawTurrets(cur: SimState): void {
    const g = this.world;
    for (const t of cur.turrets) {
      const sx = this.wx(t.x);
      const sy = this.wy(t.y);
      g.fillStyle(t.hostileToAll ? COLORS.paradox : COLORS.turret, 1);
      g.fillRect(sx - this.ws(10), sy - this.ws(10), this.ws(20), this.ws(20));
      // Barrel.
      const fx = sx + Math.cos((t.facing / 4096) * Math.PI * 2) * this.ws(16);
      const fy = sy + Math.sin((t.facing / 4096) * Math.PI * 2) * this.ws(16);
      g.lineStyle(3, 0x0b0f1a, 1);
      g.lineBetween(sx, sy, fx, fy);
      // HP bar.
      const barW = this.ws(24);
      g.fillStyle(COLORS.hpBack, 0.9);
      g.fillRect(sx - barW / 2, sy - this.ws(16), barW, 3);
      g.fillStyle(COLORS.hpFill, 1);
      g.fillRect(sx - barW / 2, sy - this.ws(16), barW * Math.max(0, t.hp / t.maxHp), 3);
    }
  }

  private drawInteractables(cur: SimState): void {
    const g = this.world;
    for (const it of cur.interactables) {
      const sx = this.wx(it.x);
      const sy = this.wy(it.y);
      if (it.taken && it.kind === 'shard') {
        // One-shot pickup sparkle on the grab transition (presentation-only).
        if (!this.grabbedShards.has(it.id)) {
          this.grabbedShards.add(it.id);
          this.vfx.sparkle(sx, sy, COLORS.shardIcon, 7);
          this.vfx.ring(sx, sy, COLORS.interactable, 8, 2.5, 16, 2);
        }
        g.lineStyle(1, 0x334, 0.5);
        g.strokeCircle(sx, sy, this.ws(it.radius));
        continue;
      }
      // Pulsing collect ring + glowing star icon.
      const pulse = reducedMotion() ? 0.5 : 0.5 + 0.5 * Math.sin(this.clock * 0.005);
      g.lineStyle(2, COLORS.interactable, 0.2 + pulse * 0.3);
      g.strokeCircle(sx, sy, this.ws(it.radius) * (0.9 + pulse * 0.1));
      g.fillStyle(COLORS.interactable, 0.18);
      g.fillCircle(sx, sy, this.ws(12));
      g.fillStyle(COLORS.shardIcon, 0.95);
      this.starShape(g, sx, sy, this.ws(10), COLORS.shardIcon);
      // Idle twinkle (occasional, pooled, within caps).
      if (!reducedMotion() && Math.random() < 0.03) this.vfx.sparkle(sx, sy, COLORS.shardIcon, 2);
    }
  }

  private drawConvergence(cur: SimState): void {
    const g = this.world;
    const avatar = cur.units.find((u) => u.classId === 'avatar' && u.alive);
    if (!avatar || avatar.convergeFireTicks <= 0) return;
    const boss = cur.units.find((u) => u.kind === 'boss');
    if (!boss) return;
    const bx = this.wx(boss.x);
    const by = this.wy(boss.y);
    // Convergence climax: bright energy beams from the Avatar + each alive echo
    // into the boss, a swelling light core at the boss, and a particle
    // crescendo. Driven off render/VFX only - never the sim.
    for (const u of cur.units) {
      const beams = (u.classId === 'avatar' && u.alive) || (u.kind === 'echo' && u.alive && !u.paradox);
      if (!beams) continue;
      const ux = this.wx(u.x);
      const uy = this.wy(u.y);
      // Wide soft beam + bright inner beam.
      g.lineStyle(7 + Math.random() * 3, COLORS.convergence, 0.2);
      g.lineBetween(ux, uy, bx, by);
      g.lineStyle(3 + Math.random() * 2, lighten(COLORS.convergence, 0.4), 0.95);
      g.lineBetween(ux, uy, bx, by);
      // Energy sparks streaming toward the boss.
      if (!reducedMotion() && Math.random() < 0.5) {
        const t = Math.random();
        this.vfx.trail(ux + (bx - ux) * t, uy + (by - uy) * t, COLORS.convergence, 3, 10);
      }
    }
    // Swelling light core at the boss + crescendo bloom.
    const pulse = 0.5 + 0.5 * Math.sin(this.clock * 0.03);
    g.fillStyle(COLORS.convergence, 0.18 + pulse * 0.1);
    g.fillCircle(bx, by, this.ws(BOSS_RADIUS) * (1.6 + pulse * 0.4));
    g.fillStyle(0xffffff, 0.5 + pulse * 0.3);
    g.fillCircle(bx, by, this.ws(BOSS_RADIUS) * 0.5);
    this.vfx.burst(bx, by, COLORS.convergence, 6, 5, 20, 3);
    this.pulseBloom(0.3);
  }

  private drawAttacks(cur: SimState): void {
    const g = this.world;
    for (const a of cur.attacks) {
      const telegraphing = a.telegraphTicks > 0;
      // Preserve the existing safe/danger semantics: red while telegraphing
      // (incoming danger), warm gold on the active frame (safe-colour).
      const color = telegraphing ? COLORS.telegraph : COLORS.telegraphSafe;
      // Pulse the telegraph fill so an incoming hit reads urgently; the active
      // frame is a brighter solid flash.
      const pulse = telegraphing ? 0.5 + 0.5 * Math.sin(this.clock * 0.02) : 1;
      const fillAlpha = (telegraphing ? 0.22 : 0.42) * (0.7 + pulse * 0.3);
      const sx = this.wx(a.x);
      const sy = this.wy(a.y);
      if (a.shape === 'slam') {
        const rr = this.ws(a.radius);
        // Soft glow ring that booms outward with the pulse.
        g.lineStyle(6, color, 0.12 * pulse);
        g.strokeCircle(sx, sy, rr);
        g.fillStyle(color, fillAlpha);
        g.fillCircle(sx, sy, rr);
        g.lineStyle(2.5, lighten(color, 0.3), 0.95);
        g.strokeCircle(sx, sy, rr);
      } else if (a.shape === 'cone') {
        this.drawCone(g, sx, sy, this.ws(a.radius), a.angle, a.halfArc, color, fillAlpha);
      } else {
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

  private drawCone(g: Phaser.GameObjects.Graphics, x: number, y: number, radius: number, angle: number, halfArc: number, color: number, fillAlpha: number): void {
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

  private drawThreatLine(cur: SimState, prev: SimState, alpha: number): void {
    const boss = cur.units.find((u) => u.kind === 'boss');
    if (!boss || !boss.alive || cur.boss.targetId < 0) return;
    const target = this.unitById(cur, cur.boss.targetId);
    if (!target || !target.alive) return;
    const pboss = this.unitById(prev, boss.id);
    const bx = this.wx(pboss ? this.lerp(pboss.x, boss.x, alpha) : boss.x);
    const by = this.wy(pboss ? this.lerp(pboss.y, boss.y, alpha) : boss.y);
    const ptar = this.unitById(prev, target.id);
    const tx = this.wx(ptar ? this.lerp(ptar.x, target.x, alpha) : target.x);
    const ty = this.wy(ptar ? this.lerp(ptar.y, target.y, alpha) : target.y);
    this.world.lineStyle(2, COLORS.threatLine, 0.6);
    this.world.lineBetween(bx, by, tx, ty);
  }

  private drawScrubberWorld(): void {
    if (!this.preSim) return;
    const g = this.world;
    const pre = this.preSim.result;
    // Ghost paths (toggled).
    for (const gp of pre.ghostPaths) {
      if (!this.ghostOn.has(gp.slot)) continue;
      const pres = gp.classId ? CLASS_PRESENTATION[gp.classId] : null;
      g.lineStyle(1.5, pres ? pres.color : 0x8899aa, 0.6);
      let started = false;
      for (let t = 0; t < gp.points.length; t += 2 * 6) {
        const x = this.wx(gp.points[t]!);
        const y = this.wy(gp.points[t + 1]!);
        if (!started) {
          g.beginPath();
          g.moveTo(x, y);
          started = true;
        } else {
          g.lineTo(x, y);
        }
      }
      if (started) g.strokePath();
    }
    // Snapshot at the scrub position: echoes, HP, boss, telegraphs.
    const snap = this.nearestSnapshot(pre.snapshots, this.scrubTick);
    if (snap) {
      for (const u of snap.units) {
        const sx = this.wx(u.x);
        const sy = this.wy(u.y);
        if (u.kind === 'boss') {
          g.fillStyle(COLORS.boss, 0.5);
          g.fillCircle(sx, sy, this.ws(BOSS_RADIUS));
          continue;
        }
        const pres = u.classId ? CLASS_PRESENTATION[u.classId] : null;
        g.fillStyle(u.paradox ? COLORS.paradox : pres ? pres.color : 0x8899aa, 0.7);
        this.drawSilhouette(g, sx, sy, Math.max(10, this.ws(18)), pres ? pres.silhouette : 'cross', 0);
        const barW = this.ws(30);
        g.fillStyle(COLORS.hpBack, 0.8);
        g.fillRect(sx - barW / 2, sy - this.ws(24), barW, 3);
        g.fillStyle(COLORS.hpFill, 1);
        g.fillRect(sx - barW / 2, sy - this.ws(24), barW * Math.max(0, u.hp / u.maxHp), 3);
      }
      for (const tel of snap.telegraphs) {
        const sx = this.wx(tel.x);
        const sy = this.wy(tel.y);
        g.lineStyle(2, tel.telegraph ? COLORS.telegraph : COLORS.telegraphSafe, 0.6);
        if (tel.shape === 'slam') g.strokeCircle(sx, sy, this.ws(tel.radius));
      }
    }
  }

  private nearestSnapshot(snaps: { tick: number }[], tick: number): (typeof snaps)[number] & { units: { x: number; y: number; hp: number; maxHp: number; kind: string; classId: ClassId | null; paradox: boolean }[]; telegraphs: { shape: string; x: number; y: number; radius: number; telegraph: boolean }[] } {
    let best = snaps[0];
    let bestD = Infinity;
    for (const s of snaps) {
      const d = Math.abs(s.tick - tick);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best as never;
  }

  private drawCountdown(): void {
    const n = Math.ceil(this.countdown / 60);
    this.label(this.scale.width / 2, this.scale.height / 2, n > 0 ? `${n}` : 'GO', 64, '#ffd24a', true);
  }

  private drawFloatingTexts(): void {
    // Floating texts belong to live play; don't stack them over the cinematic.
    if (this.phase === 'cinematic' || this.phase === 'result') {
      this.floatingTexts = [];
      return;
    }
    for (const ft of this.floatingTexts) {
      this.label(this.wx(ft.x), this.wy(ft.y) - (150 - ft.life) * 0.3, ft.text, 12, '#ff6b8a', true);
      ft.life -= 1;
    }
    this.floatingTexts = this.floatingTexts.filter((f) => f.life > 0);
  }

  private drawHud(cur: SimState): void {
    const g = this.hud;
    const w = this.scale.width;

    const boss = cur.units.find((u) => u.kind === 'boss');
    if (boss) {
      const bw = w - 80;
      const bx = 40;
      const by = 40;
      const bh = 14;
      // Soft shadow + track.
      g.fillStyle(TINTS.shadow, 0.6);
      g.fillRoundedRect(bx - 2, by + 2, bw + 4, bh + 2, 7);
      g.fillStyle(COLORS.hpBack, 1);
      g.fillRoundedRect(bx, by, bw, bh, 6);
      const frac = Math.max(0, boss.hp / boss.maxHp);
      // Gradient fill (lit top -> darker bottom) + a bright highlight line.
      if (frac > 0) {
        const fw = bw * frac;
        g.fillStyle(darken(COLORS.boss, 0.25), 1);
        g.fillRoundedRect(bx, by, fw, bh, 6);
        g.fillStyle(lighten(COLORS.boss, 0.2), 0.9);
        g.fillRoundedRect(bx, by, fw, bh * 0.5, 6);
        g.fillStyle(lighten(COLORS.boss, 0.5), 0.6);
        g.fillRect(bx + 3, by + 2, Math.max(0, fw - 6), 1.5);
      }
      // Phase marker.
      const tickX = bx + bw * PHASE1_THRESHOLD;
      g.lineStyle(2, 0xffffff, 0.85);
      g.lineBetween(tickX, by - 3, tickX, by + bh + 3);
      // Glow rim.
      g.lineStyle(1, lighten(COLORS.boss, 0.3), 0.5);
      g.strokeRoundedRect(bx, by, bw, bh, 6);
      this.label(w / 2, 25, `THE WARDEN   ${Math.ceil(boss.hp)} / ${boss.maxHp}`, 12, '#e8ecff', true);
    }

    // Slot timeline with paradox markers.
    const slotY = 70;
    for (let s = 0; s < this.level.slotCount; s++) {
      const sx = 52 + s * 40;
      const cls = cur.slotClasses[s];
      const unit = cur.units.find((u) => u.slot === s && (u.kind === 'player' || u.kind === 'echo'));
      const isRecording = s === this.runner.recordingSlot && (this.phase === 'playing' || this.phase === 'planning');
      const paradox = unit?.paradox === true;
      // Soft shadow under each slot chip.
      g.fillStyle(TINTS.shadow, 0.5);
      g.fillRoundedRect(sx - 15, slotY - 13, 30, 30, 6);
      const baseCol = cls ? (paradox ? COLORS.paradox : CLASS_PRESENTATION[cls].color) : 0x2a3350;
      const alive = cls ? (unit ? unit.alive : true) : true;
      // Gradient fill chip.
      g.fillStyle(darken(baseCol, 0.3), alive ? 1 : 0.25);
      g.fillRoundedRect(sx - 15, slotY - 15, 30, 30, 6);
      g.fillStyle(lighten(baseCol, 0.2), alive ? 0.8 : 0.2);
      g.fillRoundedRect(sx - 15, slotY - 15, 30, 15, 6);
      // Rim: bright white (+glow) while recording, else class/paradox colour.
      if (isRecording) {
        g.lineStyle(5, baseCol, 0.25);
        g.strokeRoundedRect(sx - 15, slotY - 15, 30, 30, 6);
        g.lineStyle(3, 0xffffff, 1);
      } else {
        g.lineStyle(1.5, lighten(baseCol, 0.3), paradox ? 1 : 0.8);
      }
      g.strokeRoundedRect(sx - 15, slotY - 15, 30, 30, 6);
      const short = cls ? CLASS_PRESENTATION[cls].name[0] : '·';
      this.label(sx, slotY, paradox ? 'X' : short ?? '·', 13, '#06080f', true);
    }

    // Time Shards indicator (top-right, above the loop ring).
    for (let i = 0; i < this.runner.shards; i++) {
      const shx = w - 40 - i * 16;
      g.fillStyle(0x64ffda, 0.25);
      g.fillCircle(shx, 44, 9);
      this.starShape(g, shx, 44, 6, 0x64ffda);
    }

    // Loop timer ring.
    const ringX = w - 46;
    const ringY = 92;
    const ringR = 18;
    const tfrac = Math.min(1, cur.tick / cur.loopLength);
    // Inner disc + glow so the timer reads as a lit dial.
    g.fillStyle(0x121831, 0.85);
    g.fillCircle(ringX, ringY, ringR);
    g.lineStyle(4, 0x2a3350, 1);
    g.strokeCircle(ringX, ringY, ringR);
    // Arc turns from accent -> warning red as time runs low.
    const remaining = 1 - tfrac;
    const arcCol = remaining < 0.25 ? COLORS.hpFillLow : remaining < 0.5 ? GLOWS.gold : 0x64b5ff;
    g.lineStyle(6, arcCol, 0.15);
    this.drawStrokeArc(g, ringX, ringY, ringR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * remaining, arcCol, 6);
    this.drawStrokeArc(g, ringX, ringY, ringR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * remaining, lighten(arcCol, 0.2), 4);
    const secsLeft = Math.max(0, Math.ceil((cur.loopLength - cur.tick) / 60));
    this.label(ringX, ringY, `${secsLeft}`, 12, '#e8ecff', true);

    // Live player cooldowns + Avatar Convergence charge.
    const you = cur.units.find((u) => u.kind === 'player' && u.alive);
    if (you && you.classId) {
      const stats = classStats(you.classId);
      const baseY = this.scale.height - 70;
      this.drawCooldown(g, this.scale.width - 60, baseY, 26, you.skillCd, stats.skillCd, 0xffcf5a, 'SKL');
      this.drawCooldown(g, this.scale.width - 122, baseY, 24, you.dashCd, stats.dashCd, 0x64b5ff, 'DSH');
      if (you.classId === 'avatar') {
        const cfrac = Math.min(1, you.convergeCharge / CONVERGENCE_CHARGE);
        const cy = this.scale.height - 76;
        const ready = cfrac >= 1;
        g.fillStyle(TINTS.shadow, 0.6);
        g.fillRoundedRect(59, cy + 1, 142, 13, 6);
        g.fillStyle(COLORS.hpBack, 1);
        g.fillRoundedRect(60, cy, 140, 12, 6);
        const fw = 140 * cfrac;
        g.fillStyle(darken(COLORS.convergence, 0.2), 1);
        g.fillRoundedRect(60, cy, fw, 12, 6);
        g.fillStyle(lighten(COLORS.convergence, 0.3), 0.85);
        g.fillRoundedRect(60, cy, fw, 6, 6);
        // When ready, pulse a glowing rim to invite the Convergence.
        if (ready) {
          const pulse = reducedFlashing() ? 0.5 : 0.5 + 0.5 * Math.sin(this.clock * 0.012);
          g.lineStyle(2, lighten(COLORS.convergence, 0.4), 0.5 + pulse * 0.5);
          g.strokeRoundedRect(60, cy, 140, 12, 6);
        }
        this.label(130, this.scale.height - 70, ready ? 'CONVERGENCE READY' : 'CONVERGENCE', 10, '#06080f', true);
      }
    }
  }

  private drawCooldown(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number, cd: number, max: number, color: number, label: string): void {
    g.fillStyle(0x1a2036, 0.95);
    g.fillCircle(x, y, r);
    const ready = cd <= 0 || max <= 0;
    if (ready) {
      g.lineStyle(3, color, 1);
      g.strokeCircle(x, y, r);
    } else {
      g.lineStyle(3, 0x39415c, 1);
      g.strokeCircle(x, y, r);
      const frac = cd / max;
      const start = -Math.PI / 2;
      const end = start + Math.PI * 2 * (1 - frac);
      this.drawStrokeArc(g, x, y, r, start, end, color, 3);
    }
    this.label(x, y, label, 9, ready ? '#e8ecff' : '#8a93b8', true);
  }

  private drawStrokeArc(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number, start: number, end: number, color: number, width: number): void {
    if (end <= start) return;
    g.lineStyle(width, color, 0.95);
    g.beginPath();
    g.arc(x, y, r, start, end, false);
    g.strokePath();
  }

  // ================= Audio layers =================

  private updateAudioLayers(): void {
    if (!this.audio.isUnlocked) return;
    const alive = new Map<ClassId, boolean>();
    const paradox = new Map<ClassId, boolean>();
    for (const u of this.runner.state.units) {
      if ((u.kind === 'player' || u.kind === 'echo') && u.classId) {
        if (u.alive) alive.set(u.classId, true);
        if (u.paradox) paradox.set(u.classId, true);
      }
    }
    this.audio.setLayerStates(alive, paradox);
  }

  private clearOverlay(): void {
    this.overlay.removeAll(true);
  }

  /** Recompute the world transform + overlay positions on a live resize. */
  private onResize(): void {
    this.computeTransform();
    this.backdrop?.resize(this.scale.width, this.scale.height);
    if (this.banner) this.banner.setPosition(this.scale.width / 2, this.scale.height / 2 - 40);
    this.debug?.reposition();
  }

  /**
   * Camera shake that honors the "screen shake" accessibility setting
   * (presentation-only; disabled -> no shake). Keeps the sim untouched.
   */
  private shakeCam(durationMs: number, intensity: number): void {
    if (!screenShakeEnabled()) return;
    this.vfx.shake(this.cameras.main, durationMs, intensity);
  }

  /**
   * Full-screen flash that respects reduced-flashing (dimmed) and screen-shake
   * is unrelated; purely a Camera effect, never the sim.
   */
  private flashCam(durationMs: number, r: number, g: number, b: number): void {
    const k = reducedFlashing() ? 0.35 : 1;
    this.vfx.flash(this.cameras.main, durationMs, Math.round(r * k), Math.round(g * k), Math.round(b * k));
  }

  /** Briefly push the cinematic bloom above base for a crescendo moment. */
  private pulseBloom(amount: number): void {
    if (reducedFlashing()) amount *= 0.4;
    this.bloomPulse = Math.max(this.bloomPulse, amount);
    this.filters.setBloom(Math.min(1.6, this.baseBloom + this.bloomPulse));
  }

  /**
   * Auto resolution scaling (brief 9.6): sample FPS and, if it holds below 50,
   * drop the renderer resolution to buy frame budget; recover it when FPS is
   * comfortably back above 58. Purely a render concern - the fixed 60 Hz sim is
   * untouched (it slows down, never skips).
   */
  private updateAutoResolution(deltaMs: number): void {
    const fps = this.game.loop.actualFps;
    if (!isFinite(fps) || fps <= 0) return;
    this.fpsSamples.push(fps);
    if (this.fpsSamples.length > 30) this.fpsSamples.shift();
    if (this.resCooldown > 0) {
      this.resCooldown -= deltaMs;
      return;
    }
    if (this.fpsSamples.length < 20) return;
    const avg = this.fpsSamples.reduce((a, b) => a + b, 0) / this.fpsSamples.length;
    let next = this.currentResScale;
    if (avg < 50 && this.currentResScale > 0.6) {
      next = Math.max(0.6, this.currentResScale - 0.15);
    } else if (avg > 58 && this.currentResScale < 1) {
      next = Math.min(1, this.currentResScale + 0.15);
    }
    if (next !== this.currentResScale) {
      this.currentResScale = next;
      this.applyResolutionScale(next);
      this.resCooldown = 1500;
      this.fpsSamples.length = 0;
    }
  }

  private applyResolutionScale(scale: number): void {
    // Reduce the canvas backing-store resolution while CSS keeps the display
    // size constant: the GPU rasterises fewer pixels (lower fill-rate cost)
    // and the browser upscales. Logical/world coordinates are unchanged, so the
    // sim and input mapping are untouched. Degrades safely if the canvas is
    // absent (headless software renderer).
    const canvas = this.game.canvas as HTMLCanvasElement | undefined;
    if (!canvas) return;
    try {
      const cssW = canvas.clientWidth || canvas.width;
      const cssH = canvas.clientHeight || canvas.height;
      const dpr = window.devicePixelRatio || 1;
      const targetW = Math.max(1, Math.round(cssW * dpr * scale));
      const targetH = Math.max(1, Math.round(cssH * dpr * scale));
      this.game.renderer.resize(targetW, targetH);
      canvas.style.width = cssW + 'px';
      canvas.style.height = cssH + 'px';
    } catch {
      /* renderer without dynamic resize - safe to ignore */
    }
  }

  private onShutdown(): void {
    this.game.events.off(Phaser.Core.Events.HIDDEN, this.onHidden, this);
    this.game.events.off(Phaser.Core.Events.VISIBLE, this.onVisible, this);
    this.scale.off(Phaser.Scale.Events.RESIZE, this.onResize, this);
    this.controller?.destroy();
    this.devHook?.dispose();
    this.debug?.destroy();
    this.vfx?.destroy();
    this.backdrop?.destroy();
    this.audio?.stopMusic();
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
  getParadoxCount(): number {
    return this.runner.state.paradoxEvents.length;
  }

  /** The last winning run's replay code (M4 dev/e2e), or null. */
  private lastReplayCode: string | null = null;
  getLastReplayCode(): string | null {
    return this.lastReplayCode;
  }
}
