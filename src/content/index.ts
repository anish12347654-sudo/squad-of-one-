/**
 * Public surface of the content layer: typed data + pattern scripts built on
 * the frozen sim API. Render/UI layers import levels and class presentation
 * from here.
 */

export * from './classes.js';
export * from './campaign.js';
export * from './worlds.js';
export { ARENA_01 } from './levels/arena-01.js';
export { ARENA_02 } from './levels/arena-02.js';
export { INVARIANCE_ARENA } from './levels/invariance-arena.js';
export { CAMPAIGN_LEVELS, CAMPAIGN_LEVEL_IDS, campaignLevelById } from './levels/campaign-levels.js';
