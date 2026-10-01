import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const r = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

// Release build (shipped PWA) strips dev tools; the default build keeps them so
// the Playwright e2e (which runs against `vite preview`) can drive the sim.
const isRelease = process.env.VITE_RELEASE === '1';
// The YouTube Playables target is built with the adapter compiled in.
const isPlayables = process.env.VITE_PLAYABLES === '1';
// Dev tools are on in dev + the default (e2e) build, off in release/playables.
const devTools = !(isRelease || isPlayables);

/**
 * Emits a service worker that precaches every built asset (JS/CSS/fonts/icons/
 * manifest + index.html) so the installed PWA runs fully OFFLINE with ZERO
 * runtime network calls at play time (brief 9.6, Playables no-external-call
 * rule). The precache list is derived from the real build output, so it never
 * drifts. A cache-first strategy serves everything from the cache after install.
 */
function offlineServiceWorker(): Plugin {
  let outDir = 'dist';
  let base = './';
  return {
    name: 'squad-offline-sw',
    apply: 'build',
    configResolved(cfg): void {
      outDir = cfg.build.outDir;
      base = cfg.base;
    },
    writeBundle(_options, bundle): void {
      const b = base.endsWith('/') ? base : base + '/';
      const urls = new Set<string>([b, `${b}index.html`, `${b}manifest.webmanifest`]);
      for (const key of Object.keys(bundle)) {
        // Skip source maps: never fetched at play time, never precached.
        if (key.endsWith('.map')) continue;
        urls.add(b + key);
      }
      // Bundled fonts + icons live under public/ (copied verbatim by Vite).
      for (const f of [
        'fonts/NotoSans-subset.woff2',
        'fonts/NotoSansDevanagari-subset.woff2',
        'fonts/Orbitron-subset.woff2',
        'icons/icon-192.png',
        'icons/icon-512.png',
        'icons/maskable-512.png',
        'icons/apple-touch-icon.png',
      ]) {
        urls.add(b + f);
      }
      const cacheName = `squad-of-one-v${process.env.npm_package_version ?? '0'}-${Date.now()}`;
      const sw = `/* Auto-generated offline service worker for SQUAD OF ONE.
 * Cache-first: after install the game boots and plays with ZERO network calls. */
const CACHE = ${JSON.stringify(cacheName)};
const ASSETS = ${JSON.stringify([...urls])};
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      // Same-origin only; the game never talks to third parties at play time.
      return fetch(req)
        .then((res) => {
          if (res && res.ok && new URL(req.url).origin === self.location.origin) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(${JSON.stringify(b)}));
    }),
  );
});
`;
      const swPath = resolve(dirname(fileURLToPath(import.meta.url)), outDir, 'sw.js');
      writeFileSync(swPath, sw, 'utf-8');
    },
  };
}

// Vite configuration for SQUAD OF ONE.
// - Path aliases mirror the src/ layer layout (see tsconfig.json paths).
// - Web Worker output is emitted as ES modules so the deterministic sim can be
//   hosted in a worker without changing the build target.
// - Phaser is split into its own chunk (manualChunks) so the engine can be
//   cached independently of game code (bundle budget, docs/PERF.md).
export default defineConfig({
  base: './',
  define: {
    __DEV_TOOLS__: JSON.stringify(devTools),
    __PLAYABLES__: JSON.stringify(isPlayables),
  },
  resolve: {
    alias: {
      '@sim': r('./src/sim'),
      '@content': r('./src/content'),
      '@game': r('./src/game'),
      '@ui': r('./src/ui'),
      '@audio': r('./src/audio'),
      '@meta': r('./src/meta'),
      '@platform': r('./src/platform'),
      '@i18n': r('./src/i18n'),
    },
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    // Source maps ship only in the non-release (dev/e2e) build; the release PWA
    // omits them so the bundle stays lean and nothing extra is precached.
    sourcemap: !isRelease,
    // Phaser is a ~1.3 MB vendor engine split into its own cacheable chunk
    // (below). That chunk is intentionally large and well under the 5 MB
    // initial-load budget, so raise the warning limit past it - the >500 kB
    // warning is deliberately resolved by isolating the engine, not by trying
    // to shrink Phaser itself. See docs/PERF.md.
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: {
          phaser: ['phaser'],
        },
      },
    },
  },
  plugins: [offlineServiceWorker()],
});
