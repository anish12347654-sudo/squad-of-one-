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

## M4 - Modes & sharing ✅ (complete)

All gates green: lint / typecheck / test (198) / build / e2e (11: 6 M3 + 5 M4).

- [x] Replay codes: base64url of a compact binary payload {simVersion,
      contentHash, levelId, seed, per-slot class + RLE inputs} (`src/sim/
      replay-code.ts` + `version.ts`, `src/content/content-hash.ts`). `/#r=<code>`
      plays back deterministically through the frozen `step()` path (`src/game/
      replay-link.ts`, main.ts hash route + GameScene replay mode). "Beat this
      run" starts the same level fresh. Version/content mismatch shows a clear
      localized message and NEVER desyncs silently (typed decode result).
      Round-trip + mismatch + deterministic-playback tests.
- [x] Daily Paradox: date-seed computed OUTSIDE the sim picks a level + 2
      modifiers (typed data in `src/content/modifiers.ts`, applied
      deterministically: enraged/tanky/swift boss, five-slots, short-loop,
      glass-echoes via the new additive `LevelDef.echoHpScale`). Score = win
      time + echoes alive + rewrites + early victory (`src/content/daily.ts`).
      Local best (`SaveGame.dailyBest`, save v4) + shareable PNG result card
      (`src/ui/daily-scene.ts`, `daily-results-scene.ts`).
- [x] Time Chess: self-contained PURE duel sim (`src/content/time-chess*.ts`),
      5 loops x 15 s, simultaneous recording over replaying prior loops, unique
      class per loop (no Avatar), control-zone + units-alive scoring. Vs a
      DETERMINISTIC 3-difficulty AI bot (seeded, engine-free; identical play for
      same seed+difficulty) and local 2-player (split keyboard; split touch on
      tablets). `src/ui/time-chess-scene.ts`.
- [x] Clip export (`src/platform/share.ts`): canvas.captureStream +
      MediaRecorder (mimeType via isTypeSupported), game audio via
      MediaStreamAudioDestinationNode, small watermark, Web Share API (files)
      with download fallback; feature-detected, degrades to a watermarked PNG
      where unsupported. PNG result cards for victories + Daily results.
- [x] Menus: Replays screen (paste/Load & Play codes, Beat This Run, top-20
      from save) + share options wired from the victory cinematic / results
      (`src/ui/share-actions.ts`). Daily + Time Chess entries on the title menu.
      All new UI strings localized en + hi (no hard-coded strings, test-enforced).
- [x] Tests: replay-code base64url + RLE round trip; version/content mismatch
      message path (no silent desync); Daily seed -> deterministic level +
      modifier selection + scoring; Time Chess AI determinism + score; replay
      deterministic playback. Determinism/invariance/solution/Worker-parity
      suites still green.
- [x] E2E (headless Playwright): export a clip (or graceful fallback), generate
      a result-card PNG, load a `/#r=` replay for deterministic playback, run a
      Time Chess vs-AI match; screenshots (Daily result card, Time Chess,
      Replays screen, exported card) captured + inspected; zero console errors.
- [x] Git commit for M4.

### Remaining M4 brief bullets folded into M5 (polish)
- [x] Multi-viewport screenshot inspection also for the mode + core screens at
      390x844 / 844x390 / 768x1024 / 1920x1080 (m3-flow spec; FIT letterboxes
      one layout). Offline title captured + inspected at 390x844.

## M5 - Ship quality ✅ (complete)

All gates green: lint / typecheck / test (205) / build / build:release /
check:prod / e2e (14 specs). Dev tools verified ABSENT from the shipped bundle.

- [x] **PWA / offline**: installable PWA (`public/manifest.webmanifest` + icons)
      and a hand-rolled offline service worker generated from the real build
      output (`vite.config.ts` `offlineServiceWorker` -> `dist/sw.js`),
      registered by `src/platform/pwa.ts`. ZERO runtime network calls at play
      time - all assets bundled incl. the OFL fonts. Verified by
      `e2e/offline.spec.ts` (no external requests on first load + full offline
      reload boots to the title). Icons generated by `npm run gen:icons`
      (`scripts/gen-icons.ts`, headless Chromium).
- [x] **Performance pass** (`docs/PERF.md`): pure-sim `step()` ~7.5 us/tick
      (budget 16 670 us); object pools + no per-tick sim allocations + particle
      caps (220 / 40); auto resolution scaling below 50 FPS
      (`GameScene.updateAutoResolution`). 4x-CPU-throttled FPS sampled via
      Playwright/CDP (`npm run perf`) and recorded with the software-render
      caveat.
- [x] **Bundle budget**: release bundle ~1.63 MB initial / ~1.68 MB total (<= 5
      / <= 15 MB). Phaser split into its own chunk (`manualChunks`), resolving
      the M0 >500 kB warning. Enforced by `npm run check:prod`; sizes in
      `docs/PERF.md`.
