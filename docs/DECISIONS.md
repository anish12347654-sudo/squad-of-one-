# Decisions Log

One line per decision: the choice + a one-line reason. Newest at the bottom.

## M0 - Foundation

- **Pin `phaser@4.2.1` exactly** - latest stable Phaser 4; mandated exact pin for reproducible builds.
- **Use known-good stable toolchain over bleeding edge** - `typescript@5.9.3`, `vite@7.3.6`, `vitest@3.2.7`, `eslint@9.37.0`, `prettier@3.6.2`, `@playwright/test@1.56.0`, `typescript-eslint@8.46.0`; the bleeding-edge set (TS 7.x, Vite 8.x, Vitest 5.x, ESLint 10.x) has no matching `typescript-eslint` release and risks parser/config breakage this early. Recorded for reproducibility.
- **`tsx@4.20.6` for running TS build scripts** - lets `gen:trig` and the wired `record:solutions`/`gen:icons` scripts run TypeScript directly without a separate build step.
- **PRNG = sfc32 seeded via mulberry32, state in sim state** - large well-mixed state, trivially serializable as 4x uint32, and no module-level RNG so replays/forks stay bit-exact.
- **Angles as "brads" (4096 per turn, `ANGLE_BITS=12`)** - power-of-two turn lets the sim wrap angles with a bitmask (no float remainder), and 4096 steps give ~0.088deg resolution.
- **Trig tables scaled by 2^15 (`TRIG_ONE=32768`)** - fits signed 16-bit range with headroom, keeps fixed-point multiplies in the 32-bit integer lane.
- **Cosine reuses the sine table with a quarter-turn offset** - one committed table instead of two; halves generated data.
- **`atan2` via minimax rational approximation (+ - \* / only)** - deterministic and dependency-free; error is a few brads, well within aiming needs.
- **FNV-1a hash quantizes numbers to a 1/1024 grid, sorts object keys** - makes the determinism fingerprint invariant to float noise and serialization/key order.
- **Fixed-timestep runner lives in `src/game`, not `src/sim`** - it reads wall-clock deltas (non-deterministic), which the pure sim must never touch.
- **Runner caps at 5 ticks/frame and drops backlog (slow down, never skip)** - preserves determinism under load instead of fast-forwarding.
- **Inline SVG data-URI favicon in `index.html`** - avoids a `/favicon.ico` 404 that would otherwise register as a console error in the E2E boot gate; real asset, not a stub.
- **Playwright points at the pre-installed Chromium at `/opt/playwright/chromium-1232` via `executablePath`** - the bundled revision differs from the one `@playwright/test@1.56` would auto-download; using the local binary avoids a network fetch and version mismatch. Overridable via `PLAYWRIGHT_CHROMIUM_EXECUTABLE`.
- **`record:solutions` / `gen:icons` are wired but no-op today** - their inputs (levels, brand mark, PWA manifest) do not exist until later milestones; they exit 0 with an explicit "nothing to do" message rather than shipping fake output.

## M1 - Vertical slice + frozen sim contracts

- **Class stats the sim reads live in `src/sim/classes.ts`; presentation-only facts in `src/content/classes.ts`** - the pure sim must be self-contained and deterministic, so numeric kit data cannot depend on the content layer; colour/name/sound/silhouette are render-only and stay in content.
- **World positions are plain JS numbers in units (not fixed-point integers)** - only `+ - * / sqrt` are used on them and the FNV-1a hash quantizes to 1/1024, so double arithmetic stays bit-reproducible without a manual fixed-point layer; simpler and less error-prone.
- **Transient scratch (spatial hash, echo-input buffer, boss pattern ref) is module-level and NOT hashed** - it is fully derived from hashed state + deterministic inputs each tick, so keeping it out of `SimState` avoids polluting the fingerprint while staying deterministic.
- **`LevelRunner` is pure and lives in `src/sim`** - the whole time-loop (recordings, live/echo routing, restart-each-loop, win/fail, stars) is deterministic orchestration with no wall clock, so it belongs in the pure layer; the fixed-timestep runner in `src/game` only converts real time to ticks.
- **Healing threat is credited to the healer's own threat entry** - the rule ("credited to every enemy in combat") has one enemy in M1; attributing it to the healer makes the boss aggro the pocket healer, which is the intended tactical pressure and keeps the tie-break rule meaningful.
- **Boss HP tuned to 1300; solution plan Guardian -> Medic -> Ranger** - boss HP resets each loop, so the win must come from enough fighters in ONE loop; 1300 lets the final loop (2 echoes + live Ranger) win while loops 0-1 cannot, showcasing all three classes and the "team builds up" fantasy. 2-star win (win + >=1 echo alive).
- **Boss charge attack gated to phase 2 (<=50% HP)** - gives the fight a readable escalation past the phase-1 threshold without adding mechanics the M1 classes cannot answer.
- **Dev hook exposes `fastForward(maxTicks)`** - e2e must drive three 20s loops; stepping the runner directly (deterministic, no wall clock) keeps the test fast while still going through the real live/echo input pipeline.
- **Victory stars drawn as graphics, not `★` glyphs** - the headless Chromium system font renders the star glyph as tofu boxes; polygon stars render reliably everywhere.
- **`createSimState(seed)` kept as a minimal built-in arena** - generic determinism/runner tests want "a state that evolves deterministically" without importing the content layer; it builds a tiny self-contained boss+Guardian arena.
