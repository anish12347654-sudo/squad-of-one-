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
import { decodeForThisBuild, playbackFrom, REPLAY_HASH_PREFIX } from './game/replay-link.js';
import { campaignLevelById } from './content/index.js';
import { installShareDevHook } from './ui/share-dev-hook.js';
import { installReplayDevHook } from './game/replay-dev-hook.js';

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
installShareDevHook(game);
installReplayDevHook();

// `/#r=<code>` deep link (brief 6.4): decode a shared replay and play it back
// deterministically. A version/content mismatch shows the localized message in
// the ReplaysScene rather than desyncing silently.
function parseReplayHash(): string | null {
  const hash = window.location.hash.replace(/^#/, '');
  if (hash.startsWith(REPLAY_HASH_PREFIX)) return decodeURIComponent(hash.slice(REPLAY_HASH_PREFIX.length));
  return null;
}

const replayCode = parseReplayHash();

// Dev/e2e deep links: jump to a scene once the game is ready.
const sceneParam = params.get('scene');
const levelParam = params.get('level');

game.events.once('ready', () => {
  if (replayCode) {
    game.scene.stop('ui-fte');
    game.scene.stop('ui-title');
    const res = decodeForThisBuild(replayCode);
    if (res.ok && campaignLevelById(res.payload.levelId)) {
      const playback = playbackFrom(res);
      game.scene.start('GameScene', { levelId: playback.levelId, from: 'hash', replay: playback });
    } else {
      // Mismatch or garbage: route to the Replays screen which shows the clear
      // localized message (never a silent desync).
      game.scene.start('ui-replays');
    }
    return;
  }
  if (sceneParam || levelParam) {
    game.scene.stop('ui-fte');
    game.scene.stop('ui-title');
    if (sceneParam === 'game') game.scene.start('GameScene');
    else if (levelParam) game.scene.start('ui-levelintro', { levelId: levelParam });
  }
});
