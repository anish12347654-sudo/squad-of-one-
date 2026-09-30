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
import { installParityDevHook } from './game/parity-dev-hook.js';
import {
  registerServiceWorker,
  blockZoomAndScroll,
  playablesFirstFrameReady,
  playablesGameReady,
} from './platform/index.js';

document.title = BRANDING.title;

// Installable offline PWA + input hardening (brief 9.6). Both are no-ops on the
// dev server / where unsupported, and neither makes a play-time network call.
registerServiceWorker();
blockZoomAndScroll();

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

// Dev/e2e-only automation hooks (brief 9.2). Gated on the compile-time define
// `__DEV_TOOLS__` (a literal `false` in the release build) so Rollup dead-code-
// eliminates the whole branch AND its imports - verified absent by
// scripts/check-prod-bundle.ts.
if (__DEV_TOOLS__) {
  installShareDevHook(game);
  installReplayDevHook();
  installParityDevHook();
}

// YouTube Playables lifecycle (brief 9.7). No-ops unless the Playables build
// flag is on AND we are inside the Playables host; never an external call.
game.events.once('ready', () => {
  playablesFirstFrameReady();
  playablesGameReady();
});

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
