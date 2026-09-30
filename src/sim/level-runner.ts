/**
 * LevelRunner - deterministic orchestration of the time-loop (brief 3.1/3.2).
 *
 * This is pure (no wall clock, no Phaser): it owns the sequence of loops, the
 * per-slot recordings, and the live/echo input routing. The fixed-timestep
 * runner in src/game drives it one tick at a time via `tickWith(liveInput)`.
 *
 * Contract (frozen):
 *   - First pass records slot 0, then 1, ... up to slotCount-1.
 *   - Before each recording, the player picks a class (chooseClass()).
 *   - Every loop restarts the whole level from initial state (boss full HP,
 *     same seed); all units spawn at tick 0.
 *   - The world contains every recorded slot except the one being recorded.
 *   - If the live player dies, the loop keeps ticking (fast-forward is a render
 *     concern); the sim still runs every tick.
 *   - Win: boss dies during any loop. Fail: first pass ends with no win.
 */

import {
  createLevelState,
  step,
  setEchoInputs,
  setBossPattern,
} from './sim.js';
import {
  createRecorder,
  finalizeRecording,
  recordTick,
} from './recording.js';
import { emptyInput } from './types.js';
import type { InputFrame, SimState, ClassId } from './types.js';
import type { LevelDef } from './level.js';
import type { Recording } from './recording.js';

export type LevelResult = 'in_progress' | 'won' | 'failed';

export interface Stars {
  won: boolean;
  echoesAlive: number;
  earlyVictory: boolean;
  /** Total star count [0..3]. */
  count: number;
}

export class LevelRunner {
  readonly level: LevelDef;
  /** Class chosen per slot (index = slot). */
  readonly slotClasses: (ClassId | null)[];
  /** Finalized recordings per slot (index = slot). */
  readonly recordings: (Recording | null)[];

  /** Slot currently being recorded (0-based). */
  recordingSlot = 0;
  /** Authoritative current sim state. */
  state: SimState;
  /** Overall level result. */
  result: LevelResult = 'in_progress';
  /** Whether the level has been won on any loop. */
  wonOnSlot = -1;

  private recorder = createRecorder('guardian');
  private echoBuf: Map<number, InputFrame> = new Map();

  constructor(level: LevelDef) {
    this.level = level;
    this.slotClasses = new Array(level.slotCount).fill(null);
    this.recordings = new Array(level.slotCount).fill(null);
    setBossPattern(level.boss.pattern);
    this.state = createLevelState(level, this.recordingSlot, this.slotClasses, false);
  }

  /** True when the runner is waiting for a class pick for the current slot. */
  needsClassChoice(): boolean {
    return this.result === 'in_progress' && this.slotClasses[this.recordingSlot] === null;
  }

  /** Classes already used this level (each usable at most once). */
  usedClasses(): ClassId[] {
    return this.slotClasses.filter((c): c is ClassId => c !== null);
  }

  /** Pick the class for the current recording slot and begin the loop. */
  chooseClass(classId: ClassId): void {
    if (this.usedClasses().includes(classId)) {
      throw new Error(`class ${classId} already used this level`);
    }
    this.slotClasses[this.recordingSlot] = classId;
    this.recorder = createRecorder(classId);
    setBossPattern(this.level.boss.pattern);
    this.state = createLevelState(this.level, this.recordingSlot, this.slotClasses, true);
  }

  /** Build the echo input buffer for the current tick from recordings. */
  private fillEchoInputs(): void {
    this.echoBuf.clear();
    const t = this.state.tick;
    for (let slot = 0; slot < this.level.slotCount; slot++) {
      if (slot === this.recordingSlot) continue;
      const rec = this.recordings[slot];
      if (!rec) continue;
      const frame = t < rec.frames.length ? (rec.frames[t] as InputFrame) : emptyInput();
      this.echoBuf.set(slot, frame);
    }
    setEchoInputs(this.echoBuf);
  }

  /**
   * Advance the sim one tick with the live player's input for this tick.
   * Records the input + resulting live position. Returns the (possibly updated)
   * level result.
   */
  tickWith(liveInput: InputFrame): LevelResult {
    if (this.result !== 'in_progress') return this.result;
    if (this.needsClassChoice()) return this.result;

    this.fillEchoInputs();

    // Capture the live player's pre-step position for the recording.
    const live = this.livePlayer();
    const px = live ? live.x : 0;
    const py = live ? live.y : 0;
    recordTick(this.recorder, liveInput, px, py);

    this.state = step(this.state, liveInput);

    if (this.state.outcome === 'won') {
      this.finishLoop(true);
    } else if (this.state.outcome === 'timeout' || this.state.tick >= this.level.loopLength) {
      this.finishLoop(false);
    }
    return this.result;
  }

  private livePlayer() {
    return this.state.units.find((u) => u.kind === 'player');
  }

  private finishLoop(won: boolean): void {
    // Finalize this slot's recording.
    this.recordings[this.recordingSlot] = finalizeRecording(this.recorder);

    if (won) {
      this.result = 'won';
      this.wonOnSlot = this.recordingSlot;
      return;
    }

    // Move to the next slot; if we ran out of slots without a win, fail.
    if (this.recordingSlot + 1 >= this.level.slotCount) {
      this.result = 'failed';
      return;
    }
    this.recordingSlot += 1;
    // Next slot needs a class choice before its loop starts.
  }

  /** Number of player-team echoes still alive at the current tick. */
  echoesAlive(): number {
    return this.state.units.filter((u) => u.kind === 'echo' && u.alive).length;
  }

  /** Compute stars for a win (brief 3.1). Wired for the win-condition star. */
  computeStars(): Stars {
    const won = this.result === 'won';
    const echoesAlive = this.echoesAlive();
    // Early victory: won before the final slot.
    const earlyVictory = won && this.wonOnSlot >= 0 && this.wonOnSlot < this.level.slotCount - 1;
    let count = 0;
    if (won) count += 1; // ★ win
    if (won && echoesAlive >= this.level.starEchoesAlive) count += 1; // ★ K echoes alive
    if (won && earlyVictory) count += 1; // ★ early victory (rewrite-count star lands M2)
    return { won, echoesAlive, earlyVictory, count };
  }
}
