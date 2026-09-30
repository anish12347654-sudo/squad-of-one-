# SQUAD OF ONE - Progress

Live checklist of every milestone. At the start of every session, read this file
and `docs/` first. Check items off as they land; commit at least once per
milestone.

Verification gates (all must be green for a milestone to count as done):
`npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`, and the
relevant `npm run e2e` played in a real (headless) browser with screenshots
inspected.

---

## M0 - Foundation ✅ (complete)

- [x] Scaffold project at `squad-of-one/`, `git init` (local only)
- [x] Install + pin exact toolchain (phaser 4.2.1; TS/Vite/Vitest/ESLint/Prettier/Playwright)
- [x] `tsconfig.json` strict (+ noUncheckedIndexedAccess, exactOptionalPropertyTypes, noImplicitOverride)
- [x] `vite.config.ts` with worker target + path aliases
- [x] Full directory skeleton (src/{sim,content,game,ui,audio,meta,platform,i18n}, tests/{unit,determinism,solutions}, e2e, scripts, docs, public)
- [x] `index.html` + `main.ts` booting Phaser 4 title canvas (title from single branding constant)
- [x] npm scripts: dev, build, typecheck, lint, format, test, test:watch, e2e, gen:trig (+ wired record:solutions, gen:icons)
- [x] ESLint determinism rules for `src/sim/**` (no Phaser/DOM, no Math.random/sin/cos/tan/atan2/exp/log/pow, no Date/performance/timers); proven with a temporary violating sample, then removed
- [x] Seeded PRNG (sfc32 via mulberry32) with state inside sim state
- [x] FNV-1a hashing over quantized sim state
- [x] Fixed 60 Hz tick contract: pure `step(state, inputs)->state` + accumulator runner (max 5 ticks/frame, slow down never skip) in `src/game`
- [x] `scripts/gen-trig.ts` generates COMMITTED integer sin/cos tables + deterministic atan2; `npm run gen:trig` run
- [x] Tests: fixed-seed PRNG exact sequence; identical per-tick FNV-1a hashes for same inputs twice; trig lookups table-driven & pure; hash stable across serialization round-trips
- [x] docs/GDD.md, docs/ARCHITECTURE.md, docs/DECISIONS.md, docs/PERF.md, docs/CREDITS.md
- [x] `npm run lint`, `typecheck`, `test`, `build` all green
- [x] Headless Playwright boots the built app to the title canvas, zero console errors, screenshot captured + inspected
- [x] Git commit for M0

## M1 - Vertical slice + frozen sim contracts ✅ (complete)

- [x] Entities, stable ids, deterministic iteration + total-order comparators (`src/sim/types.ts`, `sim.ts`)
- [x] Deterministic circle/AABB + line collision (`src/sim/vec.ts`) and a spatial hash (`src/sim/spatial-hash.ts`)
- [x] InputFrame recording (RLE typed arrays) + replay playback (`src/sim/recording.ts`); round-trip tested
- [x] Deterministic echo replay through the SAME `step()` path; loop restart contract (`src/sim/level-runner.ts`)
- [x] Classes Guardian/Medic/Ranger with section-4 numbers (`src/sim/classes.ts` + `src/content/classes.ts`)
- [x] Threat/aggro rules (damage/heal/taunt, highest-positive, <=1/s re-eval, tie-break lowest id) (`src/sim/threat.ts`)
- [x] One boss ("The Warden") as a deterministic telegraphed pattern with a phase-1 threshold (`src/content/levels/arena-01.ts`)
- [x] Win (boss killed) / fail (Timeline Failed -> Restart) flow; boss HP resets each loop
- [x] Fixed-timestep loop (<=5 ticks/frame), interpolated rendering, visibilitychange pause (`src/game/scenes/game-scene.ts`)
- [x] Touch (floating joystick + Skill/Dash/Interact) + keyboard (WASD/JKL) -> InputFrame (`src/game/input.ts`)
- [x] Dev-only tick-exact InputFrame hook (`window.__SQUAD`, `src/game/dev-hook.ts`)
- [x] Basic HUD: slot timeline, loop timer ring, boss HP + phase tick, threat line, cooldown rings, echo HP bars + badges, YOU outline
- [x] Invariance Rule test on a dedicated arena (`tests/determinism/invariance.test.ts`)
- [x] Scripted-bot solution replay wins the arena with >= 1 star (`tests/solutions/`, `scripts/record-solutions.ts`)
- [x] `npm run lint`, `typecheck`, `test`, `build`, `e2e` all green; screenshots inspected, zero console errors
- [x] FREEZE sim API for content work (docs/ARCHITECTURE.md "Frozen M1 Contracts")
- [x] Git commit for M1

