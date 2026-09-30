/**
 * PWA registration (brief 9.6): registers the offline service worker so the
 * built game is installable and runs with ZERO runtime network calls after the
 * first load. The SW (dist/sw.js) is generated at build time from the real
 * asset list (see vite.config.ts `offlineServiceWorker`).
 *
 * No-op during `vite dev` (import.meta.env.DEV) - the SW only exists in a build
 * output - and a no-op where the Service Worker API is unavailable (older
 * WebViews, some headless contexts). Registration is the only place the shell
 * touches the network, and it fetches only the same-origin SW file; gameplay
 * itself never makes a network request.
 */

/** Resolve the base-relative SW url from the document base (Vite `base: './'`). */
function swUrl(): string {
  const base = document.baseURI.endsWith('/') ? document.baseURI : document.baseURI + '/';
  return new URL('sw.js', base).toString();
}

/** Register the offline service worker. Safe to call unconditionally. */
export function registerServiceWorker(): void {
  // Dev server has no generated SW; skip to avoid caching the HMR shell.
  if (import.meta.env.DEV) return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(swUrl(), { scope: './' }).catch(() => {
      // Offline PWA is a progressive enhancement; a failed registration must
      // never break the game (it simply runs online-first this session).
    });
  });
}
