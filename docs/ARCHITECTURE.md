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

Later milestones extend this map (level-solution replays, node-vs-browser hash
parity, multi-viewport screenshot inspection).
