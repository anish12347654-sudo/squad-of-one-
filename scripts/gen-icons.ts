/**
 * gen-icons.ts - generates PWA icons and favicons from the source mark using a
 * headless browser, and writes them into public/.
 *
 * Wired at M0 but not yet implemented: the source brand mark and PWA manifest
 * arrive in a later milestone. Running it now reports the pending work and exits
 * successfully so CI stays green. Implemented in a later milestone.
 */

export {};

function main(): void {
  const sizes: number[] = [];
  if (sizes.length === 0) {
    console.log(
      'gen-icons: no icon spec defined yet (PWA assets land in a later milestone). Nothing to generate.',
    );
    return;
  }
  // Later: render the brand mark at each size via Playwright and write PNGs to
  // public/icons/, then update the manifest.
}

main();
