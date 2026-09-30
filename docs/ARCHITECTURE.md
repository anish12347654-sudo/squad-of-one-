# SQUAD OF ONE - Architecture

## Layer diagram

```
                 +---------------------------------------------------+
                 |                    src/game                       |
   input/render  |  Phaser 4 scenes, input->InputFrame, VFX,         |
   (impure)      |  fixed-timestep runner, interpolation             |
                 +-------------------------+-------------------------+
                                           |  (reads sim, feeds InputFrames)
                 +-------------------------v-------------------------+
                 |                    src/sim                        |
   PURE core     |  PRNG (in-state) | trig tables | FNV-1a hash |    |
   (deterministic)|  step(state,input)->state | types             |
                 +-------------------------^-------------------------+
                                           |  (typed data + pattern scripts
                 +-------------------------+   that use ONLY the sim API)
                 |                  src/content                      |
                 |  classes / enemies / bosses / levels / modifiers  |
                 +---------------------------------------------------+

   Support layers (impure, orbit src/game / app shell):
     src/ui        UI widgets, HUD, menus
     src/audio     sound/music playback (render-time only)
     src/meta      progression, save/economy, migrations
     src/platform  storage, share, haptics, PWA, no-op ads/analytics, Playables
     src/i18n      localization
```

**Dependency rule:** `src/sim` depends on nothing but itself and the committed
trig tables. `src/content` may depend on `src/sim` only. `src/game` and the
support layers may depend on `src/sim` and `src/content`. `src/sim` must never
import Phaser, DOM, timers, or the render/ui/audio layers. This is enforced by
ESLint (`eslint.config.js`, the `sim/determinism` config block) and by tests.

## Determinism rules (enforced by lint + tests)

The pure simulation (`src/sim/**`) obeys:

- **Fixed 60 Hz tick.** All time is measured in whole ticks (`TICK_RATE_HZ`).
- **All randomness from a seeded PRNG stored in sim state.** sfc32 seeded via
  mulberry32 (`src/sim/prng.ts`). There is **no** module-level mutable RNG; the
  four-uint32 state lives inside `SimState.rng`, so it travels with snapshots,
  forks and serialized saves.
- **No wall clock.** No `Date`, no `performance.now`, no `setTimeout`/
  `setInterval`/`requestAnimationFrame` inside the sim.
- **Restricted math.** Only `+ - * /`, and `Math.sqrt/abs/floor/ceil/round/
trunc/min/max`. `Math.random/sin/cos/tan/atan2/exp/log/pow` etc. are
  forbidden. `sin`/`cos` come from the **committed** integer tables in
  `src/sim/trig-tables.ts` (generated once by `scripts/gen-trig.ts`,
  `npm run gen:trig`); `atan2` is a closed-form rational approximation using
  only `+ - * / sqrt` (`atan2Brads` in `src/sim/trig.ts`).
- **Stable ordering.** Stable entity ids, deterministic iteration order,
  total-order comparators (grows in M1+).
- **Serializable + hashable state.** FNV-1a over a _quantized_ traversal of the
  state (`src/sim/hash.ts`). Numbers are quantized to a 1/1024 grid and object
  keys visited in sorted order, so the hash is invariant to float noise and
  serialization order. This hash is the determinism fingerprint.

## Fixed timestep + interpolation

