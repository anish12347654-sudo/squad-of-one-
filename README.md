# SQUAD OF ONE

> Every hero on your team is you.

A mobile-first, offline-installable **time-loop boss-raid** game. You fight a
boss for one 20-second loop, then **rewind** - and your previous run replays as a
recorded "echo" fighting beside you. Stack up to 7 past selves (each a different
class), keep your timeline consistent (break it and an echo turns hostile - a
**paradox**), spend Time Shards to **rewrite** an earlier loop, and end on the
Final Avatar's **Convergence** to win.

Built with **TypeScript + Vite + Phaser 4**, rendering over a **pure,
engine-free, deterministic simulation core** (fixed 60 Hz tick, seeded PRNG,
integer trig, FNV-1a state hashing). The sim is bit-reproducible in Node, a Web
Worker, and the browser.

---

## Quick start

> **Node:** v22.x. **npm** must be on your `PATH`.

```bash
npm install          # install dependencies
npm run dev          # Vite dev server (hot reload) -> http://localhost:5173
npm run build        # type-check + production build (dev tools ON, for e2e) -> dist/
npm test             # Vitest: unit + determinism + level-solution suites
npm run e2e          # Playwright: boot/FTE/gameplay/offline/parity + screenshots
```

Other useful scripts:

```bash
npm run typecheck        # tsc --noEmit (strict)
npm run lint             # ESLint (incl. the sim determinism rules)
npm run format           # Prettier

npm run build:release    # SHIPPED PWA build: dev tools stripped, no source maps
npm run build:playables  # YouTube Playables build (adapter compiled in)
npm run check:prod       # build:release + verify dev tools absent + bundle budget
npm run perf             # throttled-CPU perf pass (writes numbers for docs/PERF.md)

npm run gen:icons        # regenerate PWA icons from the brand mark (headless Chromium)
npm run gen:fonts        # re-download + re-subset the OFL fonts
npm run gen:trig         # regenerate the committed integer trig tables
npm run record:solutions # re-record the per-level bot solution replays
```

---

## Running the built game

```bash
npm run build            # or: npm run build:release  (shipped bundle)
npx vite preview --port 4173
# open http://localhost:4173
```

Dev/e2e query params (default build only; stripped from `build:release`):

- `?skipIntro=1` - skip the first-time experience, boot to the title menu.
- `?scene=game` - boot straight into the showcase GameScene.
- `?level=<id>` - open a campaign level's intro (e.g. `?level=w1-boss`).
- `#r=<code>` - deterministically play back a shared replay code.

---

## Build & deploy (Web / PWA - primary)

1. `npm run build:release` produces `dist/` - a static, self-contained site:
   HTML + JS chunks + subsetted fonts + generated icons + `manifest.webmanifest`
   + an offline service worker (`sw.js`).
2. Deploy `dist/` to **any static host** (Netlify, GitHub Pages, S3+CloudFront,
   nginx). No server code, no environment variables, no database.
3. Serve over **HTTPS** so the service worker can register (localhost is exempt).

The app is an **installable, offline PWA**: after the first load the service
worker precaches every asset, and the game boots and plays with **zero runtime
network calls** (verified by `e2e/offline.spec.ts`). This also satisfies YouTube
Playables' size (<= 5 MB initial / <= 15 MB total) and no-external-call rules -
see [`docs/PERF.md`](docs/PERF.md).

`base` is `./` (relative), so the build works from any sub-path.

## YouTube Playables

The Playables adapter (`src/platform/playables.ts`) implements Google's SDK
surface - `firstFrameReady`, `gameReady`, `setSavedData`/`getSavedData`,
`sendScore` - and is **behind a build flag, OFF by default**. It engages only
when the YouTube host has injected `ytgame` and `ytgame.IN_PLAYABLES_ENV` is
true; otherwise every call is a safe no-op. It makes **zero external network
calls** (the host injects the SDK; we never fetch a script).

```bash
npm run build:playables   # compiles the adapter in (VITE_PLAYABLES=1)
```

Upload the resulting `dist/` per the Playables submission flow. Reference:
<https://developers.google.com/youtube/gaming/playables/reference/sdk>.

## Android / Capacitor

