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
  setEchoRecordings,
  setBossPattern,
  type EchoRecordingMeta,
} from './sim.js';
import {
  createRecorder,
  finalizeRecording,
  recordTick,
  recordAnchor,
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
  /** Rewrites used (a low count feeds the third star). */
  rewritesUsed: number;
  /** Total star count [0..3]. */
  count: number;
}

/** Time Shards granted per level (contract 3.5): 1 shard = 1 rewrite. */
export const TIME_SHARDS_PER_LEVEL = 3;

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

  /** Time Shards remaining (contract 3.5). 1 shard = 1 rewrite. */
  shards = TIME_SHARDS_PER_LEVEL;
  /** Rewrites used so far this level (feeds the star rating). */
  rewritesUsed = 0;
  /** True while re-recording an already-recorded slot (a rewrite in progress). */
  rewriting = false;
  /** The slot to resume recording after a rewrite loop finishes (-1 = none). */
  private resumeSlot = -1;

  private recorder = createRecorder('guardian');
  private echoBuf: Map<number, InputFrame> = new Map();
  private echoRecMeta: Map<number, EchoRecordingMeta> = new Map();

  constructor(level: LevelDef) {
    this.level = level;
    this.slotClasses = new Array(level.slotCount).fill(null);
    this.recordings = new Array(level.slotCount).fill(null);
    setBossPattern(level.boss.pattern);
    this.state = createLevelState(level, this.recordingSlot, this.slotClasses, false);
  }

  /** Is this level's last slot? (Avatar must be the last slot when used.) */
  isLastSlot(slot: number): boolean {
    return slot === this.level.slotCount - 1;
  }

  /**
   * Whether `classId` may be chosen for `slot` right now: unused this level, and
   * the Avatar only in the last slot (and last slot only accepts Avatar when the
   * level has 5+ slots, per section 4). For <5-slot levels the Avatar is simply
   * an optional last-slot pick.
   */
  canChoose(classId: ClassId, slot: number): boolean {
    if (this.usedClasses().includes(classId)) return false;
    if (classId === 'avatar' && !this.isLastSlot(slot)) return false;
    if (this.level.slotCount >= 5 && this.isLastSlot(slot) && classId !== 'avatar') return false;
    return true;
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
    if (!this.canChoose(classId, this.recordingSlot)) {
      throw new Error(`class ${classId} cannot be chosen for slot ${this.recordingSlot}`);
    }
    this.slotClasses[this.recordingSlot] = classId;
    this.recorder = createRecorder(classId);
    setBossPattern(this.level.boss.pattern);
    this.state = createLevelState(this.level, this.recordingSlot, this.slotClasses, true);
    this.refreshEchoRecMeta();
  }

  /** Build the echo input buffer + recording metadata for the current tick. */
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
    setEchoRecordings(this.echoRecMeta);
  }

  /** Refresh the per-slot recording metadata used by paradox detection. */
  private refreshEchoRecMeta(): void {
    this.echoRecMeta.clear();
    for (let slot = 0; slot < this.level.slotCount; slot++) {
      if (slot === this.recordingSlot) continue;
      const rec = this.recordings[slot];
      if (!rec) continue;
      this.echoRecMeta.set(slot, {
        positions: rec.positions,
        anchors: rec.anchors,
        length: rec.length,
      });
    }
    setEchoRecordings(this.echoRecMeta);
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

    // Snapshot which interactables the live player already owns, to detect a
    // fresh pickup/flip during this tick and record it as a paradox anchor.
    const liveSlot = this.recordingSlot;
    const ownedBefore = new Set(
      this.state.interactables.filter((i) => i.takenBySlot === liveSlot && i.taken).map((i) => i.defIndex),
    );

    this.state = step(this.state, liveInput);

    // Record any interactable the live player took/flipped this tick.
    for (const it of this.state.interactables) {
      if (it.takenBySlot === liveSlot && it.takenAtTick === this.state.tick - 1) {
        if (!ownedBefore.has(it.defIndex)) {
          recordAnchor(this.recorder, it.defIndex, this.state.tick - 1);
        }
      }
    }

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
    const wasRewrite = this.rewriting;
    const resume = this.resumeSlot;
    this.rewriting = false;
    this.resumeSlot = -1;

    if (won) {
      this.result = 'won';
      this.wonOnSlot = this.recordingSlot;
      return;
    }

    // If this was a rewrite that interrupted an un-recorded slot's turn, go back
    // to that slot so it still gets recorded.
    if (wasRewrite && resume >= 0 && this.recordings[resume] === null) {
      this.recordingSlot = resume;
      return;
    }

    // Advance to the next unrecorded slot if one remains.
    if (this.recordingSlot + 1 < this.level.slotCount && this.recordings[this.recordingSlot + 1] === null) {
      this.recordingSlot += 1;
      // Next slot needs a class choice before its loop starts.
      return;
    }
    // Find any remaining unrecorded slot.
    for (let s = 0; s < this.level.slotCount; s++) {
      if (this.slotClasses[s] === null || this.recordings[s] === null) {
        if (this.slotClasses[s] === null) {
          this.recordingSlot = s;
          return;
        }
      }
    }

    // All slots recorded without a win. The player may rewrite (if shards
    // remain) or restart; the level is not marked failed until they run out of
    // options. We surface this via `awaitingDecision()` for the game layer.
    if (this.shards <= 0) {
      this.result = 'failed';
    }
    // else: stay in_progress, awaiting a rewrite decision (or restart).
  }

  /**
   * True when every slot is recorded, the boss is not dead, and the player must
   * decide: rewrite a slot (if shards remain) or restart. Contract 3.5.
   */
  awaitingDecision(): boolean {
    return (
      this.result === 'in_progress' &&
      !this.needsClassChoice() &&
      this.allSlotsRecorded() &&
      this.state.outcome !== 'running'
    );
  }

  private allSlotsRecorded(): boolean {
    for (let s = 0; s < this.level.slotCount; s++) {
      if (this.slotClasses[s] !== null && this.recordings[s] === null) return false;
      if (this.slotClasses[s] === null) return false;
    }
    return true;
  }

  /** Count of slots that already have a finalized recording. */
  private recordedCount(): number {
    let n = 0;
    for (let s = 0; s < this.level.slotCount; s++) if (this.recordings[s] !== null) n += 1;
    return n;
  }

  /**
   * True when a rewrite is currently allowed: shards remain, at least one slot
   * is recorded, and the runner is between loops (awaiting a class pick or a
   * decision) rather than mid-recording. Contract 3.5 ("after any loop the
   * player may re-record any existing slot").
   */
  canRewrite(): boolean {
    if (this.result !== 'in_progress' || this.shards <= 0) return false;
    if (this.recordedCount() < 1) return false;
    return this.needsClassChoice() || this.awaitingDecision();
  }

  /**
   * Rewrite (re-record) an existing slot (contract 3.5). Consumes one Time
   * Shard. The other slots keep their recordings and replay in the changed
   * world (they may now die or paradox). If `newClassId` is given, the slot
   * changes class (must still be unique / Avatar rules). Then the loop restarts
   * with this slot live and awaits nothing else - the runner is ready to tick.
   */
  rewriteSlot(slot: number, newClassId?: ClassId): void {
    if (!this.canRewrite()) throw new Error('no rewrite available');
    if (slot < 0 || slot >= this.level.slotCount) throw new Error('bad slot');
    this.shards -= 1;
    this.rewritesUsed += 1;
    // Remember an un-recorded slot we should return to after this rewrite loop.
    this.resumeSlot = this.needsClassChoice() ? this.recordingSlot : -1;
    this.recordingSlot = slot;
    this.rewriting = true;

    if (newClassId && newClassId !== this.slotClasses[slot]) {
      // Temporarily clear this slot so the uniqueness check ignores its old class.
      const old = this.slotClasses[slot] ?? null;
      this.slotClasses[slot] = null;
      if (!this.canChoose(newClassId, slot)) {
        this.slotClasses[slot] = old;
        throw new Error(`class ${newClassId} cannot be chosen for slot ${slot}`);
      }
      this.slotClasses[slot] = newClassId;
    }

    // The slot being rewritten is recorded fresh; drop its old recording.
    this.recordings[slot] = null;
    const cls = this.slotClasses[slot] as ClassId;
    this.recorder = createRecorder(cls);
    setBossPattern(this.level.boss.pattern);
    this.state = createLevelState(this.level, this.recordingSlot, this.slotClasses, true);
    this.refreshEchoRecMeta();
  }

  /**
   * Number of alive, non-paradox echoes at the current tick. Paradox echoes do
   * NOT count as alive for stars or the Avatar (contract 3.4).
   */
  echoesAlive(): number {
    return this.state.units.filter((u) => u.kind === 'echo' && u.alive && !u.paradox).length;
  }

  /**
   * Compute stars (brief 3.1 + contract 3.5). Three stars:
   *   1. Win.
   *   2. K echoes alive at the win (level.starEchoesAlive).
   *   3. Efficiency: win with <= 1 rewrite OR an early victory (before the last
   *      slot). Rewrites feed this star.
   */
  computeStars(): Stars {
    const won = this.result === 'won';
    const echoesAlive = this.echoesAlive();
    const earlyVictory = won && this.wonOnSlot >= 0 && this.wonOnSlot < this.level.slotCount - 1;
    const efficient = won && (this.rewritesUsed <= 1 || earlyVictory);
    let count = 0;
    if (won) count += 1; // ★ win
    if (won && echoesAlive >= this.level.starEchoesAlive) count += 1; // ★ K echoes alive
    if (efficient) count += 1; // ★ efficiency (rewrites/early)
    return { won, echoesAlive, earlyVictory, rewritesUsed: this.rewritesUsed, count };
  }
}
