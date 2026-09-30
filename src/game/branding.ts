/**
 * Single source of truth for player-facing branding.
 *
 * The title is a placeholder for M0 and is referenced everywhere (title scene,
 * document title, PWA manifest later) so it can be renamed in exactly one place.
 */
export const BRANDING = {
  /** Working title. Placeholder until final naming. */
  title: 'SQUAD OF ONE',
  /** One-line tagline for the title screen. */
  tagline: 'Every hero on your team is you.',
} as const;