- [x] **Layout / responsive**: portrait 9:16 primary, live resize
      (`GameScene.onResize`), safe-area insets (`index.html` `env(safe-area-*)`),
      zoom/scroll gestures blocked during play (`src/platform/gestures.ts` +
      viewport meta). Verified at 390x844 / 844x390 / 768x1024 / 1920x1080.
- [x] **Bug bash + balance**: every level plays end to end (41-assertion
      level-solution gate: all 19 levels win >= 2 stars live + via recorded
      replay). No crashes/soft-locks. Balance already well-tuned from M3/M4 - no
      numeric changes, so no re-record needed (logged in DECISIONS.md).
- [x] **YouTube Playables adapter** (`src/platform/playables.ts`):
      firstFrameReady / gameReady / saveData / loadData / sendScore behind the
      `__PLAYABLES__` flag, OFF by default, zero external calls. Built via
      `npm run build:playables`. Unit-tested.
- [x] **Capacitor Android wrapper**: `capacitor.config.ts` (loads bundled
      `dist/`, offline), build steps in the README, config validated via
      `npx cap copy`.
- [x] **README**: run/build/deploy, PWA + Playables + Capacitor notes,
      screenshot locations, docs/ summary.
- [x] **Dev tools stripped from production**: debug overlay (tick/hash/FPS/
      entity count), tick stepping, all `__SQUAD*` automation hooks - gated on
      the `__DEV_TOOLS__` define and VERIFIED absent from the release bundle by
      `scripts/check-prod-bundle.ts`.
- [x] **Node-vs-browser hash parity** (determinism gate 2): one pure harness
      (`src/content/parity.ts`) + committed fixture, asserted in Node
      (`parity-node.test.ts`) and in real Chromium (`e2e/parity.spec.ts`).
- [x] Git commit for M5.

## Visual overhaul

A premium art-direction pass over the (functionally complete) game. Render /
presentation layer ONLY - `src/sim/**` is byte-identical and all 205 tests
(determinism / parity / level-solution / i18n) stay green.

- [x] **FEAT-001 - frozen visual-kit foundation**: establish + freeze the
      premium visual kit before any per-scene work (mirrors how M1 froze the
      sim contracts).
  - [x] Baseline confirmed green (lint/typecheck/205 tests/build/check:prod);
        initial load 1.63 MB. BEFORE screenshots captured to
        `e2e/output/before/`.
  - [x] **Display font Orbitron** (OFL-1.1): instanced to bold + subsetted
        (~4.8 KB `Orbitron-subset.woff2`), `@font-face` in `index.html`, loaded
        via `fonts.ts` (`fontFamilyForDisplay()` + `FONT_FAMILIES`), attributed
        in `docs/CREDITS.md` + `OFL.txt`. Hindi headings fall back to Noto
        Devanagari (no tofu, verified by screenshot).
  - [x] **Gradient-ready palette** (`colors.ts`): `GRADIENTS`/`GLOWS`/`TINTS`
        + helpers added; flat `COLORS` + `lerpColor` preserved.
  - [x] **Phaser 4 Filters bloom** (`filters.ts`): tuned Glow + Blur bloom and
        optional Vignette alongside the existing rewind, `setBloom(intensity)`
        for the "reduced flashing" a11y setting, try/catch-guarded. Three.js /
        PixiJS depth layer evaluated and DECLINED (bundle/perf) - see
        `docs/DECISIONS.md`.
  - [x] **Premium ui-kit** (`ui-kit.ts`): gradient + shadow + glow + hover/press
        micro-animation `button()`, glass `panel()`, `display`/`glow` `label()`
        options, gold-gradient glowing stars - public API, `Button` shape and
        all `name:` identifiers preserved (new look via optional opts only).
  - [x] **Shared animated backdrop** (`backdrop.ts`): neon clockwork + rangoli/
        jaali lattice, frozen create/update/resize/destroy API, reduced-motion
        static fallback. TitleScene adopts it.
  - [x] Release bundle within budget after the overhaul: initial load 1.64 MB
        (+~4.8 KB Orbitron) / budget 5 MB; total 1.69 MB / budget 15 MB.
  - [x] Frozen visual-kit API surface recorded in `docs/DECISIONS.md` for
        FEAT-002/003.
  - [x] AFTER screenshots captured (`scripts/showcase-static.mjs`): title now
        shows the Orbitron headline + neon backdrop; buttons/panels show
        gradient + glow + depth; Hindi renders without tofu.

