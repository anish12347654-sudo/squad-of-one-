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

## M2 - Content & classes

- [ ] Class kits (data + pattern scripts using only sim API)
- [ ] Enemies + first bosses (data + patterns)
- [ ] Level format + first levels (tutorial + early bosses)
- [ ] `scripts/record-solutions.ts` records bot solution replays per level
- [ ] Level-solution tests: every level wins with >= 1 star

## M3 - Meta, UI, platform

- [ ] Progression/economy, save + migrations (`src/meta`)
- [ ] UI: menus, HUD, results (`src/ui`), first-time experience
- [ ] Touch + keyboard input -> InputFrame (`src/game`)
- [ ] Platform adapters (storage/share/haptics/PWA, no-op ads+analytics, Playables)
- [ ] i18n scaffolding + fonts (Noto Sans + Noto Sans Devanagari)

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
