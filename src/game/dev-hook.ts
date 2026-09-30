/**
 * Dev-only hook that feeds tick-exact InputFrames through the normal input
 * pipeline (brief section 10, E2E). Exposed on window.__SQUAD so Playwright and
 * scripted tools can drive the slice deterministically without synthesising
 * real pointer/keyboard events.
 *
 * This lives in src/game (impure) and touches window, which is fine here - it
 * is NOT part of the pure sim. The frames it injects go through exactly the
 * same code path as live input (the scene's frameForTick), so replays are
 * bit-identical to a hand-played run.
 */

import type { InputFrame, ClassId } from '@sim/index.js';

export interface DevHookApi {
  dispose(): void;
}

/** The scene shape the hook needs. Kept minimal to avoid a circular type. */
interface HookableScene {
  pickClass(id: ClassId): void;
  restart(): void;
  fastForward(maxTicks: number): void;
  skipPlanning(): void;
  doRewrite(slot: number, newClass?: ClassId): void;
  driveWithBots(shardSlots?: Record<number, number>): void;
  getPhase(): string;
  getParadoxCount(): number;
  getRunner(): {
    result: string;
    recordingSlot: number;
    shards: number;
    rewritesUsed: number;
    needsClassChoice(): boolean;
    awaitingDecision(): boolean;
    canRewrite(): boolean;
    slotClasses: (ClassId | null)[];
    state: { tick: number; units: { kind: string; classId: ClassId | null; hp: number; alive: boolean; slot: number; paradox: boolean }[] };
    computeStars(): { count: number; echoesAlive: number; earlyVictory: boolean; rewritesUsed: number; won: boolean };
  };
  getInput(): { setScriptedSource(s: ((tick: number) => InputFrame) | null): void };
}

/** The global surface installed for automation. */
export interface SquadDevGlobal {
  /** Pick the class for the current recording slot. */
  pickClass(id: ClassId): void;
  /** Install a tick-exact scripted input source for the LIVE player. */
  setScriptedInput(source: ((tick: number) => InputFrame) | null): void;
  /** Clear any scripted input source. */
  clearScriptedInput(): void;
  /** Restart the level. */
  restart(): void;
  /** Current phase: 'pick' | 'playing' | 'result'. */
  phase(): string;
  /** Whether the runner is waiting for a class pick. */
  needsClassChoice(): boolean;
  /** Current recording slot. */
  recordingSlot(): number;
  /** Current sim tick. */
  tick(): number;
  /** Boss HP (or -1 if none). */
  bossHp(): number;
  /** Overall level result. */
  result(): string;
  /** Star breakdown once resolved. */
  stars(): { count: number; echoesAlive: number; earlyVictory: boolean; rewritesUsed: number; won: boolean };
  /** Number of alive echoes right now. */
  echoesAlive(): number;
  /**
   * Advance the current loop by up to `maxTicks` ticks immediately (no wall
   * clock), feeding the scripted input source. Stops early if the loop ends or
   * a class choice is needed. Deterministic; used by e2e to fast-forward.
   */
  fastForward(maxTicks: number): void;
  /** Skip the planning phase / countdown immediately (dev/e2e). */
  skipPlanning(): void;
  /** Rewrite (re-record) a slot, optionally with a new class (dev/e2e). */
  rewriteSlot(slot: number, newClass?: ClassId): void;
  /** Whether the runner is awaiting a rewrite/restart decision. */
  awaitingDecision(): boolean;
  /** Whether a rewrite is currently available. */
  canRewrite(): boolean;
  /** Time Shards remaining. */
  shards(): number;
  /** Number of paradox events raised so far this loop. */
  paradoxCount(): number;
  /** Install a state-aware bot driver for the live player (dev/e2e). */
  driveWithBots(shardSlots?: Record<number, number>): void;
}

declare global {
  interface Window {
    __SQUAD?: SquadDevGlobal;
  }
}

export function installDevHook(scene: HookableScene): DevHookApi {
  const api: SquadDevGlobal = {
    pickClass: (id) => scene.pickClass(id),
    setScriptedInput: (source) => scene.getInput().setScriptedSource(source),
    clearScriptedInput: () => scene.getInput().setScriptedSource(null),
    restart: () => scene.restart(),
    phase: () => scene.getPhase(),
    needsClassChoice: () => scene.getRunner().needsClassChoice(),
    recordingSlot: () => scene.getRunner().recordingSlot,
    tick: () => scene.getRunner().state.tick,
    bossHp: () => {
      const boss = scene.getRunner().state.units.find((u) => u.kind === 'boss');
      return boss ? boss.hp : -1;
    },
    result: () => scene.getRunner().result,
    stars: () => scene.getRunner().computeStars(),
    echoesAlive: () => scene.getRunner().computeStars().echoesAlive,
    fastForward: (maxTicks) => scene.fastForward(maxTicks),
    skipPlanning: () => scene.skipPlanning(),
    rewriteSlot: (slot, newClass) => scene.doRewrite(slot, newClass),
    awaitingDecision: () => scene.getRunner().awaitingDecision(),
    canRewrite: () => scene.getRunner().canRewrite(),
    shards: () => scene.getRunner().shards,
    paradoxCount: () => scene.getParadoxCount(),
    driveWithBots: (shardSlots) => scene.driveWithBots(shardSlots),
  };

  if (typeof window !== 'undefined') {
    window.__SQUAD = api;
  }

  return {
    dispose(): void {
      if (typeof window !== 'undefined' && window.__SQUAD === api) {
        delete window.__SQUAD;
      }
    },
  };
}
