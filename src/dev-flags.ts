/**
 * Build-time feature flags (brief section 9.2 + 9.7).
 *
 * `DEV_TOOLS` gates every dev/e2e-only tool: the tick-exact input hooks
 * (`window.__SQUAD*`), the debug overlay (tick / state hash / FPS / entity
 * count), tick stepping, level select and invincibility. It is a COMPILE-TIME
 * constant so the release build tree-shakes all of that code out of the shipped
 * bundle - verified absent by `scripts/check-prod-bundle.ts`.
 *
 * `PLAYABLES` gates the YouTube Playables adapter (off by default). Both are
 * injected by Vite `define` (see vite.config.ts) from `__DEV_TOOLS__` /
 * `__PLAYABLES__`; the `typeof` guard keeps this file valid under Vitest/tsx
 * where the defines are absent (dev tools default ON there, Playables OFF).
 */

// `__DEV_TOOLS__` / `__PLAYABLES__` are injected by Vite `define` and typed in
// src/vite-env.d.ts. Under Vitest/tsx the defines are absent, so the `typeof`
// guard falls back to dev-tools ON / Playables OFF.

/** True in dev + e2e builds; FALSE in the shipped `build:release` bundle. */
export const DEV_TOOLS: boolean = typeof __DEV_TOOLS__ !== 'undefined' ? __DEV_TOOLS__ : true;

/** True only when the YouTube Playables target is built (`build:playables`). */
export const PLAYABLES: boolean = typeof __PLAYABLES__ !== 'undefined' ? __PLAYABLES__ : false;
