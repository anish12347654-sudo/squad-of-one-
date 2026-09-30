import { test, expect } from '@playwright/test';

/**
 * M3 verification (brief section 10, gate 4):
 *  1. boot -> first-time experience -> finish Tutorial 1 -> results, zero
 *     console errors, driven by the dev tick-exact hook (window.__SQUAD);
 *  2. one test that uses REAL keyboard + touch events (no dev hook);
 *  3. multi-viewport screenshots of EVERY screen at 390x844, 844x390, 768x1024,
 *     1920x1080 for manual inspection (overlap / clipping / contrast).
 */

const VIEWPORTS = [
  { name: '390x844', width: 390, height: 844 },
  { name: '844x390', width: 844, height: 390 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '1920x1080', width: 1920, height: 1080 },
];

function trackErrors(page: import('@playwright/test').Page): { console: string[]; page: string[] } {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  return { console: consoleErrors, page: pageErrors };
}

test('boot -> first-time experience plays and lands on the title menu', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/', { waitUntil: 'load' });
  const canvas = page.locator('#app canvas');
  await expect(canvas).toBeVisible({ timeout: 15_000 });
  // Tap to unlock audio + let the FTE run its loop-1-fail -> rewind -> loop-2 beat.
  await canvas.click();
  // The FTE marks seenIntro and hands off to the title menu within ~15 s.
  await page.waitForFunction(() => window.__SQUAD_UI?.scene?.() === 'ui-title', undefined, {
    timeout: 35_000,
  });
  await page.screenshot({ path: 'e2e/output/m3-fte-title.png' });
  expect(errors.page, errors.page.join('\n')).toEqual([]);
  expect(errors.console, errors.console.join('\n')).toEqual([]);
});

test('finish Tutorial 1 via the dev hook and reach the localized results screen', async ({ page }) => {
  const errors = trackErrors(page);
  // Boot (skip the FTE), open the Tutorial 1 level intro (story + objective).
  await page.goto('/?skipIntro=1', { waitUntil: 'load' });
  const canvas = page.locator('#app canvas');
  await expect(canvas).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(() => window.__SQUAD_UI?.scene?.() === 'ui-title', undefined, { timeout: 30_000 });
  await page.evaluate(() => window.__SQUAD_UI!.startLevel('tut-1'));
  await page.waitForFunction(() => window.__SQUAD_UI?.scene?.() === 'ui-levelintro', undefined, { timeout: 30_000 });
  await page.screenshot({ path: 'e2e/output/m3-tut1-intro.png' });

  // Begin the level (launches the GameScene, which installs the dev hook).
  await page.evaluate(() => window.__SQUAD_UI!.beginLevel('tut-1'));
  await page.waitForFunction(() => typeof window.__SQUAD !== 'undefined', undefined, { timeout: 30_000 });

  const PLAN = ['guardian', 'ranger'] as const;
  for (let i = 0; i < PLAN.length + 4; i++) {
    const result = await page.evaluate(() => window.__SQUAD!.result());
    if (result !== 'in_progress') break;
    await page.waitForFunction(() => window.__SQUAD!.phase() !== 'rewind', undefined, { timeout: 5000 }).catch(() => {});
    const phase = await page.evaluate(() => window.__SQUAD!.phase());
    if (phase === 'pick') {
      const slot = await page.evaluate(() => window.__SQUAD!.recordingSlot());
      await page.evaluate((cls) => window.__SQUAD!.pickClass(cls), PLAN[slot] ?? PLAN[PLAN.length - 1]!);
      await page.waitForTimeout(60);
      await page.evaluate(() => window.__SQUAD!.skipPlanning());
      await page.evaluate(() => window.__SQUAD!.skipPlanning());
      await page.waitForTimeout(60);
    }
    const p2 = await page.evaluate(() => window.__SQUAD!.phase());
    if (p2 === 'playing') {
      await page.evaluate(() => window.__SQUAD!.driveWithBots());
      await page.evaluate(() => window.__SQUAD!.fastForward(2000));
      await page.waitForTimeout(60);
    }
  }

  // The GameScene hands off to the localized ResultsScene once resolved.
  await page.waitForFunction(() => window.__SQUAD_UI?.scene?.() === 'ui-results', undefined, {
    timeout: 30_000,
  });
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'e2e/output/m3-tut1-results.png' });

  expect(errors.page, errors.page.join('\n')).toEqual([]);
  expect(errors.console, errors.console.join('\n')).toEqual([]);
});

