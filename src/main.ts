/**
 * Application entry point. Boots the Phaser 4 title canvas.
 */

import { createGame } from './game/create-game.js';
import { BRANDING } from './game/branding.js';

document.title = BRANDING.title;

const root = document.getElementById('app');
if (!root) {
  throw new Error('Missing #app root element');
}

createGame(root);
