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

## M1 - Simulation contracts (frozen before parallel work)

- [ ] Entities, stable ids, deterministic iteration + total-order comparators
- [ ] Deterministic circle/AABB collision, spatial hash, grid pathfinding
- [ ] InputFrame recording (RLE typed arrays) + replay playback ("past self")
- [ ] Replay code encode/decode (seed + recording)
- [ ] Threat/aggro rules, paradox detection, rewrite semantics
- [ ] Node-vs-browser hash-parity test on the same replay
- [ ] Freeze sim API for content work

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
