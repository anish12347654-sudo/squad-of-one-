// Verify the Hindi title renders via the Devanagari fallback (no tofu) when the
// Orbitron display face is requested. Serves dist/ in-process, seeds a Hindi
// save, and captures the title at 390x844.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { chromium } from '@playwright/test';

const PORT = 4194;
const BASE = `http://localhost:${PORT}`;
const ROOT = 'dist';
const OUT = process.env.SHOWCASE_OUT ?? 'e2e/output/showcase';
mkdirSync(OUT, { recursive: true });
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.map': 'application/json',
};
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent((req.url ?? '/').split('?')[0].split('#')[0]);
    if (p === '/' || p === '') p = '/index.html';
    const fp = normalize(join(ROOT, p));
    const target = existsSync(fp) ? fp : join(ROOT, 'index.html');
    res.writeHead(200, { 'content-type': MIME[extname(target)] ?? 'application/octet-stream' });
    res.end(await readFile(target));
  } catch {
    res.writeHead(404).end('nf');
  }
});
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
  // Seed a Hindi save with seenIntro so we boot straight to the title in hi.
  await page.addInitScript(() => {
    const save = { version: 1, seenIntro: true, settings: { locale: 'hi' } };
    localStorage.setItem('squad-of-one.save.v1', JSON.stringify(save));
  });
  await page.goto(`${BASE}/?skipIntro=1`, { waitUntil: 'load' });
  await page.locator('#app canvas').waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForFunction(() => window.__SQUAD_UI?.scene?.() === 'ui-title', undefined, {
    timeout: 30000,
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/02-title-hindi.png` });
  console.log('captured 02-title-hindi');
  console.log('CONSOLE_ERRORS:', JSON.stringify(errors));
  await browser.close();
} finally {
  server.close();
}