- [x] **FEAT-002 - premium menu suite**: applied the frozen kit across EVERY
      menu scene so none still looks flat. Render-layer only; `src/sim/**`
      byte-identical; all 205 unit tests + 14 e2e specs + `check:prod` green;
      initial load 1.64 MB (unchanged - procedural, no new assets).
  - [x] Shared `src/ui/scene-backdrop.ts`: `mountBackdrop()` wires the frozen
        animated backdrop (per-frame update + resize + shutdown teardown,
        reduced-motion aware) and refreshes the camera on create (fixes the
        GameScene->menu camera-clip-to-right-half case); `createEmblem()` draws
        the glowing animated time-loop lens brand mark; `staggerIn()` gives a
        reduced-motion-aware staggered entrance.
  - [x] **Title**: animated clockwork/rangoli backdrop, Orbitron hero title with
        neon glow, the glowing animated time-loop lens emblem (ring + core +
        orbiting echo dots), staggered button entrance. `name:` ids +
        `title-ready` event intact.
  - [x] **World map**: gradient node tiles with accent glow for unlocked,
        dimmed/locked styling, world-accent header bars; still fits all 19
        levels + 5 worlds on 390x844 under FIT; node interactivity + names
        preserved.
  - [x] **Level intro**: cinematic boss title card - Orbitron boss name with the
        world palette accent + glow, world-tinted backdrop, animated reveal.
  - [x] **Shop / settings / results / replays / daily / daily-results /
        time-chess / credits / pause / fte**: shared backdrop, display-font
        glowing headings, upgraded gradient/glow buttons+panels. Results +
        daily-results tint gold on victory with a star shimmer; replays keeps
        the HTML `<input>` overlay; settings sliders/toggles still wired to the
        save; pause gets a glass card + accent vignette modal; the FTE first
        impression reads premium while keeping its scripted timing + self-route.
  - [x] Accessibility: all new backdrops/emblem/entrance honor reduced-motion
        (static fallback / snapped-in) via the shared save-context setting.
  - [x] AFTER screenshots across 390x844 / 844x390 / 768x1024 / 1920x1080
        (`scripts/showcase-static.mjs`) + Hindi (`scripts/showcase-hi.mjs`)
        captured + inspected: every menu now reads premium (animated backdrop,
        display-font headings, gradient/glow buttons+panels), none flat; zero
        console errors.

- [x] **FEAT-003 - in-game cinematic overhaul**: the GameScene itself now reads
      premium, not flat. Render-layer only (`src/game/scenes/game-scene.ts`,
      `src/game/render/vfx.ts`, `src/ui/save-context.ts` accessors); `src/sim/**`
      byte-identical; all 205 unit tests + 14 e2e specs + `check:prod` green;
      initial load unchanged at ~1.65 MB (procedural, no new assets).
  - [x] Shared animated clockwork/rangoli backdrop (world-palette-tinted)
        behind the arena; gradient arena floor with a glowing world-accent rim
        + subtle inner grid for lit depth.
  - [x] Layered entities: player + echoes + minions get a glow halo, gradient
        body, bright energy core and class-colored rim instead of flat shapes.
        The per-class SHAPE (silhouette) + NUMBER badge colour-blind Assist
        identity is preserved (and strengthened under colour-blind mode).
  - [x] Boss: gradient body, a glowing energy core that pulses with phase (hotter
        / faster in phase 2), a rotating clockwork node ring, and brighter
        bloom-lit telegraphs that still honour the safe/danger colour semantics.
  - [x] FEAT-001 Filters bloom + vignette attached to the world layer, scaled
        down when "reduced flashing" is on; a crescendo pulse pushes bloom above
        base on paradox / Convergence / boss death, then eases back.
  - [x] Richer pooled VFX within the EXISTING caps (220 particles / 40 damage
        numbers): additive glowing particles, projectile/beam trails, impact
        rings, heal/shield auras, shard-grab sparkles, paradox glitch motes, and
        crisper (shadowed, big-on-heavy-hit) damage numbers derived purely from
        the rendered boss-HP delta.
  - [x] Cinematic Convergence + boss death: swelling light core + energy beams,
        a slow-mo flash, a particle crescendo and a bloom/shatter burst - all
        presentation-only, honouring reduced-flashing / screen-shake a11y.
  - [x] HUD polish: boss/convergence bars, slot chips, loop ring and shard
        counter get gradient fills + soft shadows + glow consistent with the
        ui-kit; all HUD element names + the `__SQUAD` hook behaviour preserved.
  - [x] AFTER screenshots (`scripts/showcase-static.mjs` extended to drive
        combat + the Convergence/victory crescendo via the `__SQUAD` hook):
        `06-combat` + `06b-convergence-victory` captured + inspected; the fight
        and win read cinematic, zero console errors.
  - [x] Determinism / Invariance / all 19 level-solution (live + recorded) /
        Node-vs-browser hash-parity tests pass byte-identically; `git diff
        --name-only -- src/sim` is empty.

## M6 - Stretch

- [ ] Additional bosses/classes/modifiers
- [ ] Asynchronous "raid with strangers' replays"
- [ ] Cosmetics / accessibility options
