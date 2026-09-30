/**
 * perf.ts - throttled-CPU performance pass (brief 9.6). Serves the built app,
 * opens the entity-heavy showcase scene (7 echoes + boss + projectiles +
 * Convergence) in real Chromium, applies 4x CPU throttling via the Chrome
 * DevTools Protocol, and samples the actual FPS over several seconds. Prints a
 * summary for docs/PERF.md.
 *
 * Run: `npm run perf` (builds if needed, then measures). Requires a `vite
 * preview` server; this script starts one on :4319.
 */

import { chromium } from 'playwright';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const PORT = 4319;
const BASE = `http://localhost:${PORT}`;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await sleep(300);
  }
  throw new Error(`server did not start at ${url}`);
}

interface Sample {
  scene: string;
  throttle: number;
  avgFps: number;
  minFps: number;
  p5Fps: number;
  entities: number;
}

async function measure(scene: string, throttleRate: number): Promise<Sample> {
  const executablePath =
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
    '/opt/playwright/chromium-1232/chrome-linux64/chrome';
  const browser = await chromium.launch({ executablePath, args: ['--no-sandbox', '--disable-gpu'] });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    // 4x CPU throttling (mid-range Android proxy).
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttleRate });

    await page.goto(`${BASE}/?scene=game&skipIntro=1`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof window.__SQUAD !== 'undefined', undefined, { timeout: 20_000 });

    // Drive to a busy state: pick every class, skip planning, drive bots, and
    // fast-forward so the arena fills with echoes + boss + projectiles.
    const PLAN = ['guardian', 'medic', 'ranger', 'pyromancer', 'rogue', 'engineer', 'avatar'];
    for (let i = 0; i < PLAN.length + 8; i++) {
      const result = await page.evaluate(() => window.__SQUAD!.result());
      if (result !== 'in_progress') break;
      await page.waitForFunction(() => window.__SQUAD!.phase() !== 'rewind', undefined, { timeout: 4000 }).catch(() => {});
      const phase = await page.evaluate(() => window.__SQUAD!.phase());
      if (phase === 'pick') {
        const slot = (await page.evaluate(() => window.__SQUAD!.recordingSlot())) as number;
        await page.evaluate((c) => window.__SQUAD!.pickClass(c as never), PLAN[slot] ?? PLAN[PLAN.length - 1]);
        await page.evaluate(() => window.__SQUAD!.skipPlanning());
        await page.evaluate(() => window.__SQUAD!.skipPlanning());
      }
      const p2 = await page.evaluate(() => window.__SQUAD!.phase());
      if (p2 === 'playing') {
        await page.evaluate(() => window.__SQUAD!.driveWithBots());
        // Let it render live (do NOT fast-forward) so we sample real frames on
        // the last, busiest loop where echoes + Convergence are active.
        if (i >= PLAN.length - 1) break;
        await page.evaluate(() => window.__SQUAD!.fastForward(2000));
      }
    }

    // Keep the live player driving so the busy loop stays in the 'playing'
    // phase while we sample real rendered frames.
    await page.evaluate(() => {
      const api = window.__SQUAD;
      if (api && api.phase() === 'playing') api.driveWithBots();
    });

    // Sample the live FPS over ~4 s of real rendering.
    await sleep(800); // settle
    const fpsSamples: number[] = [];
    for (let i = 0; i < 40; i++) {
      const fps = (await page.evaluate(() => {
        const g = (window as unknown as { __SQUAD_GAME?: { loop?: { actualFps?: number } } }).__SQUAD_GAME;
        return g?.loop?.actualFps ?? 0;
      })) as number;
      if (fps > 0) fpsSamples.push(fps);
      await sleep(100);
    }
    const entities = (await page.evaluate(() => {
      const g = (window as unknown as { __SQUAD_GAME?: { scene?: { getScene?: (k: string) => unknown } } }).__SQUAD_GAME;
      const scene = g?.scene?.getScene?.('GameScene') as { getRunner?: () => { state: { units: unknown[]; projectiles: unknown[]; attacks: unknown[] } } } | undefined;
      const st = scene?.getRunner?.().state;
      return st ? st.units.length + st.projectiles.length + st.attacks.length : 0;
    })) as number;

    const sorted = [...fpsSamples].sort((a, b) => a - b);
    const avg = fpsSamples.reduce((a, b) => a + b, 0) / Math.max(1, fpsSamples.length);
    const p5 = sorted[Math.floor(sorted.length * 0.05)] ?? sorted[0] ?? 0;
    return {
      scene,
      throttle: throttleRate,
      avgFps: Math.round(avg * 10) / 10,
      minFps: Math.round((sorted[0] ?? 0) * 10) / 10,
      p5Fps: Math.round(p5 * 10) / 10,
      entities,
    };
  } finally {
    await browser.close();
  }
}

