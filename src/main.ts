/**
 * Application entry point. Boots the Phaser 4 game (FTE on first launch, else
 * the title menu). Supports dev/e2e query params:
 *   ?skipIntro=1     - mark the first-time experience as seen (boot to title)
 *   ?scene=game      - boot straight into the core GameScene (showcase level)
 *   ?level=<id>      - open the LevelIntro for a campaign level id
 */

import { createGame } from './game/create-game.js';
import { BRANDING } from './game/branding.js';
import { getSave, updateSave } from './ui/save-context.js';

document.title = BRANDING.title;

const root = document.getElementById('app');
if (!root) {
  throw new Error('Missing #app root element');
}

const params = new URLSearchParams(window.location.search);
if (params.get('skipIntro') === '1' && !getSave().seenIntro) {
  updateSave((s) => ({ ...s, seenIntro: true }));
}
// Force-replay the first-time experience (dev/e2e screenshots).
if (params.get('fte') === '1' && getSave().seenIntro) {
  updateSave((s) => ({ ...s, seenIntro: false }));
}

const game = createGame(root);

// Dev/e2e deep links: jump to a scene once the game is ready.
const sceneParam = params.get('scene');
const levelParam = params.get('level');
if (sceneParam || levelParam) {
  game.events.once('ready', () => {
    // Stop the auto-started boot scenes before deep-linking.
    game.scene.stop('ui-fte');
    game.scene.stop('ui-title');
    if (sceneParam === 'game') game.scene.start('GameScene');
    else if (levelParam) game.scene.start('ui-levelintro', { levelId: levelParam });
  });
}