> Note: paradox detection, rewrite semantics, replay-code encode/decode and
> node-vs-browser hash parity move to their proper milestones (M2 paradox/rewrite,
> M4 replay share). The recording format already reserves the `anchors` field
> used by M2 paradox detection.

## M2 - Full core ✅ (complete)

- [x] All 7 classes with section-4 numbers (Pyromancer/Rogue/Engineer/Avatar added; `src/sim/classes.ts` + `src/content/classes.ts`), unique silhouette/colour/sound/blurb each
- [x] Up to 7 slots; each class at most once; Avatar is last-slot-only (5+ slot levels force Avatar last) — enforced in `LevelRunner.canChoose`
- [x] Paradox system, pure in sim (`src/sim/sim.ts`): anchor-broken (+/-5 ticks) + path-diverged (>12u for 20 consecutive ticks), 0.5s glitch telegraph, hostile-to-everyone, support inversion (heal->drain, Sanctuary->damage zone, turret->shoots anyone), excluded from alive counts
- [x] Paradox presentation: red/glitching/jittering echoes, floating "PARADOX: ..." text + slot-timeline marker (`src/game`)
- [x] Rewrite + 3 Time Shards (`LevelRunner.rewriteSlot`/`shards`): re-record any recorded slot in the changed world (may now die/paradox), Restart-only at 0 shards, feeds the star rating
- [x] Final Avatar: passive damage x(1 + 0.2 x alive non-paradox echoes) per tick; Convergence charges faster per alive echo and fires synchronized beams from every alive echo
- [x] Planning phase + timeline scrubber: Web Worker pre-sim (`src/sim/presim.ts` + `src/game/scrubber-worker.ts`), snapshots every 5 ticks, slider + per-echo ghost-path toggles + 3-2-1 countdown; worker hashes match the main thread (parity test)
- [x] Rewind transition (~1.2s, 8x reverse over snapshots, chromatic/VHS Phaser-4 Filters, skippable)
- [x] Victory cinematic (slow-mo replay + camera-cut labels) + share-options placeholder (full export lands in M4)
- [x] Adaptive per-slot procedural music (120 BPM, layer per class gated by echo life, paradox detune/quieten), audio unlock on first tap, procedural SFX for every action (`src/audio/audio-engine.ts`)
- [x] Full juice pass: Phaser 4 Filters glow/bloom, pooled particles + damage numbers, shake/flash, trails, spectacular boss death + Convergence (`src/game/render/vfx.ts`, `filters.ts`); no per-tick sim allocations, particle caps
- [x] Tests: paradox detection thresholds, support inversion, rewrite semantics + shard accounting, Avatar passive + Convergence charge, Web-Worker-vs-main-thread hash parity; M1 determinism/invariance/solution suites still green
- [x] `npm run lint`, `typecheck`, `test`, `build`, `e2e` all green; headless Playwright plays the full 7-slot flow with a deliberate paradox, a rewrite and a Convergence finish; screenshots (scrubber/paradox/convergence/victory/final) captured + inspected, zero console errors
- [x] Git commit for M2

## M3 - Content & meta ✅ (complete)

Delivered in this milestone so far (all gates green: lint/typecheck/test/build):

- [x] Meta layer (`src/meta`): economy (XP/levels, per-class mastery, Chrono
      Shards), cosmetics catalog (trails/skins/banners, cosmetic-only), monetization
      adapter (feature-flagged OFF, no-op, cosmetic-only product kind), versioned
      saves (v3) with a real migration chain + normalize/hardening, export/import
      code, and gameplay-flow mutations. Unit-tested (save-migration, economy).
- [x] Progression/unlock gates (`src/meta/progression.ts`): linear level gate,
      class unlock ramp, star totals, continue/next, completion. Unit-tested.
