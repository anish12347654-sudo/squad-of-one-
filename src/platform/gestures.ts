/**
 * Block browser zoom / scroll gestures during play (brief 9.6). The viewport
 * meta already sets `user-scalable=no` + `touch-action: none`, but iOS Safari
 * still fires pinch (`gesturestart`) and double-tap zoom, and desktop Chrome
 * zooms on ctrl+wheel. This suppresses those so touch input reaches the game
 * canvas cleanly. Purely presentational; never touches the sim.
 */

/** Install passive-safe listeners that swallow zoom/scroll gestures. */
export function blockZoomAndScroll(): void {
  if (typeof document === 'undefined') return;

  // iOS pinch-zoom gesture events.
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
  }

  // Desktop ctrl+wheel zoom.
  document.addEventListener(
    'wheel',
    (e) => {
      if (e.ctrlKey) e.preventDefault();
    },
    { passive: false },
  );

  // Double-tap zoom (iOS): swallow a second touchend within 300 ms.
  let lastTouchEnd = 0;
  document.addEventListener(
    'touchend',
    (e) => {
      const now = Date.now();
      if (now - lastTouchEnd <= 300) e.preventDefault();
      lastTouchEnd = now;
    },
    { passive: false },
  );

  // Suppress the context menu (long-press) so it does not interrupt play.
  document.addEventListener('contextmenu', (e) => e.preventDefault());
}
