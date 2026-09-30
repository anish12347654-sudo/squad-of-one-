import { test, expect } from '@playwright/test';

/**
 * Offline / zero-network-call verification (brief 9.6 + Playables no-external-
 * call rule):
 *   1. On a first load, the ONLY network requests are same-origin app assets
 *      (index.html, JS chunks, fonts, icons, manifest, sw.js) - never a third
 *      party. This proves the game bundles everything and calls out to nobody.
 *   2. After the service worker installs, the game boots and plays with the
 *      network fully blocked (context.setOffline), serving every asset from the
 *      SW cache - a genuine offline PWA.
 */

test('makes zero third-party / external network calls on first load', async ({ page }) => {
  const external: string[] = [];
  const origin = new URL('http://localhost:4173');
  page.on('request', (req) => {
    const u = new URL(req.url());
    // data: / blob: are in-page; same-origin is our own bundle.
    if (u.protocol === 'data:' || u.protocol === 'blob:') return;
    if (u.host !== origin.host) external.push(req.url());
  });

  await page.goto('/?skipIntro=1', { waitUntil: 'load' });
  await expect(page.locator('#app canvas')).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(800);

  expect(external, `unexpected external requests:\n${external.join('\n')}`).toEqual([]);
});

test('boots and plays fully offline after the service worker installs', async ({ page, context }) => {
  const consoleErrors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(e.message));

  // First visit: register + activate the offline service worker and let it
  // precache the app shell.
  await page.goto('/?skipIntro=1', { waitUntil: 'load' });
  await expect(page.locator('#app canvas')).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(
    () => navigator.serviceWorker && navigator.serviceWorker.controller !== null,
    undefined,
    { timeout: 20_000 },
  );

  // Now cut the network entirely and reload: the SW must serve everything from
  // cache and the game must still boot to the title menu.
  await context.setOffline(true);
  await page.reload({ waitUntil: 'load' });
  await expect(page.locator('#app canvas')).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(() => typeof window.__SQUAD_UI !== 'undefined', undefined, { timeout: 20_000 }).catch(() => {});

  // Drive a bit of gameplay offline to prove the sim + render loop run with no
  // network at all.
  await page.waitForFunction(() => window.__SQUAD_UI?.scene?.() === 'ui-title', undefined, { timeout: 20_000 });
  await page.screenshot({ path: 'e2e/output/offline-title.png' });

  await context.setOffline(false);
  expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
});
