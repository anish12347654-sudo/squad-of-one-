/**
 * Calibration probe (dev tool, not shipped): for each slot count, binary-search
 * the highest boss HP that ALL_BOTS can still defeat with the unlock-ramp plan.
 * That ceiling guides campaign boss-HP tuning (set HP below the ceiling for a
 * comfortable >= 1-star win, and near it for a tense final-loop finish).
 * Run: tsx scripts/calibrate.ts
 */

import { LevelRunner, emptyInput } from '../src/sim/index.js';
import type { ClassId, InputFrame, LevelDef, BossPatternStep } from '../src/sim/index.js';
import { ALL_BOTS } from '../src/content/bots.js';

const SECOND = 60;
const PATTERN: BossPatternStep[] = [
  { shape: 'slam', telegraphTicks: 54, activeTicks: 6, recoveryTicks: 48, radius: 130, halfArc: 0, damage: 20, maxHpFraction: 1 },
  { shape: 'cone', telegraphTicks: 48, activeTicks: 6, recoveryTicks: 42, radius: 260, halfArc: 640, damage: 18, maxHpFraction: 1 },
  { shape: 'charge', telegraphTicks: 42, activeTicks: 8, recoveryTicks: 54, radius: 600, halfArc: 60, damage: 24, maxHpFraction: 0.5 },
];

const XS = [-300, -180, -60, 60, 180, 300, 0];
function spawns(n: number) {
  const out = [];
  for (let i = 0; i < n; i++) out.push({ x: XS[i]!, y: i === n - 1 ? 240 : 300, facing: 3072 });
  return out;
}

function template(slotCount: number, maxHp: number): LevelDef {
  return {
    id: `calib-${slotCount}`,
    halfWidth: 520, halfHeight: 520, loopLength: 20 * SECOND, slotCount,
    spawns: spawns(slotCount),
    boss: { x: 0, y: -240, maxHp, radius: 46, speed: 90, phaseThreshold: 0.5, pattern: PATTERN },
    starEchoesAlive: 1,
  };
}

function planFor(slotCount: number): ClassId[] {
  const base: ClassId[] = ['guardian', 'ranger', 'rogue', 'pyromancer', 'engineer', 'medic'];
  const p: ClassId[] = [];
  const useAvatar = slotCount >= 5;
  const fighters = useAvatar ? slotCount - 1 : slotCount;
  for (let i = 0; i < fighters; i++) p.push(base[i % base.length]!);
  // Ensure uniqueness by using distinct classes first.
  const uniq: ClassId[] = [];
  for (const c of base) if (uniq.length < fighters) uniq.push(c);
  while (uniq.length < fighters) uniq.push('ranger');
  const plan = uniq.slice(0, fighters);
  if (useAvatar) plan.push('avatar');
  return plan;
}

function wins(slotCount: number, maxHp: number): { won: boolean; stars: number } {
  const level = template(slotCount, maxHp);
  const runner = new LevelRunner(level);
  const plan = planFor(slotCount);
  let pi = 0;
  const maxTicks = slotCount * (level.loopLength + 2);
  let ticks = 0;
  while (runner.result === 'in_progress' && ticks < maxTicks) {
    if (runner.needsClassChoice()) {
      runner.chooseClass(plan[pi++] ?? 'ranger');
      continue;
    }
    const slot = runner.recordingSlot;
    const cls = runner.slotClasses[slot] as ClassId;
    const bot = ALL_BOTS[cls];
    const input: InputFrame = bot ? bot(runner.state, slot, runner.state.tick) : emptyInput();
    runner.tickWith(input);
    ticks++;
  }
  return { won: runner.result === 'won', stars: runner.computeStars().count };
}

for (let slotCount = 2; slotCount <= 7; slotCount++) {
  let lo = 100, hi = 40000, best = 0;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (wins(slotCount, mid).won) { best = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  console.log(`slots=${slotCount} plan=${planFor(slotCount).join(',')} maxBeatableHp=${best}`);
}
