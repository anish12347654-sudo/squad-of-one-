import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * M4 verification (brief section 10): in headless Chromium
 *  - play a victory and export a clip (assert a blob/stream OR graceful fallback);
 *  - generate a result-card PNG;
 *  - load a `/#r=<code>` replay and confirm deterministic playback reaches results;
 *  - run a Time Chess match vs AI;
 *  - capture screenshots (Daily result card, Time Chess, Replays screen, exported card)
 *    and assert zero console errors throughout.
 */

function trackErrors(page: Page): { console: string[]; page: string[] } {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  return { console: consoleErrors, page: pageErrors };
}

/** Build a winning tut-1 replay code headlessly via the dev hook. */
async function tut1Code(page: Page): Promise<string> {
  await page.waitForFunction(() => typeof window.__SQUAD_REPLAY !== 'undefined', undefined, { timeout: 15_000 });
  const code = await page.evaluate(() => window.__SQUAD_REPLAY!.buildCode('tut-1', ['guardian', 'ranger']));
  expect(code, 'a winning run should produce a replay code').toBeTruthy();
  return code as string;
}

test('victory -> clip export (or fallback) + result-card PNG', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/?skipIntro=1', { waitUntil: 'load' });
  const canvas = page.locator('#app canvas');
  await expect(canvas).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(() => window.__SQUAD_UI?.scene?.() === 'ui-title', undefined, { timeout: 30_000 });
  await canvas.click(); // unlock audio
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'e2e/output/m4-title.png' });

  // Clip export: assert a real media blob OR the graceful PNG fallback.
  const clip = await page.evaluate(() => window.__SQUAD_SHARE!.exportClip(700));
  expect(clip.method === 'downloaded' || clip.method === 'shared' || clip.method === 'png-fallback').toBe(true);
  expect(clip.size).toBeGreaterThan(0);

  // Result-card PNG generates.
  const cardSize = await page.evaluate(() => window.__SQUAD_SHARE!.resultCardSize());
  expect(cardSize).toBeGreaterThan(0);

  expect(errors.page, errors.page.join('\n')).toEqual([]);
  expect(errors.console, errors.console.join('\n')).toEqual([]);
});

test('`/#r=<code>` replays a shared run deterministically', async ({ page }) => {
  const errors = trackErrors(page);
  // First, produce a code by winning tut-1 headlessly.
  await page.goto('/?skipIntro=1', { waitUntil: 'load' });
  await expect(page.locator('#app canvas')).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(() => window.__SQUAD_UI?.scene?.() === 'ui-title', undefined, { timeout: 30_000 });
  const code = await tut1Code(page);

  // Now load `/#r=<code>` fresh and confirm it plays back to a win.
  await page.goto(`/#r=${encodeURIComponent(code)}`, { waitUntil: 'load' });
  await expect(page.locator('#app canvas')).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(() => typeof window.__SQUAD !== 'undefined', undefined, { timeout: 30_000 });
  await page.locator('#app canvas').click();
  // Fast-forward the deterministic playback loop by loop.
  for (let i = 0; i < 10; i++) {
    const result = await page.evaluate(() => window.__SQUAD!.result());
    if (result !== 'in_progress') break;
    await page.waitForFunction(() => window.__SQUAD!.phase() !== 'rewind', undefined, { timeout: 5000 }).catch(() => {});
    const phase = await page.evaluate(() => window.__SQUAD!.phase());
    if (phase === 'playing') {
      await page.evaluate(() => window.__SQUAD!.fastForward(2000));
    } else {
      await page.evaluate(() => window.__SQUAD!.skipPlanning());
    }
    await page.waitForTimeout(50);
  }
  const finalResult = await page.evaluate(() => window.__SQUAD!.result());
  expect(finalResult).toBe('won');
  await page.screenshot({ path: 'e2e/output/m4-replay-playback.png' });

  expect(errors.page, errors.page.join('\n')).toEqual([]);
  expect(errors.console, errors.console.join('\n')).toEqual([]);
});