`src/game/fixed-timestep.ts` implements the accumulator loop (Gaffer "Fix Your
Timestep"):

- Accumulate the real frame delta.
- While `accumulator >= 1/60 s`, snapshot `previous = clone(current)` and run
  `current = step(current, input)`, subtracting one tick.
- **Cap** at `MAX_TICKS_PER_FRAME = 5` ticks per frame. If still behind, drop
  the leftover accumulator: we **slow down, never skip** ticks, preserving
  determinism.
- Expose `alpha = accumulator / (1/60)` in `[0,1)` so the renderer can
  interpolate between `previous` and `current` sim state for smooth visuals at
  any display refresh rate.

The runner lives outside the pure sim because it reads wall-clock deltas.

## Data formats

- **InputFrame** (`src/sim/types.ts`): `moveX` int8, `moveY` int8, `aim` uint8,
  `aimActive` bit, `buttons` uint8 bitmask. The only external input to the sim.
- **Recordings** (M1+): an `InputFrame` stream, RLE-compressed into typed
  arrays. A "past self" is a recording replayed through the identical sim.
- **Replay code** (M1+): compact encoding of `{ seed, recording }` for sharing.
- **Save** (M2+, `src/meta`): versioned, migratable; hashable via the same
  FNV-1a routine for integrity.

## Verification-gate map (see brief section 10)

| Gate            | Where (M0)                              | Command             |
| --------------- | --------------------------------------- | ------------------- |
| Lint (+ det.)   | `eslint.config.js` sim rules            | `npm run lint`      |
| Types (strict)  | `tsconfig.json`                         | `npm run typecheck` |
| Unit tests      | `tests/unit/*` (PRNG, trig, hash, loop) | `npm run test`      |
| Determinism     | `tests/determinism/*` (same inputs ->   | `npm run test`      |
|                 | identical per-tick hashes)              |                     |
| Build           | `tsc --noEmit && vite build`            | `npm run build`     |
| E2E boot + shot | `e2e/boot.spec.ts` (title, 0 errors)    | `npm run e2e`       |

Later milestones extend this map (node-vs-browser hash parity, multi-viewport
screenshot inspection).

At M1 the map gains:

| Gate               | Where (M1)                                          | Command          |
| ------------------ | --------------------------------------------------- | ---------------- |
| Threat rules       | `tests/unit/threat.test.ts`                         | `npm run test`   |
| Recording RLE      | `tests/unit/recording.test.ts` (round-trip)         | `npm run test`   |
| Invariance Rule    | `tests/determinism/invariance.test.ts`              | `npm run test`   |
| Level solution     | `tests/solutions/arena-01.solution.test.ts`         | `npm run test`   |
| E2E gameplay       | `e2e/gameplay.spec.ts` (dev hook, screenshots, 0 err)| `npm run e2e`   |

The solution fixture is regenerated with `npm run record:solutions`
(`scripts/record-solutions.ts`), which plays the scripted bots
(`src/content/bots.ts`) through the pure sim and writes
`tests/solutions/arena-01.solution.json`.

---

## Frozen M1 Contracts

These interfaces are **frozen** as of M1. Later content milestones (classes,
enemies, levels, paradox, rewrite, meta) build on top of them and must not
repurpose or remove existing fields or change existing semantics. Additive
changes (new optional fields, new enum members, new modules) are allowed. The
authoritative shapes live in `src/sim/*` and are re-exported from
`src/sim/index.ts`.

### 1. `step()` signature

```ts
type StepFn = (state: SimState, input: InputFrame) => SimState;
```

`input` is the **live player's** frame for this tick. Echo inputs are injected
before the call via `setEchoInputs(bySlot: Map<slot, InputFrame>)`; the boss
pattern is set once per loop via `setBossPattern(steps)`. `step` mutates and
returns the passed state, is pure w.r.t. the outside world (only entropy is
`state.rng`), and advances exactly one tick. It is deterministic: identical
`(state, input, echoInputs, pattern)` always yield identical output and hash.

### 2. Entity model (`src/sim/types.ts`)

- **`Unit`** - live player, echo, or boss. Stable integer `id`; `kind`
  (`'player' | 'echo' | 'boss' | 'projectile'`), `team` (`'player' | 'enemy'`),
  `slot` (0-based, `-1` for boss), `classId`, quantized `x/y` (world units),
  `facing` (brads), `hp/maxHp`, `alive`, cooldown counters (`primaryCd`,
  `skillCd`, `dashCd`), dash state (`dashTicks/dashX/dashY`), and status timers
  (`tauntTicks`, `sanctuaryTicks`, `chargeTicks`).
- **`Projectile`** - `id`, `team`, `ownerId/ownerSlot`, `x/y`, `vx/vy`,
  `damage`, `life` (ticks), `piercing`, `hits[]`.
- **`BossAttack`** - `id`, `shape` (`'slam' | 'cone' | 'charge'`),
  `telegraphTicks`, `activeTicks`, `fired`, geometry (`x/y/radius/angle/halfArc`),
  `damage`.
- **`BossState`** - the aggro brain: `threat[]` (id-sorted `{targetId, threat}`),
  `targetId`, `reevalCd`, `forcedTauntTicks/forcedTargetId`, `phase`, `attackCd`,
  `patternCursor`.
- **`SimState`** - root: `tick`, `seed`, `rng`, `loopLength`, `recordingSlot`,
  `slotCount`, `slotClasses[]`, `units[]`, `projectiles[]`, `attacks[]`, `boss`,
  `nextId`, `outcome` (`'running' | 'won' | 'timeout'`), `playerId`.

**Contract 3.2 invariants (frozen):** player-team units never body-collide with
each other or with enemies; enemies never knock back or displace them; enemy
attacks deal damage only (no movement statuses in M1); a dead echo stays dead
for the loop.

### 3. `InputFrame` layout (`src/sim/types.ts`, `src/sim/recording.ts`)

```
moveX   int8   [-127,127]
moveY   int8   [-127,127]
aim     uint8  [0,255] (mapped to 4096 brads via aim<<4 when active)
aimActive bit
buttons uint8  bitmask: BUTTON_SKILL=1, BUTTON_DASH=2, BUTTON_INTERACT=4
```

Wire packing is 5 bytes/frame: `[moveX, moveY, aim, flags(bit0=aimActive),
buttons]`.

### 4. Recording / RLE format (`src/sim/recording.ts`)

- A **`Recording`** = `{ classId, length, frames[], positions:Float64Array,
  anchors[] }`. `frames` is one `InputFrame` per tick. `positions` holds the
  echo's `x,y` per tick (`positions[2t], positions[2t+1]`) and `anchors`
  (`{objectId, tick}`) are reserved for **M2 paradox detection only** - the sim
  never reads them for gameplay.
- **RLE encoding** (`encodeInputs` / `decodeInputs`): `[uint32 frameCount]`
  then repeated `[uint16 runLength][5-byte frame]`. Round-trippable.
- **Serialization** (`serializeRecording` / `deserializeRecording`): JSON-safe
  `{ classId, length, rle:number[], positions:number[], anchors[] }`. This is
  the level-solution fixture format under `tests/solutions/*.solution.json`.

### 5. Threat rule constants (`src/sim/threat.ts`)

```
THREAT_PER_DAMAGE = 1     // +1 threat per point of damage
THREAT_PER_HEAL   = 0.5   // +0.5 threat per HP healed (credited to the healer)
TAUNT_THREAT_BONUS = 100  // taunter threat := current max + 100
REEVAL_TICKS = 60         // target re-evaluated at most once per second
```

Targeting: highest **positive** threat; if none, idle (`targetId = -1`). Ties
break to the **lowest target id** (== lowest slot for the player team).
Re-evaluation is capped to once/second **except** a taunt (`applyTaunt`)
overrides instantly and holds for its duration; a target that dies is dropped
immediately. Heals only target allies below 100% HP (lowest HP% first, tie to
lowest id).

### 6. State-hash definition (`src/sim/hash.ts`)

FNV-1a 32-bit over a **quantized** traversal of the state: numbers rounded to a
1/`QUANTIZE_SCALE` grid (`QUANTIZE_SCALE = 1024`), object keys visited in sorted
order, arrays length-prefixed. `hashState(state)` is the determinism
fingerprint; identical inputs must reproduce identical per-tick hash sequences.
Transient scratch (spatial hash, echo-input buffer, boss pattern reference) is
**not** part of the hashed state - it is fully derived from hashed state +
deterministic inputs.

### 7. sim <-> content boundary

- `src/content` depends on `src/sim`'s public API only (via `@sim/index.js`) and
  is pure data + pattern scripts. It authors **`LevelDef`** (`src/sim/level.ts`)
  and **`BossPatternStep[]`** (`src/sim/boss-pattern.ts`), plus presentation-only
  metadata (`src/content/classes.ts`: name/colour/silhouette/sound/blurb) that
  the sim never reads.
- Class **stats** that the sim reads every tick (HP, speed, damage, cooldowns,
  skill tuning) live in `src/sim/classes.ts` as frozen constants
  (`classStats(id)`), so the pure sim stays self-contained.
- **`LevelRunner`** (`src/sim/level-runner.ts`) is the pure orchestrator of the
  time-loop: it owns per-slot recordings, routes live/echo input through the
  same `step()`, restarts each loop from the initial state (boss full HP, same
  seed, all units at tick 0), fast-forwards after the live player dies (the sim
  still ticks), and computes win/fail + stars. Its methods (`chooseClass`,
  `tickWith`, `needsClassChoice`, `computeStars`, ...) are the frozen surface the
  game layer drives.
- The game layer (`src/game`) reads sim state to render and turns device input
  into `InputFrame`s. The **dev hook** (`window.__SQUAD`, `src/game/dev-hook.ts`)
  feeds tick-exact `InputFrame`s through the same pipeline for e2e + solution
  replays and never affects live play.

## M5 additions (ship quality)

Nothing in the frozen sim changed; M5 is packaging, platform and tooling.

- **Compile-time flags (`src/dev-flags.ts`).** `__DEV_TOOLS__` and
  `__PLAYABLES__` are Vite `define` constants (see `vite.config.ts`). Guarding a
  dev tool with `if (__DEV_TOOLS__)` lets Rollup dead-code-eliminate it (and its
  imports) in the release build. `npm run build` keeps them ON (so the e2e suite
  can drive the sim); `npm run build:release`/`build:playables` strip them.
  `scripts/check-prod-bundle.ts` fails if any `window.__SQUAD*` hook or debug
  overlay leaks into the shipped bundle.
- **Offline PWA.** A Vite plugin (`offlineServiceWorker` in `vite.config.ts`)
  emits `dist/sw.js` precaching every built asset; `src/platform/pwa.ts`
  registers it. Cache-first, same-origin-only fallback -> zero play-time network
  calls. `public/manifest.webmanifest` + generated `public/icons/*` make it
  installable.
- **Platform layer growth (`src/platform`).** `pwa.ts` (SW registration),
  `gestures.ts` (block zoom/scroll during play), `playables.ts` (YouTube
  Playables adapter: firstFrameReady/gameReady/save/load/sendScore, flag-gated,
  zero external calls).
- **Perf.** `GameScene` gains a dev-only `DebugOverlay` (tick/hash/FPS/entity
  count) and always-on **auto resolution scaling** below 50 FPS (backing-store
  resolution only; logical coords + sim untouched). `scripts/perf.ts` measures a
  pure-sim `step()` benchmark plus 4x-CPU-throttled render FPS.
- **Determinism gate 2.** `src/content/parity.ts` is one pure harness run in
  both Node (`tests/determinism/parity-node.test.ts`, against a committed
  fixture) and real Chromium (`e2e/parity.spec.ts`, via `window.__SQUAD_DET`),
  asserting identical per-tick + final state hashes.
- **Native shell.** `capacitor.config.ts` wraps the bundled `dist/` for Android
  (offline; APK built externally with the Android SDK).