- [x] Platform (`src/platform`): localStorage persistence with migration on load
      + in-memory fallback, base64 export/import, `navigator.vibrate` haptics.
- [x] i18n (`src/i18n`): en + hi (Devanagari) JSON tables, `t()` with
      interpolation + fallback, locale/font selection. Parity + no-hard-coded-
      strings tests. NO hard-coded UI strings.
- [x] Fonts: SUBSETTED OFL Noto Sans + Noto Sans Devanagari in `public/fonts`
      (~47 KB total), @font-face in index.html, coverage-checked, credited in
      docs/CREDITS.md + OFL.txt. `npm run gen:fonts` downloads + re-subsets.
- [x] Campaign: 19 handcrafted levels as typed data (`src/content`), worlds
      (palette/hazard/musical-scale/boss-intro), unlock ramp, story keys, four
      boss archetypes as deterministic phase-gated pattern scripts (Pendulum
      Knight / Mirage Djinn / Stasis Wyrm / The Unwinder). Objective types tagged
      (boss/survive/heist/build).
- [x] Solvability: recorded solution replay for EVERY level
      (`npm run record:solutions`); the tests/solutions gate asserts each of the
      19 levels wins with >= 1 star both live and via its recorded replay; first
      three levels first-time winnable. Boss HP tuned via `scripts/calibrate.ts`.

Completed in the M3 continuation (all gates green: lint/typecheck/test(172)/build/e2e):

- [x] UI menu suite (`src/ui`): title, world map (stars + unlock gates), level
      intro + boss/story title card, class picker + scrubber (in GameScene),
      results with vector stars, cosmetic shop (buy/equip via meta/cosmetics),
      settings + accessibility, replays (StoredReplay list), credits, pause -
      all wired to meta/i18n, every string via `t()` (no-hard-coded test passes).
- [x] First-time experience: opens straight into a training-golem encounter;
      loop 1 alone falls short -> rewind -> loop 2 with your echo beside you wins.
      The "aha" lands in ~12 s (< 60). Gated by `SaveGame.seenIntro`.
- [x] Settings + accessibility wired to the save and applied live: volume sliders,
      screen shake, reduced flashing, colour-blind-safe identity (shape+number),
      text size, left-handed, haptics (navigator.vibrate), Assist Mode (0.8x,
      marked on stars via LevelRecord.assistUsed). Save export/import codes.
- [x] Full enemy roster as PURE-sim mechanics: 6 minion archetypes
      (chaser/caster/bomber/shielded/healer/splitter) with telegraphs, added
      additively (new `kind:'minion'` + `enemyKind`, deterministic AI). Real
      objective SIM mechanics: survive-to-timeout / protect-the-core, Time-Core
      heist (grab + carry to goal through plate-gated doors), build & cross
      (Engineer build pads). Determinism re-verified (per-tick FNV-1a parity +
      presim worker/main parity); all 19 solution replays re-recorded.
- [x] E2E gate: boot -> FTE -> finish Tutorial 1 -> localized results, zero
      console errors (dev hook + a real keyboard+touch test); screenshots of
      every screen at 390x844, 844x390, 768x1024, 1920x1080 captured + inspected.
      Run serialized (`fullyParallel: false`, `workers: 1`, `retries: 2`) so the
      heavy single-`vite preview` render loop is not starved by parallel
      contexts; reliably green across repeated `npm run e2e` runs.

## M4 - Modes & polish

- [ ] Daily seed mode + leaderboard hook
- [ ] Replay share flow (short codes)
- [ ] VFX (Phaser 4 unified Filters), audio, juice
- [ ] Multi-viewport screenshot inspection (390x844, 844x390, 768x1024, 1920x1080)

## M5 - Release readiness

- [ ] PWA manifest + generated icons (`scripts/gen-icons.ts`)
- [ ] Bundle size / Playables budget (code-split Phaser)
- [ ] Full E2E: boot -> tutorial 1 -> results, zero console errors
- [ ] Perf pass (`docs/PERF.md`), a11y/contrast pass, final credits

## M6 - Stretch

- [ ] Additional bosses/classes/modifiers
- [ ] Asynchronous "raid with strangers' replays"
- [ ] Cosmetics / accessibility options
