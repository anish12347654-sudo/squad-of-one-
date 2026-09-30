/**
 * Campaign progression + unlock-gate tests (brief sections 5 + 6.1).
 */

import { describe, it, expect } from 'vitest';
import { freshSave, recordLevelResult, levelReward, type SaveGame } from '@meta/index.js';
import {
  levelStatuses,
  unlockedClasses,
  totalStars,
  maxStars,
  nextLevelId,
  campaignComplete,
  isLevelUnlocked,
} from '@meta/index.js';
import { CAMPAIGN_LEVELS } from '@content/index.js';

function clear(save: SaveGame, id: string, stars = 3): SaveGame {
  return recordLevelResult(save, id, stars, false, levelReward(stars as 3, true), 'guardian');
}

describe('level unlock gates', () => {
  it('only the first level is unlocked on a fresh save', () => {
    const statuses = levelStatuses(freshSave(), CAMPAIGN_LEVELS);
    expect(statuses[0]?.unlocked).toBe(true);
    expect(statuses[1]?.unlocked).toBe(false);
    expect(statuses.filter((s) => s.unlocked).length).toBe(1);
  });

  it('clearing a level unlocks the next', () => {
    let save = freshSave();
    save = clear(save, CAMPAIGN_LEVELS[0]!.id);
    expect(isLevelUnlocked(save, CAMPAIGN_LEVELS, CAMPAIGN_LEVELS[1]!.id)).toBe(true);
    // The one after next is still locked.
    expect(isLevelUnlocked(save, CAMPAIGN_LEVELS, CAMPAIGN_LEVELS[2]!.id)).toBe(false);
  });

  it('there are exactly 19 campaign levels', () => {
    expect(CAMPAIGN_LEVELS.length).toBe(19);
  });
});

describe('class unlock ramp', () => {
  it('fresh save has only Ranger + Guardian', () => {
    const classes = unlockedClasses(freshSave(), CAMPAIGN_LEVELS);
    expect(classes.has('guardian')).toBe(true);
    expect(classes.has('ranger')).toBe(true);
    expect(classes.has('medic')).toBe(false);
    expect(classes.has('avatar')).toBe(false);
    expect(classes.size).toBe(2);
  });

  it('progressing unlocks Medic, Rogue, Avatar, Pyromancer, Engineer in ramp order', () => {
    let save = freshSave();
    // Clear through the tutorial to reach the Rogue unlock (tut-3 grants rogue).
    for (const id of ['tut-1', 'tut-2']) save = clear(save, id);
    let classes = unlockedClasses(save, CAMPAIGN_LEVELS);
    // tut-2 grants medic; reaching tut-3 (unlocked now) grants rogue.
    expect(classes.has('medic')).toBe(true);
    expect(classes.has('rogue')).toBe(true); // tut-3 is unlocked (its unlock counts)
    expect(classes.has('avatar')).toBe(false);

    // Clear everything: all seven classes available.
    save = freshSave();
    for (const lvl of CAMPAIGN_LEVELS) save = clear(save, lvl.id);
    classes = unlockedClasses(save, CAMPAIGN_LEVELS);
    for (const c of ['guardian', 'ranger', 'medic', 'rogue', 'avatar', 'pyromancer', 'engineer'] as const) {
      expect(classes.has(c), c).toBe(true);
    }
  });
});

describe('star totals + continue + completion', () => {
  it('sums best stars and caps at 3 per level', () => {
    let save = freshSave();
    save = clear(save, 'tut-1', 3);
    save = clear(save, 'tut-1', 1); // does not lower best
    expect(totalStars(save, CAMPAIGN_LEVELS)).toBe(3);
    expect(maxStars(CAMPAIGN_LEVELS)).toBe(19 * 3);
  });

  it('nextLevelId returns the first unlocked-uncleared level', () => {
    let save = freshSave();
    expect(nextLevelId(save, CAMPAIGN_LEVELS)).toBe(CAMPAIGN_LEVELS[0]!.id);
    save = clear(save, CAMPAIGN_LEVELS[0]!.id);
    expect(nextLevelId(save, CAMPAIGN_LEVELS)).toBe(CAMPAIGN_LEVELS[1]!.id);
  });

  it('campaignComplete only when the final level is cleared', () => {
    let save = freshSave();
    expect(campaignComplete(save, CAMPAIGN_LEVELS)).toBe(false);
    for (const lvl of CAMPAIGN_LEVELS) save = clear(save, lvl.id);
    expect(campaignComplete(save, CAMPAIGN_LEVELS)).toBe(true);
  });
});
