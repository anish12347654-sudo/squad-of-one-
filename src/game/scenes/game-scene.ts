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
import { ARENA_02, CLASS_PRESENTATION, campaignLevelById } from '@content/index.js';
import type { LevelDef } from '@sim/index.js';
import { createInputController, type InputController } from '../input.js';
import { COLORS } from '../render/colors.js';
import { installDevHook, type DevHookApi } from '../dev-hook.js';
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

  // World->screen transform.
  private originX = 0;
  private originY = 0;
  private scaleWorld = 1;

  private devHook: DevHookApi | null = null;

  // Paradox presentation bookkeeping.
  private seenParadox = 0;
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

    this.world = this.add.graphics();
    this.hud = this.add.graphics();
    this.vfx = new Vfx(this, 12);
    this.filters = installFilters(this.world);
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

    const alpha = this.phase === 'playing' ? this.accumulator / TICK_DT_SECONDS : 0;
    this.draw(alpha);
    this.vfx.update();
    this.filters.update(this.phase === 'rewind');
    this.updateAudioLayers();
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
      this.vfx.burst(this.wx(ev.x), this.wy(ev.y), COLORS.paradox, 24, 4, 30, 3);
      this.vfx.shake(this.cameras.main, 200, 0.008);
    }
    this.seenParadox = evs.length;
  }

  private onLoopResolved(result: string): void {
    if (result === 'won') {
      // Spectacular boss death, then the victory cinematic.
      const boss = this.runner.state.units.find((u) => u.kind === 'boss');
      if (boss) {
        this.vfx.burst(this.wx(boss.x), this.wy(boss.y), 0xff8a95, 120, 7, 46, 5);
        this.vfx.burst(this.wx(boss.x), this.wy(boss.y), 0xffffff, 80, 5, 40, 4);
      }
      this.vfx.shake(this.cameras.main, 600, 0.02);
      this.vfx.flash(this.cameras.main, 400, 255, 255, 255);
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
    this.cinematicTimer += dt;
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
        const fx = sx + Math.cos((u.facing / 4096) * Math.PI * 2) * r;
        const fy = sy + Math.sin((u.facing / 4096) * Math.PI * 2) * r;
        g.lineStyle(3, 0xffffff, 0.8);
        g.lineBetween(sx, sy, fx, fy);
        continue;
      }

      if (!u.alive) {
        g.fillStyle(0x33384a, 0.5);
        g.fillCircle(sx, sy, this.ws(10));
        continue;
      }

      const cls = u.classId as ClassId;
      const pres = CLASS_PRESENTATION[cls];
      const isYou = u.kind === 'player';
      const r = Math.max(11, this.ws(20));

      if (u.paradox) {
        // Paradox echo: red, glitching, jittering.
        const jx = (Math.random() - 0.5) * 6;
        const jy = (Math.random() - 0.5) * 6;
        const telegraph = u.paradoxTelegraph > 0;
        g.fillStyle(COLORS.paradox, telegraph ? 0.5 + Math.random() * 0.4 : 0.9);
        this.drawSilhouette(g, sx + jx, sy + jy, r, pres.silhouette, u.facing);
        g.lineStyle(2, COLORS.paradoxGlow, 0.9);
        g.strokeCircle(sx + jx, sy + jy, r + 4 + Math.random() * 3);
        // Glitch shards.
        if (Math.random() < 0.5) {
          g.fillStyle(COLORS.paradoxGlow, 0.7);
          g.fillRect(sx + (Math.random() - 0.5) * 30, sy + (Math.random() - 0.5) * 30, 6, 2);
        }
        this.label(sx, sy, 'X', 12, '#ffffff', true);
        continue;
      }

      const alphaFill = isYou ? 1 : 0.55;
      g.fillStyle(pres.color, alphaFill);
      this.drawSilhouette(g, sx, sy, r, pres.silhouette, u.facing);
      if (isYou) {
        g.lineStyle(3, COLORS.youOutline, 1);
        g.strokeCircle(sx, sy, r + 3);
      }
      if (u.sanctuaryTicks > 0) {
        g.lineStyle(2, 0x81c784, 0.5);
        g.strokeCircle(sx, sy, r + 8);
      }
      if (u.chargeTicks > 0) {
        g.lineStyle(3, 0xffe08a, 0.9);
        g.strokeCircle(sx, sy, r + 6);
      }
      if (u.invulnTicks > 0 && u.invulnHits > 0) {
        g.lineStyle(2, 0xba68c8, 0.8);
        g.strokeCircle(sx, sy, r + 10);
      }

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
      if (p.visual === 'meteor') {
        // Ground telegraph circle while fused.
        g.lineStyle(2, 0xff7043, 0.9);
        g.strokeCircle(sx, sy, this.ws(p.aoeRadius ?? 40));
        g.fillStyle(0xff7043, 0.15);
        g.fillCircle(sx, sy, this.ws(p.aoeRadius ?? 40));
        g.fillStyle(0xffd27a, 1);
        g.fillCircle(sx, sy, this.ws(6));
      } else if (p.piercing || p.visual === 'beam') {
        g.fillStyle(hostile ? COLORS.paradox : 0xffe08a, 1);
        g.fillCircle(sx, sy, this.ws(7));
      } else if (p.visual === 'orb') {
        g.fillStyle(hostile ? COLORS.paradox : 0xff7043, 1);
        g.fillCircle(sx, sy, this.ws(6));
      } else {
        g.fillStyle(hostile ? COLORS.paradox : 0xffd27a, 1);
        g.fillCircle(sx, sy, this.ws(4));
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
        g.lineStyle(1, 0x334, 0.5);
        g.strokeCircle(sx, sy, this.ws(it.radius));
        continue;
      }
      g.fillStyle(COLORS.interactable, 0.85);
      this.starShape(g, sx, sy, this.ws(10), COLORS.shardIcon);
      g.lineStyle(1, COLORS.interactable, 0.3);
      g.strokeCircle(sx, sy, this.ws(it.radius));
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
    // Beam from the Avatar and each alive echo -> boss.
    for (const u of cur.units) {
      const beams = (u.classId === 'avatar' && u.alive) || (u.kind === 'echo' && u.alive && !u.paradox);
      if (!beams) continue;
      const ux = this.wx(u.x);
      const uy = this.wy(u.y);
      g.lineStyle(3 + Math.random() * 2, COLORS.convergence, 0.9);
      g.lineBetween(ux, uy, bx, by);
    }
    this.vfx.burst(bx, by, COLORS.convergence, 6, 5, 20, 3);
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
      g.fillStyle(COLORS.hpBack, 1);
      g.fillRoundedRect(bx, by, bw, 14, 6);
      const frac = Math.max(0, boss.hp / boss.maxHp);
      g.fillStyle(COLORS.boss, 1);
      g.fillRoundedRect(bx, by, bw * frac, 14, 6);
      const tickX = bx + bw * PHASE1_THRESHOLD;
      g.lineStyle(2, 0xffffff, 0.8);
      g.lineBetween(tickX, by - 3, tickX, by + 17);
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
      g.lineStyle(isRecording ? 3 : 1, isRecording ? 0xffffff : paradox ? COLORS.paradox : 0x3a4358, 1);
      if (cls) {
        const pres = CLASS_PRESENTATION[cls];
        const alive = unit ? unit.alive : true;
        g.fillStyle(paradox ? COLORS.paradox : pres.color, alive ? 1 : 0.25);
      } else {
        g.fillStyle(0x2a3350, 1);
      }
      g.fillRoundedRect(sx - 15, slotY - 15, 30, 30, 6);
      g.strokeRoundedRect(sx - 15, slotY - 15, 30, 30, 6);
      const short = cls ? CLASS_PRESENTATION[cls].name[0] : '·';
      this.label(sx, slotY, paradox ? 'X' : short ?? '·', 13, '#0b0f1a', true);
    }

    // Time Shards indicator (top-right, above the loop ring).
    for (let i = 0; i < this.runner.shards; i++) {
      const shx = w - 40 - i * 16;
      this.starShape(g, shx, 44, 6, 0x64ffda);
    }

    // Loop timer ring.
    const ringX = w - 46;
    const ringY = 92;
    const ringR = 18;
    const tfrac = Math.min(1, cur.tick / cur.loopLength);
    g.lineStyle(4, 0x2a3350, 1);
    g.strokeCircle(ringX, ringY, ringR);
    this.drawStrokeArc(g, ringX, ringY, ringR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - tfrac), 0x64b5ff, 4);
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
        g.fillStyle(COLORS.hpBack, 1);
        g.fillRoundedRect(60, this.scale.height - 76, 140, 12, 6);
        g.fillStyle(COLORS.convergence, 1);
        g.fillRoundedRect(60, this.scale.height - 76, 140 * cfrac, 12, 6);
        this.label(130, this.scale.height - 70, cfrac >= 1 ? 'CONVERGENCE READY' : 'CONVERGENCE', 10, '#0b0f1a', true);
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

  private onShutdown(): void {
    this.game.events.off(Phaser.Core.Events.HIDDEN, this.onHidden, this);
    this.game.events.off(Phaser.Core.Events.VISIBLE, this.onVisible, this);
    this.controller?.destroy();
    this.devHook?.dispose();
    this.vfx?.destroy();
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
