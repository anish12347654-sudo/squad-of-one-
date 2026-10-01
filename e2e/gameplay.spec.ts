import { test, expect } from '@playwright/test';

/**
 * M2 gameplay verification. Drives the full 7-slot showcase flow through the dev
 * hook (window.__SQUAD): a deliberate paradox (slots 0 and 1 both grab the same
 * Time Shard, breaking slot 0's anchor), a rewrite, and a Convergence finish on
 * the Final Avatar's loop. Captures the required screenshots
 * (scrubber, paradox glitch, rewind, Convergence, victory cinematic) and asserts
 * zero console errors.
 *
 * The dev hook feeds state-aware bots through the SAME input pipeline as live
 * play, so this exercises the real sim + presentation, not a stubbed path.
 */

const SHARD_PLAN = { 0: 0, 1: 0 } as const;

test('drives the M2 7-slot flow (paradox + rewrite + Convergence) with zero console errors', async ({ page }) => {
  // This spec drives the full 7-slot showcase flow (many rendered frames) end to
  // end. After the FEAT-003 in-game art-direction overhaul (layered entities,
  // cinematic bloom, richer pooled VFX, animated backdrop) the heavier render
  // path pushes the long flow just past the default 30 s under the headless
  // --disable-gpu software rasteriser (device GPUs render it far faster). This
  // raises only the time budget - no assertion is weakened; the determinism /
  // invariance / solution / parity suites still prove the sim is byte-identical.
  test.setTimeout(90_000);

  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));

  // Deep-link straight into the showcase GameScene (main.ts stops the FTE/title
  // and starts the GameScene once, deterministically). We do NOT click the
  // canvas here - a centre click would land on the class-picker; the dev hook
  // drives the sim directly, which does not need the audio unlock gesture.
  await page.goto('/?scene=game&skipIntro=1', { waitUntil: 'load' });
  const canvas = page.locator('#app canvas');
  await expect(canvas).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(() => typeof window.__SQUAD !== 'undefined', undefined, { timeout: 10_000 });

  const PLAN = ['guardian', 'medic', 'ranger', 'pyromancer', 'rogue', 'engineer', 'avatar'] as const;

  // Advance one rendered frame.
  async function frame(ms = 80): Promise<void> {
    await page.waitForTimeout(ms);
  }

  let scrubberShot = false;
  let paradoxShot = false;
  let rewriteDone = false;

  // Play each slot: pick class, (maybe) capture the scrubber, start recording,
  // then fast-forward the loop through the paradox.
  for (let i = 0; i < PLAN.length + 10; i++) {
    // Reached a terminal result?
    const result = await page.evaluate(() => window.__SQUAD!.result());
    if (result !== 'in_progress') break;

    // Let any rewind transition settle into pick/decision before reading phase.
    await page.waitForFunction(() => window.__SQUAD!.phase() !== 'rewind', undefined, { timeout: 5000 }).catch(() => {});
    const phase = await page.evaluate(() => window.__SQUAD!.phase());

    if (phase === 'pick') {
      const slot = await page.evaluate(() => window.__SQUAD!.recordingSlot());
      await page.evaluate((cls) => window.__SQUAD!.pickClass(cls), PLAN[slot]!);
      await frame();

      // From slot 1 onwards there are echoes -> the planning scrubber appears.
      const afterPickPhase = await page.evaluate(() => window.__SQUAD!.phase());
      if (afterPickPhase === 'planning' && slot >= 1 && !scrubberShot) {
        // Wait for the pre-sim (worker) to resolve and the scrubber to draw.
        await page.waitForTimeout(900);
        await page.screenshot({ path: 'e2e/output/m2-scrubber.png' });
        scrubberShot = true;
      }
      // Skip planning/countdown straight into recording.
      await page.evaluate(() => window.__SQUAD!.skipPlanning());
      await page.evaluate(() => window.__SQUAD!.skipPlanning());
      await frame();
    }

    // Ensure we are in the playing phase before driving bots.
    const p2 = await page.evaluate(() => window.__SQUAD!.phase());
    if (p2 === 'playing') {
      await page.evaluate((sp) => window.__SQUAD!.driveWithBots(sp), SHARD_PLAN as unknown as Record<number, number>);
      // Step partway, then screenshot the paradox glitch once it appears.
      await page.evaluate(() => window.__SQUAD!.fastForward(600));
      await frame();
      const pc = await page.evaluate(() => window.__SQUAD!.paradoxCount());
      if (pc > 0 && !paradoxShot) {
        await page.screenshot({ path: 'e2e/output/m2-paradox.png' });
        paradoxShot = true;
      }
      // Finish the loop.
      await page.evaluate(() => window.__SQUAD!.fastForward(2000));
      await frame();

      // The rewind transition plays between loops - capture it once.
      const rw = await page.evaluate(() => window.__SQUAD!.phase());
      if (rw === 'rewind') {
        await page.screenshot({ path: 'e2e/output/m2-rewind.png' });
      }
    }

    // Decision gate (all slots recorded, boss alive): demonstrate a rewrite once.
    const canRewrite = await page.evaluate(() => window.__SQUAD!.awaitingDecision() && window.__SQUAD!.canRewrite());
    if (canRewrite && !rewriteDone) {
      await page.evaluate(() => window.__SQUAD!.rewriteSlot(2));
      rewriteDone = true;
      await frame();
    }
  }

  // Convergence + victory: the win lands on the Final Avatar's loop. Capture the
  // Convergence beams (during play) and the victory cinematic (after the win).
  // If we already won, grab the cinematic; otherwise nudge the last loop.
  const finalResult = await page.evaluate(() => window.__SQUAD!.result());
  // Give the win a moment; the scene enters the cinematic on the boss kill.
  await page.waitForTimeout(400);
  const phaseAfter = await page.evaluate(() => window.__SQUAD!.phase());
  if (phaseAfter === 'cinematic') {
    await page.screenshot({ path: 'e2e/output/m2-convergence.png' });
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'e2e/output/m2-victory.png' });
  }

  // Drive to the results screen.
  await page.waitForFunction(() => window.__SQUAD!.result() === 'won', undefined, { timeout: 15_000 });
  const stars = await page.evaluate(() => window.__SQUAD!.stars());
  expect(finalResult === 'won' || (await page.evaluate(() => window.__SQUAD!.result())) === 'won').toBeTruthy();
  expect(stars.count).toBeGreaterThanOrEqual(1);
  expect(paradoxShot, 'a paradox should have been created and screenshotted').toBe(true);

  // Let the victory cinematic auto-advance to the results screen, then shoot it.
  await page.waitForFunction(() => window.__SQUAD!.phase() === 'result', undefined, { timeout: 10_000 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'e2e/output/m2-final.png' });

  expect(pageErrors, `page errors:\n${pageErrors.join('\n')}`).toEqual([]);
  expect(consoleErrors, `console errors:\n${consoleErrors.join('\n')}`).toEqual([]);
});
