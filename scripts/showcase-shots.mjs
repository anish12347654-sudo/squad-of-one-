// One-off showcase capture: boots the built game in a real (headless) Chromium,
// walks the key screens via the dev UI hook, and writes PNGs to e2e/output/showcase.
// Starts and stops its own `vite preview` so it runs as a single foreground command.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const PORT = 4188;
const BASE = `http://localhost:${PORT}`;
const OUT = 'e2e/output/showcase';
mkdirSync(OUT, { recursive: true });

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  stdio: 'ignore',
  env: process.env,
});

async function waitForServer(url, timeoutMs = 60000) {
  const start = Date.now();
  for (;;) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      /* retry */
    }
    if (Date.now() - start > timeoutMs) throw new Error('server did not start');
    await new Promise((r) => setTimeout(r, 300));
  }
}

const shots = [];
async function shoot(page, name) {
  const path = `${OUT}/${name}.png`;
  await page.screenshot({ path });
  shots.push(path);
  console.log('captured', path);
}

async function waitScene(page, scene, timeout = 30000) {
  await page.waitForFunction((s) => window.__SQUAD_UI?.scene?.() === s, scene, { timeout });
}

async function startScene(page, key) {
  await page.evaluate((k) => window.__SQUAD_UI?.start?.(k), key).catch(() => {});
}

try {
  await waitForServer(BASE);
  const browser = await chromium.launch({
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
      '/opt/playwright/chromium-1232/chrome-linux64/chrome',
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));

  // 1) First-time experience: boot straight into gameplay (the "aha" loop).
  await page.goto(`${BASE}/`, { waitUntil: 'load' });
  await page.locator('#app canvas').waitFor({ state: 'visible', timeout: 15000 });
  await page.locator('#app canvas').click(); // unlock audio + start FTE
  await page.waitForTimeout(2500);
  await shoot(page, '01-first-time-experience');

  // Let the FTE finish and hand off to the title menu.
  await waitScene(page, 'ui-title', 45000);
  await shoot(page, '02-title');

  // 2) World map (stars + unlock gates).
  await startScene(page, 'ui-worldmap');
  await page.waitForTimeout(900);
  await shoot(page, '03-world-map');

  // 3) Level intro / boss title card for Tutorial 1.
  await page.evaluate(() => window.__SQUAD_UI.startLevel('tut-1'));
  await waitScene(page, 'ui-levelintro', 30000);
  await page.waitForTimeout(500);
  await shoot(page, '04-level-intro');

  // 4) In-game: class picker / planning, then live play driven by bots.
  await page.evaluate(() => window.__SQUAD_UI.beginLevel('tut-1'));
  await page.waitForFunction(() => typeof window.__SQUAD !== 'undefined', undefined, { timeout: 30000 });
  await page.waitForTimeout(1200);
  await shoot(page, '05-class-picker-planning');

  // Drive the tutorial to a win with scripted bots, grabbing an action shot.
  const PLAN = ['guardian', 'ranger'];
  let actionShot = false;
  for (let i = 0; i < 8; i++) {
    const result = await page.evaluate(() => window.__SQUAD.result());
    if (result !== 'in_progress') break;
    const phase = await page.evaluate(() => window.__SQUAD.phase());
    if (phase === 'pick') {
      const slot = await page.evaluate(() => window.__SQUAD.recordingSlot());
      await page.evaluate((c) => window.__SQUAD.pickClass(c), PLAN[slot] ?? PLAN[PLAN.length - 1]);
      await page.waitForTimeout(60);
      await page.evaluate(() => window.__SQUAD.skipPlanning());
      await page.evaluate(() => window.__SQUAD.skipPlanning());
      await page.waitForTimeout(60);
    }
    const p2 = await page.evaluate(() => window.__SQUAD.phase());
    if (p2 === 'playing') {
      await page.evaluate(() => window.__SQUAD.driveWithBots());
      if (!actionShot) {
        await page.waitForTimeout(600);
        await shoot(page, '06-combat');
        actionShot = true;
      }
      await page.evaluate(() => window.__SQUAD.fastForward(2000));
      await page.waitForTimeout(60);
    }
  }

  // 5) Results with stars.
  await waitScene(page, 'ui-results', 30000).catch(() => {});
  await page.waitForTimeout(600);
  await shoot(page, '07-results');

  // 6) Shop, settings, replays, credits.
  for (const [scene, name] of [
    ['ui-shop', '08-shop'],
    ['ui-settings', '09-settings'],
    ['ui-replays', '10-replays'],
    ['ui-credits', '11-credits'],
    ['ui-daily', '12-daily-paradox'],
    ['ui-timechess', '13-time-chess'],
  ]) {
    await startScene(page, scene);
    await page.waitForTimeout(700);
    if ((await page.evaluate(() => window.__SQUAD_UI?.scene?.())) === scene) {
      await shoot(page, name);
    }
  }

  // 7) A desktop widescreen shot of the title for layout proof.
  await page.setViewportSize({ width: 1920, height: 1080 });
  await startScene(page, 'ui-title');
  await page.waitForTimeout(800);
  await shoot(page, '14-title-desktop-1920x1080');

  console.log('\nCONSOLE_ERRORS:', JSON.stringify(errors));
  await browser.close();
  console.log('\nTOTAL SHOTS:', shots.length);
} finally {
  server.kill('SIGTERM');
}
