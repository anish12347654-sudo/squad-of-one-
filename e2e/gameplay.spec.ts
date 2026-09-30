import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * The dev hook surface (window.__SQUAD) is declared in src/game/dev-hook.ts as
 * a global augmentation and is visible here via the shared tsconfig.
 */

/**
 * M1 gameplay verification. Drives the vertical slice through the dev hook
 * (window.__SQUAD) with the recorded bot solution's inputs, tick for tick, and
 * captures gameplay screenshots for manual inspection:
 *   - loop 1: recording slot 1 alone (Guardian)
 *   - loop 2: recording slot 2 with slot 1 replaying as an echo beside you
 * Then it plays the solution to a win and asserts zero console errors.
 */

interface SerializedRec {
  slot: number;
  rle: number[];
  length: number;
}
interface Fixture {
  plan: string[];
  recordings: (SerializedRec | null)[];
}

/** Decode the RLE input stream to a plain array of frame objects (int8-safe). */
function decode(rle: number[]): { moveX: number; moveY: number; aim: number; aimActive: boolean; buttons: number }[] {
  const buf = Uint8Array.from(rle);
  const view = new DataView(buf.buffer);
  const total = view.getUint32(0, true);
  const frames = [];
  let off = 4;
  const fromInt8 = (b: number) => (b < 128 ? b : b - 256);
  while (frames.length < total && off + 7 <= buf.length) {
    const count = view.getUint16(off, true);
    off += 2;
    const f = {
      moveX: fromInt8(buf[off]!),
      moveY: fromInt8(buf[off + 1]!),
      aim: buf[off + 2]!,
      aimActive: buf[off + 3]! !== 0,
      buttons: buf[off + 4]!,
    };
    off += 5;
    for (let i = 0; i < count && frames.length < total; i++) frames.push({ ...f });
  }
  return frames;
}

function loadFixture(): Fixture {
  const here = dirname(fileURLToPath(import.meta.url));
  const raw = readFileSync(join(here, '..', 'tests', 'solutions', 'arena-01.solution.json'), 'utf8');
  return JSON.parse(raw) as Fixture;
}

test('drives the M1 slice to a win with zero console errors', async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));

  const fixture = loadFixture();
  const slotFrames = fixture.recordings.map((r) => (r ? decode(r.rle) : []));

  await page.goto('/', { waitUntil: 'load' });
  const canvas = page.locator('#app canvas');
  await expect(canvas).toBeVisible({ timeout: 15_000 });

  // Enter the game (TitleScene -> GameScene) by tapping the canvas.
  await canvas.click();
  await page.waitForFunction(() => typeof window.__SQUAD !== 'undefined', undefined, { timeout: 10_000 });

  // Inject the whole solution's per-slot frames and a scripted source that maps
  // the current recording slot + tick to the right recorded frame.
  await page.evaluate((frames) => {
    // Store on window for the source closure.
    (window as unknown as { __FRAMES: unknown }).__FRAMES = frames;
  }, slotFrames);

  const NEUTRAL = { moveX: 0, moveY: 0, aim: 0, aimActive: false, buttons: 0 };

  type Frame = { moveX: number; moveY: number; aim: number; aimActive: boolean; buttons: number };

  // Install the scripted source for whatever slot is currently recording.
  async function installSource(): Promise<void> {
    await page.evaluate((neutral) => {
      const sq = window.__SQUAD!;
      const slot = sq.recordingSlot();
      const all = (window as unknown as { __FRAMES: Frame[][] }).__FRAMES;
      const frames = all[slot] ?? [];
      sq.setScriptedInput((tick: number) => frames[tick] ?? neutral);
    }, NEUTRAL as unknown as Frame);
  }
  // Fast-forward N ticks (deterministic, no wall clock) and let a frame render.
  async function ff(ticks: number): Promise<void> {
    await page.evaluate((n) => window.__SQUAD!.fastForward(n), ticks);
    await page.waitForTimeout(60); // allow one render frame
  }

  // --- Slot 0: pick Guardian, play alone. Capture "loop 1 alone". ---
  await page.evaluate(() => window.__SQUAD!.pickClass('guardian'));
  await installSource();
  await ff(240); // ~4s of sim: the tank has engaged the boss
  await page.screenshot({ path: 'e2e/output/m1-loop1-alone.png' });
  // Fast-forward to the end of slot 0's loop.
  await page.evaluate(() => window.__SQUAD!.fastForward(2000));
  await page.waitForFunction(
    () => window.__SQUAD!.needsClassChoice() || window.__SQUAD!.result() !== 'in_progress',
    undefined,
    { timeout: 10_000 },
  );
  await page.evaluate(() => window.__SQUAD!.clearScriptedInput());

  // --- Slot 1: pick Medic, play with the Guardian echo beside you. ---
  await page.evaluate(() => window.__SQUAD!.pickClass('medic'));
  await installSource();
  await ff(300); // ~5s: echo Guardian fights while the live Medic heals
  await page.screenshot({ path: 'e2e/output/m1-loop2-echo.png' });
  await page.evaluate(() => window.__SQUAD!.fastForward(2000));
  await page.waitForFunction(
    () => window.__SQUAD!.needsClassChoice() || window.__SQUAD!.result() !== 'in_progress',
    undefined,
    { timeout: 10_000 },
  );
  await page.evaluate(() => window.__SQUAD!.clearScriptedInput());

  // --- Slot 2: pick Ranger, play to the win. ---
  await page.evaluate(() => window.__SQUAD!.pickClass('ranger'));
  await installSource();
  await page.evaluate(() => window.__SQUAD!.fastForward(2000));
  await page.waitForFunction(
    () => window.__SQUAD!.result() !== 'in_progress',
    undefined,
    { timeout: 10_000 },
  );
  await page.evaluate(() => window.__SQUAD!.clearScriptedInput());

  const result = await page.evaluate(() => window.__SQUAD!.result());
  const stars = await page.evaluate(() => window.__SQUAD!.stars());
  expect(result).toBe('won');
  expect(stars.count).toBeGreaterThanOrEqual(1);

  await page.waitForTimeout(300);
  await page.screenshot({ path: 'e2e/output/m1-victory.png' });

  expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
  expect(consoleErrors, `console errors:\n${consoleErrors.join('\n')}`).toEqual([]);
});