/**
 * Pure-sim micro-benchmark (device-independent): time `step()` on a busy loop
 * from the parity harness level. The sim has a hard 16.67 ms/tick budget (60
 * Hz); this reports the actual per-tick cost so we know how much render budget
 * is left. Runs in Node - no GPU, no renderer - so it isolates sim cost.
 */
async function benchSim(): Promise<void> {
  const { LevelRunner, cloneSimState } = await import('../src/sim/index.js');
  const { campaignLevelById } = await import('../src/content/index.js');
  const { ALL_BOTS } = await import('../src/content/bots.js');
  const lvl = campaignLevelById('w3-4'); // 7 slots, densest campaign level
  if (!lvl) return;
  const runner = new LevelRunner(lvl.def);
  // Fill the arena: choose classes + advance a few loops so echoes accumulate.
  const plan = ['guardian', 'medic', 'ranger', 'pyromancer', 'rogue', 'engineer', 'avatar'] as const;
  let guard = 0;
  while (runner.result === 'in_progress' && guard < 6000) {
    guard++;
    if (runner.needsClassChoice()) {
      const slot = runner.recordingSlot;
      runner.chooseClass(plan[slot] ?? plan[plan.length - 1]!);
      continue;
    }
    if (runner.awaitingDecision()) break;
    const slot = runner.recordingSlot;
    const cls = runner.slotClasses[slot];
    const bot = cls ? ALL_BOTS[cls] : undefined;
    const frame = bot
      ? bot(runner.state, slot, runner.state.tick)
      : { moveX: 0, moveY: 0, aim: 0, aimActive: false, buttons: 0 };
    runner.tickWith(frame);
    // Stop on the last, busiest loop to snapshot a dense state.
    if (runner.recordingSlot >= lvl.def.slotCount - 1 && runner.state.tick > lvl.def.loopLength - 40) break;
  }
  const dense = cloneSimState(runner.state);
  const entities = dense.units.length + dense.projectiles.length + dense.attacks.length;

  // Time the actual step path: keep driving runner2 through fresh loops so
  // tickWith runs over many densely-populated ticks.
  const runner2 = new LevelRunner(lvl.def);
  const N = 20000;
  const t2 = process.hrtime.bigint();
  let ticks = 0;
  let g2 = 0;
  while (ticks < N && g2 < N * 2) {
    g2++;
    if (runner2.needsClassChoice()) {
      runner2.chooseClass(plan[runner2.recordingSlot] ?? plan[plan.length - 1]!);
      continue;
    }
    if (runner2.awaitingDecision() || runner2.result !== 'in_progress') break;
    const slot = runner2.recordingSlot;
    const cls = runner2.slotClasses[slot];
    const bot = cls ? ALL_BOTS[cls] : undefined;
    const frame = bot
      ? bot(runner2.state, slot, runner2.state.tick)
      : { moveX: 0, moveY: 0, aim: 0, aimActive: false, buttons: 0 };
    runner2.tickWith(frame);
    ticks++;
  }
  const t3 = process.hrtime.bigint();
  const nsPerTick = ticks > 0 ? Number(t3 - t2) / ticks : 0;
  console.log(
    `\n=== Pure sim benchmark (Node) ===\n` +
      `dense state: ${entities} entities (${dense.units.length}u/${dense.projectiles.length}p/${dense.attacks.length}a)\n` +
      `step() cost: ${(nsPerTick / 1000).toFixed(1)} us/tick (budget 16670 us/tick @ 60 Hz)`,
  );
}

async function main(): Promise<void> {
  await benchSim();
  console.log('perf: building...');
  execFileSync('npx', ['vite', 'build'], { cwd: ROOT, stdio: 'inherit' });
  console.log('perf: starting preview server...');
  const server: ChildProcess = spawn(
    'npx',
    ['vite', 'preview', '--port', String(PORT), '--strictPort'],
    { cwd: ROOT, stdio: 'ignore', detached: false },
  );
  try {
    await waitForServer(BASE, 60_000);
    const samples: Sample[] = [];
    // Baseline (1x) then the mid-range Android proxy (4x CPU throttle).
    samples.push(await measure('showcase-7echoes+boss+convergence', 1));
    samples.push(await measure('showcase-7echoes+boss+convergence', 4));

    console.log('\n=== Perf results ===');
    for (const s of samples) {
      console.log(
        `scene=${s.scene} throttle=${s.throttle}x  avgFps=${s.avgFps}  minFps=${s.minFps}  p5Fps=${s.p5Fps}`,
      );
    }
    console.log('\nCopy these into docs/PERF.md.');
  } finally {
    server.kill('SIGTERM');
  }
}

main().catch((err: unknown) => {
  console.error('perf failed:', err);
  process.exitCode = 1;
});
