import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

/**
 * Determinism gate 2 (browser side): drive the PURE parity harness inside real
 * Chromium (via the dev hook `window.__SQUAD_DET`) and assert its per-tick +
 * final state hashes match the committed Node fixture exactly. This is the
 * Node-vs-browser hash-parity test on the same replay (brief section 10).
 */

interface ParityResult {
  levelId: string;
  plan: string[];
  result: string;
  wonOnSlot: number;
  stars: number;
  finalTick: number;
  finalHash: number;
  sampleHashes: number[];
  sampleEvery: number;
}

const fixture = JSON.parse(
  readFileSync(new URL('../tests/determinism/parity-fixture.json', import.meta.url), 'utf-8'),
) as ParityResult;

test('Node-vs-browser hash parity on the same replay', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(e.message));

  await page.goto('/?skipIntro=1', { waitUntil: 'load' });
  await expect(page.locator('#app canvas')).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(() => typeof window.__SQUAD_DET !== 'undefined', undefined, { timeout: 20_000 });

  const browser = (await page.evaluate((every) => window.__SQUAD_DET!.run(every), fixture.sampleEvery)) as ParityResult;

  // Identical fingerprints: the pure sim + content produce the SAME hashes in
  // Node (Vitest) and in Chromium.
  expect(browser.levelId).toBe(fixture.levelId);
  expect(browser.plan).toEqual(fixture.plan);
  expect(browser.finalTick).toBe(fixture.finalTick);
  expect(browser.result).toBe(fixture.result);
  expect(browser.wonOnSlot).toBe(fixture.wonOnSlot);
  expect(browser.stars).toBe(fixture.stars);
  expect(browser.finalHash).toBe(fixture.finalHash);
  expect(browser.sampleHashes).toEqual(fixture.sampleHashes);

  expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
});