A [Capacitor](https://capacitorjs.com/) config (`capacitor.config.ts`) wraps the
built PWA in a native Android shell that loads the **bundled** `dist/` (so it
runs fully offline, no network calls).

```bash
npm run build:release          # 1. produce dist/
npx cap add android            # 2. one-time: scaffold the android/ project
npx cap sync android           # 3. copy dist/ + plugins into the native project
# then either:
npx cap open android           # 4a. open in Android Studio and Run
# or headless:
cd android && ./gradlew assembleDebug   # 4b. build app/build/outputs/apk/debug/*.apk
```

> A full APK build requires the **Android SDK + Gradle + a JDK**, which are not
> installed in the CI sandbox. In this repo we verify the Capacitor config is
> valid (`npx cap copy` succeeds against `dist/`); run the `cap add`/`sync`/build
> steps above on a machine with Android Studio to produce an APK. The `android/`
> folder is git-ignored (regenerated by `cap add`).

---

## Verification gates (all green)

Run `npm run lint && npm run typecheck && npm test && npm run build && npm run e2e`.

1. **Unit + determinism** - PRNG, trig, hash, recording RLE, threat, paradox,
   rewrite, save migrations, economy, i18n, objectives, Playables adapter.
2. **Determinism** - same inputs -> identical per-tick hashes; the Invariance
   Rule test; **Node-vs-browser hash parity** on the same replay
   (`tests/determinism/parity-node.test.ts` + `e2e/parity.spec.ts`).
3. **Level solutions** - every one of the 19 campaign levels wins with >= 1 star
   (>= 2 in practice), live and via its recorded replay.
4. **E2E (Playwright)** - boot -> first-time experience -> finish Tutorial 1 ->
   localized results, zero console errors; **offline** boot with the network
   cut; multi-viewport screenshots at 390x844 / 844x390 / 768x1024 / 1920x1080.
5. **Ship checks** - `npm run check:prod` proves the release bundle is within
   budget, ships the PWA artifacts, and contains **no dev-only tools**.

Screenshots are written to **`e2e/output/`** (git-ignored) and inspected during
the e2e run - e.g. `offline-title.png`, `m3-*-<viewport>.png`,
`m2-scrubber/paradox/rewind/convergence/victory.png`.

---

## Project layout

```
src/
  sim/        PURE deterministic core (step/entities/PRNG/trig/hash) - FROZEN at M1
  content/    typed level/class/enemy/boss/modifier data + pattern scripts + bots
  game/       Phaser 4 scenes, input -> InputFrame, VFX, fixed-timestep runner
  ui/         title / world map / shop / settings / replays / results / FTE / modes
  audio/      procedural adaptive music + SFX (no audio assets)
  meta/       progression, economy, versioned saves, cosmetics
  platform/   storage, share, haptics, PWA + offline SW, gestures, Playables
  i18n/       en + hi (Devanagari), no hard-coded UI strings
  dev-flags.ts  compile-time DEV_TOOLS / PLAYABLES constants (Vite `define`)
tests/        unit / determinism / solutions (Vitest)
e2e/          Playwright specs + screenshot output
scripts/      gen-trig, gen-icons, record-solutions, perf, check-prod-bundle, ...
public/       manifest.webmanifest, icons/, fonts/ (subsetted OFL)
docs/         GDD, ARCHITECTURE, DECISIONS, PERF, CREDITS
```

## Documentation (`docs/`)

- **[GDD.md](docs/GDD.md)** - game design: classes, paradox/rewrite, modes.
- **[ARCHITECTURE.md](docs/ARCHITECTURE.md)** - layer diagram, determinism rules,
  and the **Frozen M1 Contracts** (`step()`, entity model, InputFrame, RLE,
  threat constants, state-hash) that later milestones must not break.
- **[DECISIONS.md](docs/DECISIONS.md)** - every self-made decision, one line each,
  per milestone (read the **M5** section for this milestone's choices).
- **[PERF.md](docs/PERF.md)** - budgets, the throttled-CPU perf pass results, and
  the release bundle sizes.
- **[CREDITS.md](docs/CREDITS.md)** - fonts (OFL Noto Sans + Noto Sans Devanagari)
  and other attributions.

## License / assets

All gameplay art is drawn procedurally (vector graphics + WebAudio); there are
no third-party image or audio assets. Fonts are the OFL-licensed Noto Sans and
Noto Sans Devanagari, subsetted and bundled locally (see `public/fonts/OFL.txt`
and `docs/CREDITS.md`).
