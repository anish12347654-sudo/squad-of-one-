# Performance Notes

Budget and measurements for SQUAD OF ONE. Populated as milestones land.

## Targets

- **Sim:** one tick (`step`) must be far under the 1/60 s (16.67 ms) budget on a
  mid-range mobile device, leaving headroom for rendering. The runner caps at 5
  ticks/frame.
- **Frame:** 60 FPS on the 390x844 baseline device.
- **Bundle:** keep the production bundle small enough for PWA + YouTube Playables
  constraints (Playables has a strict size budget and forbids external calls).

## M0 measurements

- Production build (`npm run build`): succeeds; single JS chunk ~1.39 MB raw /
  ~372 kB gzip - dominated by Phaser 4. Vite warns the chunk exceeds 500 kB.
  **Action (later milestone):** code-split / `manualChunks` to separate the
  engine from game code once there is game code worth splitting, and evaluate a
  slimmer render path for the Playables target.
- Determinism/unit suite (`npm run test`): 34 tests, ~0.5 s total.

## Open perf items

- [ ] Reduce/split the Phaser chunk before shipping (M4/M5 polish).
- [ ] Add a headless sim benchmark script (`scripts/perf`) once real systems
      exist (M1+).
