/**
 * World themes for the campaign (brief section 5: each world has its own
 * palette, hazards, musical scale and boss intro title card).
 */

import type { WorldTheme } from './campaign.js';

export const WORLD_TUTORIAL: WorldTheme = {
  id: 'tutorial',
  nameKey: 'world.tutorial',
  palette: { bg: 0x0b0f1a, floor: 0x141a2b, accent: 0x64b5ff, hazard: 0x5a6b8c },
  hazard: 'none',
  musicalScale: [0, 2, 4, 7, 9], // major pentatonic (calm, teaching)
  bossIntroKey: 'story.tutorial.1.a',
};

export const WORLD_1: WorldTheme = {
  id: 'world1',
  nameKey: 'world.1',
  palette: { bg: 0x1a1206, floor: 0x2a1e0c, accent: 0xffb74d, hazard: 0xd98c2b },
  hazard: 'gears',
  musicalScale: [0, 2, 3, 5, 7, 8, 10], // natural minor (tense clockwork)
  bossIntroKey: 'story.world1.a',
};

export const WORLD_2: WorldTheme = {
  id: 'world2',
  nameKey: 'world.2',
  palette: { bg: 0x1a0a1e, floor: 0x2c0f33, accent: 0xff4fd8, hazard: 0xe0b030 },
  hazard: 'sandstorm',
  musicalScale: [0, 1, 4, 5, 7, 8, 11], // double-harmonic (exotic bazaar)
  bossIntroKey: 'story.world2.a',
};

export const WORLD_3: WorldTheme = {
  id: 'world3',
  nameKey: 'world.3',
  palette: { bg: 0x061420, floor: 0x0c2233, accent: 0x8fe3ff, hazard: 0xbfe9ff },
  hazard: 'freeze',
  musicalScale: [0, 2, 3, 5, 7, 8, 11], // harmonic minor (cold, crystalline)
  bossIntroKey: 'story.world3.a',
};

export const WORLD_FINAL: WorldTheme = {
  id: 'final',
  nameKey: 'world.final',
  palette: { bg: 0x000000, floor: 0x120018, accent: 0xffffff, hazard: 0x8a2be2 },
  hazard: 'none',
  musicalScale: [0, 1, 3, 4, 6, 7, 9, 10], // octatonic (unstable, unwinding)
  bossIntroKey: 'story.final.a',
};

export const WORLDS: readonly WorldTheme[] = [
  WORLD_TUTORIAL,
  WORLD_1,
  WORLD_2,
  WORLD_3,
  WORLD_FINAL,
];

export function worldById(id: string): WorldTheme | undefined {
  return WORLDS.find((w) => w.id === id);
}
