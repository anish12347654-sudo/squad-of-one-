/**
 * Procedural WebAudio engine (brief section 8). No audio assets: everything is
 * synthesized. Adaptive "desi synthwave" at 120 BPM (a 20 s loop = 10 bars),
 * one instrument layer per class slot, gated by echo life; a paradox detunes +
 * bitcrushes its layer. Also exposes procedural SFX for every action.
 *
 * Audio is unlocked on the first user gesture (contract 8). Until then this is
 * a no-op, so autoplay policies are respected.
 */

import type { ClassId } from '@sim/index.js';

/** BPM + loop timing (contract 8). */
export const BPM = 120;
const SECONDS_PER_BEAT = 60 / BPM;
const BEATS_PER_BAR = 4;
const BARS_PER_LOOP = 10; // 10 bars * 2s/bar = 20s loop

/** Minor pentatonic-ish scale for the desi-synthwave vibe (A minor). */
const SCALE_HZ = [220.0, 261.63, 293.66, 329.63, 392.0, 440.0, 523.25];

type LayerId = ClassId;

interface Layer {
  gain: GainNode;
  active: boolean;
  paradox: boolean;
  targetGain: number;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private layers: Map<LayerId, Layer> = new Map();
  private unlocked = false;
  private playing = false;
  private schedulerTimer: number | null = null;
  private nextNoteTime = 0;
  private step = 0; // 16th-note step within the loop

  // Desired 0..1 volumes (from settings). Applied on unlock and on change.
  private volMaster = 0.6;
  private volMusic = 0.7;
  private volSfx = 0.5;

  /** True once audio has been unlocked by a user gesture. */
  get isUnlocked(): boolean {
    return this.unlocked;
  }