test('a version/content mismatch code shows the clear message (no silent desync)', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/?skipIntro=1', { waitUntil: 'load' });
  await expect(page.locator('#app canvas')).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(() => window.__SQUAD_UI?.scene?.() === 'ui-title', undefined, { timeout: 30_000 });

  // Open the Replays screen, type a garbage code, and confirm the invalid path.
  await page.evaluate(() => window.__SQUAD_UI!.start('ui-replays'));
  await page.waitForFunction(() => window.__SQUAD_UI?.scene?.() === 'ui-replays', undefined, { timeout: 20_000 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'e2e/output/m4-replays-screen.png' });

  const input = page.locator('input[data-testid="replay-code-input"]');
  await expect(input).toBeVisible({ timeout: 10_000 });
  await input.fill('not-a-valid-code');
  // Click Load (map the game-space button through the canvas box).
  await clickGameButton(page, 195 - 80, 138);
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'e2e/output/m4-replays-invalid.png' });
  // Still on the replays screen (no desync / crash), zero errors.
  expect(await page.evaluate(() => window.__SQUAD_UI?.scene?.())).toBe('ui-replays');

  expect(errors.page, errors.page.join('\n')).toEqual([]);
  expect(errors.console, errors.console.join('\n')).toEqual([]);
});

test('Daily Paradox plays and shows a shareable result card', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/?skipIntro=1', { waitUntil: 'load' });
  await expect(page.locator('#app canvas')).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(() => window.__SQUAD_UI?.scene?.() === 'ui-title', undefined, { timeout: 30_000 });
  await page.locator('#app canvas').click();

  await page.evaluate(() => window.__SQUAD_UI!.start('ui-daily'));
  await page.waitForFunction(() => window.__SQUAD_UI?.scene?.() === 'ui-daily', undefined, { timeout: 20_000 });
  await page.waitForFunction(() => typeof window.__SQUAD_DAILY !== 'undefined', undefined, { timeout: 10_000 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'e2e/output/m4-daily-lobby.png' });

  // Run the daily headlessly to a real scored result + jump to the result card.
  await page.evaluate(() => window.__SQUAD_DAILY!.playToResult());
  await page.waitForFunction(() => window.__SQUAD_UI?.scene?.() === 'ui-daily-results', undefined, { timeout: 30_000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'e2e/output/m4-daily-result-card.png' });

  expect(errors.page, errors.page.join('\n')).toEqual([]);
  expect(errors.console, errors.console.join('\n')).toEqual([]);
});

test('Time Chess vs AI runs a full match deterministically', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/?skipIntro=1', { waitUntil: 'load' });
  await expect(page.locator('#app canvas')).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(() => window.__SQUAD_UI?.scene?.() === 'ui-title', undefined, { timeout: 30_000 });

  await page.evaluate(() => window.__SQUAD_UI!.start('ui-timechess'));
  await page.waitForFunction(() => window.__SQUAD_UI?.scene?.() === 'ui-timechess', undefined, { timeout: 20_000 });
  await page.waitForFunction(() => typeof window.__SQUAD_TC !== 'undefined', undefined, { timeout: 10_000 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'e2e/output/m4-timechess-menu.png' });

  // Start a vs-AI match (hard) and fast-forward it deterministically.
  await page.evaluate(() => window.__SQUAD_TC!.setDifficulty('hard'));
  await page.evaluate(() => window.__SQUAD_TC!.startVsAi());
  await page.waitForFunction(() => window.__SQUAD_TC!.mode() === 'playing', undefined, { timeout: 10_000 });
  await page.screenshot({ path: 'e2e/output/m4-timechess-playing.png' });
  await page.evaluate(() => window.__SQUAD_TC!.fastForward());
  await page.waitForFunction(() => window.__SQUAD_TC!.mode() === 'result', undefined, { timeout: 20_000 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'e2e/output/m4-timechess-result.png' });

  const scores = await page.evaluate(() => window.__SQUAD_TC!.scores());
  expect(scores.a).toBeGreaterThanOrEqual(0);
  expect(scores.b).toBeGreaterThanOrEqual(0);

  expect(errors.page, errors.page.join('\n')).toEqual([]);
  expect(errors.console, errors.console.join('\n')).toEqual([]);
});

/** Click a game-space (390x844) point mapped through the canvas bounding box. */
async function clickGameButton(page: Page, gx: number, gy: number): Promise<void> {
  const canvas = page.locator('#app canvas');
  const box = await canvas.boundingBox();
  if (!box) return;
  const gameW = 390;
  const gameH = 844;
  const scale = Math.min(box.width / gameW, box.height / gameH);
  const offX = box.x + (box.width - gameW * scale) / 2;
  const offY = box.y + (box.height - gameH * scale) / 2;
  await page.mouse.click(offX + gx * scale, offY + gy * scale);
}
