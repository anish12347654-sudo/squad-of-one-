/**
 * Presentation-facing class metadata (M1 subset).
 *
 * This is the ONLY class data the render/UI layers read: display name, colour,
 * silhouette shape, a one-line picker blurb and a sound key. The sim's own
 * numeric stats live in src/sim/classes.ts and are never duplicated here.
 *
 * This module may depend on the sim's public API (types) only.
 */

import type { ClassId } from '@sim/index.js';

/** A simple silhouette hint the renderer turns into a distinct shape. */
export type Silhouette =
  | 'shield'
  | 'cross'
  | 'arrow'
  | 'flame'
  | 'dagger'
  | 'gear'
  | 'diamond';

export interface ClassPresentation {
  id: ClassId;
  name: string;
  role: string;
  /** One-line description shown in the class picker. */
  blurb: string;
  /** Primary colour (0xRRGGBB) used for the unit + slot theming. */
  color: number;
  silhouette: Silhouette;
  /** Logical sound key (the audio layer maps these to real assets later). */
  sound: string;
}

export const CLASS_PRESENTATION: Record<ClassId, ClassPresentation> = {
  guardian: {
    id: 'guardian',
    name: 'Guardian',
    role: 'Tank',
    blurb: 'Soaks hits and taunts. Bash up close; hold the line.',
    color: 0x4fc3f7,
    silhouette: 'shield',
    sound: 'sfx/guardian-bash',
  },
  medic: {
    id: 'medic',
    name: 'Medic',
    role: 'Healer',
    blurb: 'Beams the wounded and shields the squad with Sanctuary.',
    color: 0x81c784,
    silhouette: 'cross',
    sound: 'sfx/medic-beam',
  },
  ranger: {
    id: 'ranger',
    name: 'Ranger',
    role: 'DPS',
    blurb: 'Rapid arrows at range; charge a piercing line for burst.',
    color: 0xffb74d,
    silhouette: 'arrow',
    sound: 'sfx/ranger-shot',
  },
  pyromancer: {
    id: 'pyromancer',
    name: 'Pyromancer',
    role: 'AoE DPS',
    blurb: 'Lobs fire orbs and drops a screen-shaking Meteor.',
    color: 0xff7043,
    silhouette: 'flame',
    sound: 'sfx/pyro-orb',
  },
  rogue: {
    id: 'rogue',
    name: 'Rogue',
    role: 'Burst',
    blurb: 'Twin slashes, double from behind; Shadow Step to safety.',
    color: 0xba68c8,
    silhouette: 'dagger',
    sound: 'sfx/rogue-slash',
  },
  engineer: {
    id: 'engineer',
    name: 'Engineer',
    role: 'Utility',
    blurb: 'Rapid bolts and a deployable turret that holds ground.',
    color: 0xffd54f,
    silhouette: 'gear',
    sound: 'sfx/engineer-bolt',
  },
  avatar: {
    id: 'avatar',
    name: 'Avatar',
    role: 'Finisher',
    blurb: 'All-rounder that grows with your squad. Ends it with Convergence.',
    color: 0xffffff,
    silhouette: 'diamond',
    sound: 'sfx/avatar-blade',
  },
};

/** Slot accent colours (index = slot) used when a slot has no class yet. */
export const SLOT_COLORS: readonly number[] = [
  0x4fc3f7, 0x81c784, 0xffb74d, 0xff7043, 0xba68c8, 0xffd54f, 0xffffff,
];
