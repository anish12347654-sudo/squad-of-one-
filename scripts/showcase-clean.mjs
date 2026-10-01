// Quick showcase capture that skips the first-time experience (?skipIntro=1)
// and walks the menu scenes directly. Writes PNGs to e2e/output/showcase.
// Starts and stops its own `vite preview` so it runs as a single command.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const PORT = 4189;
const BASE = `http://localhost:${PORT}`;
const OUT = process.env.SHOWCASE_OUT ?? 'e2e/output/showcase';
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

  await page.goto(`${BASE}/?skipIntro=1`, { waitUntil: 'load' });
  await page.locator('#app canvas').waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForFunction(() => window.__SQUAD_UI?.scene?.() === 'ui-title', undefined, {
    timeout: 30000,
  });
  await page.waitForTimeout(600);
  await shoot(page, '02-title');

  for (const [scene, name] of [
    ['ui-worldmap', '03-world-map'],
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