test('real keyboard + touch input drives the FTE and menus (no dev hook)', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/', { waitUntil: 'load' });
  const canvas = page.locator('#app canvas');
  await expect(canvas).toBeVisible({ timeout: 15_000 });

  // Real touch: tap the canvas to unlock audio + drive the FTE.
  await canvas.tap().catch(async () => {
    // Fallback for engines without touch: use a real mouse click.
    await canvas.click();
  });
  // Real keyboard: press a key (the FTE / title respond to key input).
  await page.keyboard.press('Space');

  // The real tap + key drove the FTE all the way to the title menu.
  await page.waitForFunction(() => window.__SQUAD_UI?.scene?.() === 'ui-title', undefined, {
    timeout: 35_000,
  });

  // Real pointer click on the canvas (a genuine input event) over the World Map
  // button. Map the game-space button centre through the canvas bounding box so
  // it works regardless of letterboxing.
  const box = await canvas.boundingBox();
  if (box) {
    const gameW = 390;
    const gameH = 844;
    const scale = Math.min(box.width / gameW, box.height / gameH);
    const offX = box.x + (box.width - gameW * scale) / 2;
    const offY = box.y + (box.height - gameH * scale) / 2;
    // World Map button: startY (height*0.38) + one row (gap 46).
    const bx = offX + 195 * scale;
    const by = offY + (844 * 0.38 + 46) * scale;
    await page.mouse.click(bx, by);
  }
  await page.waitForFunction(() => window.__SQUAD_UI?.scene?.() === 'ui-worldmap', undefined, {
    timeout: 20_000,
  });

  expect(errors.page, errors.page.join('\n')).toEqual([]);
  expect(errors.console, errors.console.join('\n')).toEqual([]);
});

test('multi-viewport screenshots of every screen', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = trackErrors(page);

  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });

    // Title menu (skip FTE).
    await page.goto('/?skipIntro=1', { waitUntil: 'load' });
    const canvas = page.locator('#app canvas');
    await expect(canvas).toBeVisible({ timeout: 15_000 });
    await page.waitForFunction(() => window.__SQUAD_UI?.scene?.() === 'ui-title', undefined, { timeout: 30_000 });
    await page.waitForTimeout(250);
    await page.screenshot({ path: `e2e/output/m3-title-${vp.name}.png` });

    // Navigate each menu via the UI scene switcher (deterministic, engine-free).
    const screens: { scene: string; shot: string }[] = [
      { scene: 'ui-worldmap', shot: 'map' },
      { scene: 'ui-shop', shot: 'shop' },
      { scene: 'ui-settings', shot: 'settings' },
      { scene: 'ui-replays', shot: 'replays' },
      { scene: 'ui-credits', shot: 'credits' },
    ];
    for (const s of screens) {
      await page.evaluate((key) => window.__SQUAD_UI?.start?.(key), s.scene);
      await page.waitForFunction((key) => window.__SQUAD_UI?.scene?.() === key, s.scene, { timeout: 20_000 });
      await page.waitForTimeout(200);
      await page.screenshot({ path: `e2e/output/m3-${s.shot}-${vp.name}.png` });
    }

    // Level intro (story + objective + boss title card).
    await page.evaluate(() => window.__SQUAD_UI?.startLevel?.('w1-boss'));
    await page.waitForFunction(() => window.__SQUAD_UI?.scene?.() === 'ui-levelintro', undefined, { timeout: 20_000 });
    await page.waitForTimeout(200);
    await page.screenshot({ path: `e2e/output/m3-levelintro-${vp.name}.png` });

    // The FTE (gameplay + rewind beat) at this viewport.
    await page.goto('/?fte=1', { waitUntil: 'load' });
    await expect(page.locator('#app canvas')).toBeVisible({ timeout: 15_000 });
    await page.locator('#app canvas').click();
    await page.waitForFunction(() => window.__SQUAD_UI?.scene?.() === 'ui-fte', undefined, { timeout: 8_000 }).catch(() => {});
    await page.waitForTimeout(2600); // into loop 1 gameplay
    await page.screenshot({ path: `e2e/output/m3-gameplay-${vp.name}.png` });
    await page.waitForTimeout(4000); // toward the rewind / loop 2 beat
    await page.screenshot({ path: `e2e/output/m3-fte-loop2-${vp.name}.png` });
  }

  expect(errors.page, errors.page.join('\n')).toEqual([]);
  expect(errors.console, errors.console.join('\n')).toEqual([]);
});