  /** Unlock + start the audio context on the first user gesture. */
  unlock(): void {
    if (this.unlocked) return;
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volMaster;
      this.master.connect(this.ctx.destination);
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = this.volMusic;
      this.musicBus.connect(this.master);
      // One gain-controlled layer per class.
      const ids: LayerId[] = ['guardian', 'medic', 'ranger', 'pyromancer', 'rogue', 'engineer', 'avatar'];
      for (const id of ids) {
        const g = this.ctx.createGain();
        g.gain.value = 0;
        g.connect(this.musicBus);
        this.layers.set(id, { gain: g, active: false, paradox: false, targetGain: 0 });
      }
      this.unlocked = true;
      void this.ctx.resume();
    } catch {
      this.unlocked = false;
    }
  }

  /**
   * Set the 0..1 master / music / sfx volumes (from settings). Safe to call
   * before unlock; the values are stored and applied when the graph exists.
   */
  setVolumes(v: { master: number; music: number; sfx: number }): void {
    this.volMaster = clamp01(v.master);
    this.volMusic = clamp01(v.music);
    this.volSfx = clamp01(v.sfx);
    if (this.master) this.master.gain.value = this.volMaster;
    if (this.musicBus) this.musicBus.gain.value = this.volMusic;
    if (this.sfxGain) this.sfxGain.gain.value = this.volSfx * 0.6;
  }

  /** Begin the music scheduler. */
  startMusic(): void {
    if (!this.unlocked || !this.ctx || this.playing) return;
    this.playing = true;
    this.nextNoteTime = this.ctx.currentTime + 0.05;
    this.step = 0;
    this.scheduleLoop();
  }

  stopMusic(): void {
    this.playing = false;
    if (this.schedulerTimer !== null) {
      clearTimeout(this.schedulerTimer);
      this.schedulerTimer = null;
    }
  }

  /**
   * Update which layers are audible. `aliveByClass` maps a classId to whether an
   * alive echo/player of that class is present; `paradoxByClass` marks paradox.
   */
  setLayerStates(aliveByClass: Map<ClassId, boolean>, paradoxByClass: Map<ClassId, boolean>): void {
    if (!this.ctx) return;
    for (const [id, layer] of this.layers) {
      const alive = aliveByClass.get(id) === true;
      const paradox = paradoxByClass.get(id) === true;
      layer.active = alive;
      layer.paradox = paradox;
      layer.targetGain = alive ? (paradox ? 0.4 : 0.9) : 0;
      // Smooth ramp to avoid clicks.
      layer.gain.gain.setTargetAtTime(layer.targetGain, this.ctx.currentTime, 0.15);
    }
  }

  private scheduleLoop(): void {
    if (!this.playing || !this.ctx) return;
    const lookahead = 0.1;
    const secondsPer16th = SECONDS_PER_BEAT / 4;
    while (this.nextNoteTime < this.ctx.currentTime + lookahead) {
      this.scheduleStep(this.step, this.nextNoteTime);
      this.nextNoteTime += secondsPer16th;
      this.step = (this.step + 1) % (BARS_PER_LOOP * BEATS_PER_BAR * 4);
    }
    this.schedulerTimer = window.setTimeout(() => this.scheduleLoop(), 25);
  }

  /** Schedule one 16th-note step across all active layers. */
  private scheduleStep(step: number, time: number): void {
    if (!this.ctx) return;
    const beat = Math.floor(step / 4);
    const sixteenth = step % 4;

    // Guardian: kick+snare drums.
    this.playIf('guardian', () => {
      if (sixteenth === 0) this.drum(time, beat % 2 === 0 ? 'kick' : 'snare', 'guardian');
    });
    // Medic: sustained pad chord roots on the bar.
    this.playIf('medic', () => {
      if (step % 16 === 0) this.pad(time, SCALE_HZ[(beat % 3) * 2] ?? 220, 'medic');
    });
    // Ranger: plucky arp on off-beats.
    this.playIf('ranger', () => {
      if (sixteenth === 2) this.pluck(time, SCALE_HZ[(step % SCALE_HZ.length)] ?? 440, 'ranger');
    });
    // Pyromancer: bass on the beat.
    this.playIf('pyromancer', () => {
      if (sixteenth === 0) this.bass(time, (SCALE_HZ[beat % 3] ?? 220) / 2, 'pyromancer');
    });
    // Rogue: shakers/hats every 16th.
    this.playIf('rogue', () => {
      this.hat(time, sixteenth === 2 ? 0.25 : 0.12, 'rogue');
    });
    // Engineer: chord stabs every half-bar.
    this.playIf('engineer', () => {
      if (step % 8 === 0) this.chord(time, 'engineer');
    });
    // Avatar: soaring lead melody.
    this.playIf('avatar', () => {
      if (sixteenth === 0 || sixteenth === 3) this.lead(time, SCALE_HZ[(beat + step) % SCALE_HZ.length] ?? 523, 'avatar');
    });
  }

  private playIf(id: LayerId, fn: () => void): void {
    const layer = this.layers.get(id);
    if (layer && layer.active) fn();
  }

  private out(id: LayerId): GainNode | null {
    return this.layers.get(id)?.gain ?? null;
  }

  private detune(id: LayerId): number {
    return this.layers.get(id)?.paradox ? 55 : 0; // paradox: sour detune
  }

  // --- Instrument voices (procedural) ---

  private drum(time: number, kind: 'kick' | 'snare', id: LayerId): void {
    if (!this.ctx) return;
    const out = this.out(id);
    if (!out) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    if (kind === 'kick') {
      osc.frequency.setValueAtTime(140, time);
      osc.frequency.exponentialRampToValueAtTime(50, time + 0.12);
      g.gain.setValueAtTime(0.9, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + 0.18);
    } else {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(220, time);
      g.gain.setValueAtTime(0.5, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + 0.12);
    }
    osc.connect(g);
    g.connect(out);
    osc.start(time);
    osc.stop(time + 0.2);
  }

  private pad(time: number, freq: number, id: LayerId): void {
    if (!this.ctx) return;
    const out = this.out(id);
    if (!out) return;
    for (const mult of [1, 1.5]) {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.value = freq * mult;
      osc.detune.value = this.detune(id);
      g.gain.setValueAtTime(0, time);
      g.gain.linearRampToValueAtTime(0.12, time + 0.4);
      g.gain.linearRampToValueAtTime(0, time + 2);
      osc.connect(g);
      g.connect(out);
      osc.start(time);
      osc.stop(time + 2.1);
    }
  }

  private pluck(time: number, freq: number, id: LayerId): void {
    if (!this.ctx) return;
    const out = this.out(id);
    if (!out) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = freq;
    osc.detune.value = this.detune(id);
    g.gain.setValueAtTime(0.22, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.18);
    osc.connect(g);
    g.connect(out);
    osc.start(time);
    osc.stop(time + 0.2);
  }

  private bass(time: number, freq: number, id: LayerId): void {
    if (!this.ctx) return;
    const out = this.out(id);
    if (!out) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = freq;
    osc.detune.value = this.detune(id);
    g.gain.setValueAtTime(0.3, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.45);
    osc.connect(g);
    g.connect(out);
    osc.start(time);
    osc.stop(time + 0.5);
  }

  private hat(time: number, gain: number, id: LayerId): void {
    if (!this.ctx) return;
    const out = this.out(id);
    if (!out) return;
    const buffer = this.noiseBuffer();
    if (!buffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
    src.connect(hp);
    hp.connect(g);
    g.connect(out);
    src.start(time);
    src.stop(time + 0.06);
  }

  private chord(time: number, id: LayerId): void {
    if (!this.ctx) return;
    for (const f of [SCALE_HZ[0]!, SCALE_HZ[2]!, SCALE_HZ[4]!]) {
      this.pluck(time, f, id);
    }
  }

  private lead(time: number, freq: number, id: LayerId): void {
    if (!this.ctx) return;
    const out = this.out(id);
    if (!out) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    osc.detune.value = this.detune(id);
    g.gain.setValueAtTime(0.2, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.3);
    osc.connect(g);
    g.connect(out);
    osc.start(time);
    osc.stop(time + 0.32);
  }

  private noiseBufferCache: AudioBuffer | null = null;
  private noiseBuffer(): AudioBuffer | null {
    if (!this.ctx) return null;
    if (this.noiseBufferCache) return this.noiseBufferCache;
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.1, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBufferCache = buf;
    return buf;
  }

  // --- Procedural SFX for every action (section 8) ---

  private sfxGain: GainNode | null = null;
  private ensureSfxBus(): GainNode | null {
    if (!this.ctx || !this.master) return null;
    if (!this.sfxGain) {
      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = this.volSfx * 0.6;
      this.sfxGain.connect(this.master);
    }
    return this.sfxGain;
  }

  /** Fire a short procedural SFX by key. */
  sfx(key: string): void {
    if (!this.unlocked || !this.ctx) return;
    const bus = this.ensureSfxBus();
    if (!bus) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    let type: OscillatorType = 'square';
    let f0 = 440;
    let f1 = 220;
    let dur = 0.12;
    switch (key) {
      case 'guardian-bash': type = 'square'; f0 = 180; f1 = 90; dur = 0.14; break;
      case 'medic-beam': type = 'sine'; f0 = 660; f1 = 880; dur = 0.1; break;
      case 'ranger-shot': type = 'sawtooth'; f0 = 900; f1 = 300; dur = 0.1; break;
      case 'pyro-orb': type = 'sawtooth'; f0 = 300; f1 = 120; dur = 0.16; break;
      case 'meteor': type = 'sawtooth'; f0 = 120; f1 = 40; dur = 0.5; break;
      case 'rogue-slash': type = 'square'; f0 = 1200; f1 = 500; dur = 0.07; break;
      case 'engineer-bolt': type = 'square'; f0 = 700; f1 = 400; dur = 0.08; break;
      case 'turret': type = 'square'; f0 = 500; f1 = 200; dur = 0.09; break;
      case 'avatar-blade': type = 'triangle'; f0 = 800; f1 = 1200; dur = 0.12; break;
      case 'convergence': type = 'sawtooth'; f0 = 200; f1 = 1600; dur = 0.8; break;
      case 'paradox': type = 'sawtooth'; f0 = 400; f1 = 60; dur = 0.4; break;
      case 'dash': type = 'sine'; f0 = 300; f1 = 700; dur = 0.09; break;
      case 'victory': type = 'triangle'; f0 = 523; f1 = 1046; dur = 0.6; break;
      case 'ui': type = 'square'; f0 = 660; f1 = 880; dur = 0.05; break;
      default: break;
    }
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g);
    g.connect(bus);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /**
   * The live AudioContext + master output node, for the clip exporter to mix
   * game audio into a MediaStreamAudioDestinationNode (brief 6.4). Null until
   * audio is unlocked by a user gesture.
   */
  getAudioGraph(): { context: AudioContext; source: AudioNode } | null {
    if (this.ctx && this.master) return { context: this.ctx, source: this.master };
    return null;
  }

  destroy(): void {
    this.stopMusic();
    try {
      void this.ctx?.close();
    } catch {
      /* ignore */
    }
    this.ctx = null;
  }
}

/** A single shared engine instance for the app. */
let engineSingleton: AudioEngine | null = null;
export function getAudioEngine(): AudioEngine {
  if (!engineSingleton) engineSingleton = new AudioEngine();
  return engineSingleton;
}

/** Clamp a value to [0,1]. */
function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}
