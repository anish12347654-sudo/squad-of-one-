/**
 * Dev-only replay hook (brief section 10, e2e). Builds a shareable replay code
 * for a level headlessly by driving a pure LevelRunner with the reference bots,
 * so Playwright can obtain a real `/#r=` code without depending on the
 * GameScene lifecycle. Impure only in that it touches window; the run itself is
 * pure + deterministic.
 */

import { LevelRunner } from '@sim/index.js';
import type { ClassId, InputFrame } from '@sim/index.js';
import { campaignLevelById } from '@content/index.js';
import { ALL_BOTS } from '@content/bots.js';
import { buildReplayCode } from './replay-link.js';

export interface SquadReplayGlobal {
  /** Build a winning replay code for `levelId` with `plan` (or null on loss). */
  buildCode(levelId: string, plan: ClassId[]): string | null;
}

declare global {
  interface Window {
    __SQUAD_REPLAY?: SquadReplayGlobal;
  }
}

function neutral(): InputFrame {
  return { moveX: 0, moveY: 0, aim: 0, aimActive: false, buttons: 0 };
}

/** Drive a LevelRunner to a resolution with the reference bots. */
function play(levelId: string, plan: ClassId[]): LevelRunner | null {
  const lvl = campaignLevelById(levelId);
  if (!lvl) return null;
  const runner = new LevelRunner(lvl.def);
  let planIndex = 0;
  let guard = 0;
  const maxTicks = lvl.def.slotCount * (lvl.def.loopLength + 4);
  while (runner.result === 'in_progress' && guard < maxTicks) {
    guard++;
    if (runner.needsClassChoice()) {
      const cls = plan[planIndex++] ?? plan[plan.length - 1];
      if (!cls) break;
      runner.chooseClass(cls);
      continue;
    }
    if (runner.awaitingDecision()) break;
    const slot = runner.recordingSlot;
    const cls = runner.slotClasses[slot];
    const bot = cls ? ALL_BOTS[cls] : undefined;
    const frame = bot ? bot(runner.state, slot, runner.state.tick) : neutral();
    runner.tickWith(frame);
  }
  return runner;
}

export function installReplayDevHook(): void {
  if (typeof window === 'undefined') return;
  window.__SQUAD_REPLAY = {
    buildCode(levelId, plan): string | null {
      const runner = play(levelId, plan);
      if (!runner || runner.result !== 'won') return null;
      try {
        return buildReplayCode(runner);
      } catch {
        return null;
      }
    },
  };
}
