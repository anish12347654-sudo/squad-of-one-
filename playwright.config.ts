import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config. Builds are served by `vite preview` on port 4173. The
 * bundled Chromium at /opt/playwright is reused via PLAYWRIGHT_BROWSERS_PATH in
 * the environment; devices.iPhone13 gives us a mobile-first viewport.
 */
export default defineConfig({
  testDir: './e2e',
  // This is a heavy WebGL/canvas game served by a single `vite preview`
  // instance. Running multiple browser contexts in parallel starves the shared
  // render loop, so the long multi-viewport screenshot test steals frames from
  // the tick-exact Tutorial-1 flow and its scene-transition waits time out under
  // load. Serialize the whole run (one worker, no intra-file parallelism) so
  // each spec gets the render loop to itself, and keep a couple of retries as
  // defence-in-depth against residual timing jitter on a loaded machine.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 2,
  reporter: [['list']],
  outputDir: './e2e/output',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'off',
    screenshot: 'off',
  },
  projects: [
    {
      name: 'mobile-chromium',
      use: {
        // Mobile-first viewport, but force the Chromium engine and the
        // pre-installed browser binary on this box (revision differs from the
        // one @playwright/test would auto-download).
        ...devices['Pixel 5'],
        defaultBrowserType: 'chromium',
        launchOptions: {
          executablePath:
            process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
            '/opt/playwright/chromium-1232/chrome-linux64/chrome',
          args: ['--no-sandbox', '--disable-gpu'],
        },
      },
    },
  ],
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
