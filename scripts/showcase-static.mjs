// Self-contained showcase capture: serves the built `dist/` with an in-process
// Node http server (no `vite preview` subprocess) and drives the menus with
// Playwright, writing PNGs to e2e/output/showcase (or $SHOWCASE_OUT).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { chromium } from '@playwright/test';

const PORT = 4193;
const BASE = `http://localhost:${PORT}`;
const ROOT = 'dist';
const OUT = process.env.SHOWCASE_OUT ?? 'e2e/output/showcase';
mkdirSync(OUT, { recursive: true });

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.map': 'application/json',
};

const server = createServer(async (req, res) => {
  try {
    let urlPath = decodeURIComponent((req.url ?? '/').split('?')[0].split('#')[0]);
    if (urlPath === '/' || urlPath === '') urlPath = '/index.html';
    const filePath = normalize(join(ROOT, urlPath));
    if (!filePath.startsWith(normalize(ROOT))) {
      res.writeHead(403).end('forbidden');
      return;
    }
    const target = existsSync(filePath) ? filePath : join(ROOT, 'index.html');
    const body = await readFile(target);
    res.writeHead(200, { 'content-type': MIME[extname(target)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});

async function shoot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('captured', name);
}

await new Promise((r) => server.listen(PORT, r));
try {
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
  await page.waitForTimeout(3000);
  console.log('HOOK:', await page.evaluate(() => typeof window.__SQUAD_UI));
  console.log('SCENE:', await page.evaluate(() => window.__SQUAD_UI?.scene?.()));
  console.log('EARLY_ERRORS:', JSON.stringify(errors));
  await page
    .waitForFunction(() => window.__SQUAD_UI?.scene?.() === 'ui-title', undefined, {
      timeout: 30000,
    })
    .catch(() => console.log('title wait timed out, scene=', '' ));
  await page.waitForTimeout(700);
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
    await page.evaluate((k) => window.__SQUAD_UI?.start?.(k), scene).catch(() => {});
    await page.waitForTimeout(700);
    if ((await page.evaluate(() => window.__SQUAD_UI?.scene?.())) === scene) {
      await shoot(page, name);
    }
  }

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.evaluate((k) => window.__SQUAD_UI?.start?.(k), 'ui-title').catch(() => {});
  await page.waitForTimeout(800);
  await shoot(page, '14-title-desktop-1920x1080');

  console.log('CONSOLE_ERRORS:', JSON.stringify(errors));
  await browser.close();
} finally {
  server.close();
}
