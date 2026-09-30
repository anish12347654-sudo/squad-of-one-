/**
 * Boss pattern-script primitives (brief sections 5/8).
 *
 * FROZEN AT M1. A boss is a deterministic list of pattern steps that the sim
 * cycles through. Each step describes one telegraphed attack aimed at the
 * current threat target. Content (src/content) authors these as pure data.
 * The sim advances a cursor and spawns the corresponding BossAttack.
 *
 * All durations are ticks; distances/units are world units; angles are brads.
 */

export type BossAttackShape = 'slam' | 'cone' | 'charge';

export interface BossPatternStep {
  shape: BossAttackShape;
  /** Windup/telegraph duration in ticks before the hit lands. */
  telegraphTicks: number;
  /** How long the active damaging phase lasts (ticks). */
  activeTicks: number;
  /** Cooldown (ticks) after this step before the next begins. */
  recoveryTicks: number;
  /** slam radius / charge length / cone reach in units. */
  radius: number;
  /** cone half-arc in brads (ignored by slam). */
  halfArc: number;
  /** Damage on hit. */
  damage: number;
  /**
   * Only fire this step at/under this HP fraction (phase gating). Steps whose
   * gate is not met are skipped. 1 = always available. Use to introduce
   * phase-2 attacks past the threshold.
   */
  maxHpFraction: number;
}
