import { test, expect } from '@playwright/test';

/**
 * M0 boot verification: the built app must reach the title canvas with zero
 * console errors, and we capture a screenshot for manual inspection.
 */
test('boots to the title canvas with no console errors', async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => {
    pageErrors.push(err.message);
  });

  await page.goto('/', { waitUntil: 'load' });

  // Phaser mounts a <canvas> under #app once the game boots.
  const canvas = page.locator('#app canvas');
  await expect(canvas).toBeVisible({ timeout: 15_000 });

  // The document title comes from the single branding constant.
  await expect(page).toHaveTitle('SQUAD OF ONE');

  // Give the title scene a moment to render text into the canvas.
  await page.waitForTimeout(750);

  await page.screenshot({ path: 'e2e/output/title-screen.png', fullPage: false });

  expect(pageErrors, `page errors: ${pageErrors.join('\n')}`).toEqual([]);
  expect(consoleErrors, `console errors: ${consoleErrors.join('\n')}`).toEqual([]);
});
