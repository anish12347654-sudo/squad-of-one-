/**
 * Threat / aggro rules (brief section 3.3). Pure functions over BossState.
 *
 * FROZEN AT M1. Constants and targeting semantics here are part of the public
 * sim contract. Rules:
 *   - Damage adds 1 threat per point dealt.
 *   - Healing adds 0.5 threat per HP, credited to EVERY enemy in combat (in M1
 *     there is one enemy, the boss).
 *   - Taunt forces the enemy onto the taunter for TAUNT_TICKS and sets the
 *     taunter's threat to current max + TAUNT_THREAT_BONUS.
 *   - Target = highest positive threat; ties break to LOWEST slot index / id.
 *   - If nobody has positive threat, the enemy runs its untargeted idle pattern
 *     (targetId = -1).
 *   - Re-evaluate at most once per second (REEVAL_TICKS); a taunt overrides the
 *     current target instantly.
 */

import type { BossState } from './types.js';

/** Threat gained per point of damage dealt. */
export const THREAT_PER_DAMAGE = 1;
/** Threat gained per HP healed (credited to every enemy in combat). */
export const THREAT_PER_HEAL = 0.5;
/** Bonus over current max threat applied to a taunter. */
export const TAUNT_THREAT_BONUS = 100;
/** Minimum ticks between (non-taunt) target re-evaluations. */
export const REEVAL_TICKS = 60;

/** Find (or create) the threat entry for a target, keeping the array id-sorted. */
function entryFor(boss: BossState, targetId: number): { threat: number; targetId: number } {
  for (let i = 0; i < boss.threat.length; i++) {
    const e = boss.threat[i];
    if (e && e.targetId === targetId) return e;
  }
  const created = { targetId, threat: 0 };
  boss.threat.push(created);
  // Keep the table in ascending id order so iteration is total-ordered and
  // tie-breaks resolve to the lowest id deterministically.
  boss.threat.sort((a, b) => a.targetId - b.targetId);
  // Re-find after sort (the object identity is preserved).
  return entryFor(boss, targetId);
}

/** Add `amount` threat from a damage event by `targetId`. */
export function addDamageThreat(boss: BossState, targetId: number, damage: number): void {
  if (damage <= 0) return;
  entryFor(boss, targetId).threat += damage * THREAT_PER_DAMAGE;
}

/**
 * Credit healing threat. Per the rule this is credited to every enemy in
 * combat for the HEALER; we attribute it to the healing unit's threat entry so
 * the boss aggroes the pocket healer (the intended tactical pressure).
 */
export function addHealThreat(boss: BossState, healerId: number, hpHealed: number): void {
  if (hpHealed <= 0) return;
  entryFor(boss, healerId).threat += hpHealed * THREAT_PER_HEAL;
}

/** Current maximum threat value in the table (0 if empty). */
export function maxThreat(boss: BossState): number {
  let m = 0;
  for (let i = 0; i < boss.threat.length; i++) {
    const e = boss.threat[i];
    if (e && e.threat > m) m = e.threat;
  }
  return m;
}

/**
 * Apply a taunt from `taunterId`: force aggro for `ticks` and set the taunter's
 * threat to current max + TAUNT_THREAT_BONUS. Overrides targeting instantly.
 */
export function applyTaunt(boss: BossState, taunterId: number, ticks: number): void {
  const bonus = maxThreat(boss) + TAUNT_THREAT_BONUS;
  entryFor(boss, taunterId).threat = bonus;
  boss.forcedTauntTicks = ticks;
  boss.forcedTargetId = taunterId;
  boss.targetId = taunterId;
  boss.reevalCd = REEVAL_TICKS;
}

/**
 * Pick the target with the highest positive threat, breaking ties to the
 * LOWEST target id (== lowest slot, since ids and slots ascend together for
 * the player team). Returns -1 when nobody has positive threat.
 *
 * `isValid` lets the caller exclude dead units.
 */
export function pickTarget(boss: BossState, isValid: (id: number) => boolean): number {
  let bestId = -1;
  let bestThreat = 0;
  // boss.threat is kept id-ascending, so the first entry that beats the current
  // best wins ties to the lowest id automatically (strict > comparison).
  for (let i = 0; i < boss.threat.length; i++) {
    const e = boss.threat[i];
    if (!e) continue;
    if (e.threat > 0 && isValid(e.targetId) && e.threat > bestThreat) {
      bestThreat = e.threat;
      bestId = e.targetId;
    }
  }
  return bestId;
}

/**
 * Advance the boss's targeting one tick. Handles forced taunt, the <=1/s
 * re-eval cadence, and dropping targets that became invalid (died). Returns
 * the resolved target id (-1 = idle).
 */
export function updateTargeting(boss: BossState, isValid: (id: number) => boolean): number {
  if (boss.reevalCd > 0) boss.reevalCd -= 1;

  if (boss.forcedTauntTicks > 0) {
    boss.forcedTauntTicks -= 1;
    if (isValid(boss.forcedTargetId)) {
      boss.targetId = boss.forcedTargetId;
      return boss.targetId;
    }
    // Taunter died: taunt ends early, fall through to normal targeting.
    boss.forcedTauntTicks = 0;
  }

  const currentValid = boss.targetId >= 0 && isValid(boss.targetId);
  if (boss.reevalCd <= 0 || !currentValid) {
    boss.targetId = pickTarget(boss, isValid);
    boss.reevalCd = REEVAL_TICKS;
  }
  return boss.targetId;
}
